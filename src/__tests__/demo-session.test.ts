import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_IDENTITIES, DEMO_ROLES, type DemoIdentity } from "@/lib/demo/roles";

const state = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn(), fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: state.getSupabaseAdminClient }));
import { demoTokenHash, getDemoLoginToken, getOrCreateDemoVisit } from "@/lib/demo/session";

const visitId = "00000000-0000-4000-8000-000000000001";
const identities = Object.fromEntries(DEMO_IDENTITIES.map((role, i) => [role, `00000000-0000-4000-8000-00000000000${i + 2}`])) as Record<DemoIdentity, string>;
const createdVisit = { id: visitId, expires_at: "2060-01-01T00:00:00.000Z" };
const completedVisit = { ...createdVisit, identities };
const visitorToken = "a".repeat(64);
const rateSecret = "fixture-rate-secret-with-at-least-32-characters";
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function rpcName(input: string) { return new URL(input).pathname.split("/").at(-1); }
function rpcCalls(name: string) {
  return state.fetch.mock.calls.filter(([url]) => rpcName(url) === name);
}
function rpcBody(call: unknown[]) { return JSON.parse((call[1] as RequestInit).body as string); }
async function defaultRpc(input: string) {
  switch (rpcName(input)) {
    case "demo_create_session": return json(createdVisit);
    case "demo_get_session": return json(completedVisit);
    case "demo_seed_session":
    case "demo_expire_session":
    case "demo_cleanup_expired_sessions": return json(null);
    default: throw new Error("Unexpected fixture database operation");
  }
}
function userFor(identity: DemoIdentity) {
  return { id: identities[identity], email: `demo+${visitId}.${identity}@example.test` };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_WORKFARE_DEMO_ENABLED", "true");
  vi.stubEnv("WORKFARE_DEMO_MODE", "hosted");
  vi.stubEnv("WORKFARE_DEMO_PROJECT_REF", "abcdefghijklmnopqrst");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  vi.stubEnv("SUPABASE_URL", undefined);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  vi.stubEnv("WORKFARE_DEMO_RATE_SECRET", rateSecret);
  vi.stubEnv("WORKFARE_DEMO_TRUST_CLOUDFLARE", "false");
  vi.stubGlobal("fetch", state.fetch);
  state.fetch.mockImplementation(defaultRpc);
  state.createUser.mockImplementation(async ({ app_metadata }: { app_metadata: { demo_identity: DemoIdentity } }) => ({ data: { user: userFor(app_metadata.demo_identity) }, error: null }));
  state.deleteUser.mockResolvedValue({ data: {}, error: null });
  state.getUserById.mockImplementation(async (id: string) => {
    const identity = DEMO_IDENTITIES.find((role) => identities[role] === id);
    return { data: { user: identity ? userFor(identity) : { id, email: "unrelated@example.test" } }, error: null };
  });
  state.generateLink.mockImplementation(async ({ email }: { email: string }) => {
    const identity = DEMO_IDENTITIES.find((role) => userFor(role).email === email)!;
    return { data: { user: userFor(identity), properties: { hashed_token: "fixture-hashed-otp" } }, error: null };
  });
  state.getSupabaseAdminClient.mockReturnValue({ auth: { admin: {
    createUser: state.createUser, deleteUser: state.deleteUser, getUserById: state.getUserById, generateLink: state.generateLink,
  } } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("opaque visitor tokens and reuse", () => {
  it("reuses an unexpired completed visit without creating accounts or storing the raw token", async () => {
    const result = await getOrCreateDemoVisit(visitorToken, new Headers());
    expect(result).toEqual({ visit: completedVisit, token: visitorToken });
    expect(state.createUser).not.toHaveBeenCalled();
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(rpcBody(state.fetch.mock.calls[0])).toEqual({ p_token_hash: createHash("sha256").update(visitorToken).digest("hex") });
    expect(JSON.stringify(state.fetch.mock.calls)).not.toContain(visitorToken);
  });
  it.each([undefined, "", "arbitrary-user-id", "A".repeat(64), `${visitorToken}/extra`])(
    "invalid visitor tokens cannot select an account", async (token) => {
      const result = await getOrCreateDemoVisit(token, new Headers());
      expect(result.token).toMatch(/^[a-f0-9]{64}$/);
      expect(result.token).not.toBe(token);
      expect(rpcName(state.fetch.mock.calls[0][0])).toBe("demo_create_session");
      expect(state.createUser).toHaveBeenCalledTimes(DEMO_IDENTITIES.length);
      expect(rpcBody(rpcCalls("demo_create_session")[0]).p_token_hash).toBe(demoTokenHash(result.token));
      expect(JSON.stringify(state.fetch.mock.calls)).not.toContain(result.token);
    },
  );
  it.each([
    { ...completedVisit, expires_at: "2000-01-01T00:00:00.000Z" },
    createdVisit,
    null,
  ])("does not reuse expired, incomplete or missing visits", async (existing) => {
    state.fetch.mockImplementationOnce(async () => json(existing));
    const result = await getOrCreateDemoVisit(visitorToken, new Headers());
    expect(result.token).not.toBe(visitorToken);
    expect(state.createUser).toHaveBeenCalledTimes(DEMO_IDENTITIES.length);
    expect(rpcCalls("demo_create_session")).toHaveLength(1);
  });
  it("uses a shared HMAC quota until proxy identity trust is explicit", async () => {
    await getOrCreateDemoVisit(undefined, new Headers({ "cf-connecting-ip": "198.51.100.42" }));
    const body = rpcBody(rpcCalls("demo_create_session")[0]);
    expect(body.p_rate_key).toBe(createHmac("sha256", rateSecret).update("shared").digest("hex"));
    expect(JSON.stringify(state.fetch.mock.calls)).not.toContain("198.51.100.42");
  });
  it("hashes the client address when the reverse-proxy trust contract is enabled", async () => {
    vi.stubEnv("WORKFARE_DEMO_TRUST_CLOUDFLARE", "true");
    await getOrCreateDemoVisit(undefined, new Headers({ "cf-connecting-ip": "198.51.100.42" }));
    expect(rpcBody(rpcCalls("demo_create_session")[0]).p_rate_key).toBe(createHmac("sha256", rateSecret).update("198.51.100.42").digest("hex"));
    expect(JSON.stringify(state.fetch.mock.calls)).not.toContain("198.51.100.42");
  });
  it("refuses disabled or production-bound provisioning before any client/network activity", async () => {
    vi.stubEnv("WORKFARE_DEMO_ENABLED", "false");
    await expect(getOrCreateDemoVisit(undefined, new Headers())).rejects.toThrow();
    vi.stubEnv("WORKFARE_DEMO_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fqaditikccbxivpxukxp.supabase.co");
    await expect(getOrCreateDemoVisit(undefined, new Headers())).rejects.toThrow();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.getSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

describe("complete provisioning and rollback", () => {
  it("seeds only freshly created visitor-owned auth IDs with server-owned identity metadata", async () => {
    const result = await getOrCreateDemoVisit(undefined, new Headers());
    expect(result.visit).toEqual(completedVisit);
    for (const identity of DEMO_IDENTITIES) {
      expect(state.createUser).toHaveBeenCalledWith(expect.objectContaining({
        email: userFor(identity).email, email_confirm: true,
        app_metadata: { demo_session_id: visitId, demo_identity: identity },
      }));
    }
    expect(rpcBody(rpcCalls("demo_seed_session")[0])).toEqual({ p_session_id: visitId, p_identities: identities });
    expect(state.deleteUser).not.toHaveBeenCalled();
  });
  it("waits for late Auth creations before revoking and cleaning the complete visit", async () => {
    let finishLate!: () => void;
    const late = new Promise<void>((resolve) => { finishLate = resolve; });
    state.createUser.mockImplementation(async ({ app_metadata }: { app_metadata: { demo_identity: DemoIdentity } }) => {
      const identity = app_metadata.demo_identity;
      if (identity === "company") return { data: { user: null }, error: new Error("Fixture creation failure") };
      if (identity === "peer-seeker") await late;
      return { data: { user: userFor(identity) }, error: null };
    });
    const pending = getOrCreateDemoVisit(undefined, new Headers());
    await vi.waitFor(() => expect(state.createUser).toHaveBeenCalledTimes(DEMO_IDENTITIES.length));
    expect(state.deleteUser).not.toHaveBeenCalled();
    finishLate();
    await expect(pending).rejects.toThrow("Demo profile creation failed");
    expect(rpcCalls("demo_seed_session")).toHaveLength(0);
    expect(rpcBody(rpcCalls("demo_expire_session")[0])).toEqual({ p_session_id: visitId });
    expect(rpcBody(rpcCalls("demo_cleanup_expired_sessions")[0])).toEqual({ p_limit: 100 });
    expect(state.deleteUser).not.toHaveBeenCalled();
    const names = state.fetch.mock.calls.map(([url]) => rpcName(url));
    expect(names.indexOf("demo_expire_session")).toBeLessThan(names.indexOf("demo_cleanup_expired_sessions"));
  });
  it("expires the visit and uses graph cleanup if database seeding fails", async () => {
    state.fetch.mockImplementation(async (input: string) => rpcName(input) === "demo_seed_session" ? json({}, 500) : defaultRpc(input));
    await expect(getOrCreateDemoVisit(undefined, new Headers())).rejects.toThrow("Demo database operation failed");
    expect(rpcCalls("demo_expire_session")).toHaveLength(1);
    expect(rpcCalls("demo_cleanup_expired_sessions")).toHaveLength(1);
    expect(state.deleteUser).not.toHaveBeenCalled();
  });
  it("still requests database cleanup if session expiry fails during rollback", async () => {
    state.fetch.mockImplementation(async (input: string) => ["demo_seed_session", "demo_expire_session"].includes(rpcName(input)!) ? json({}, 500) : defaultRpc(input));
    await expect(getOrCreateDemoVisit(undefined, new Headers())).rejects.toThrow("Demo database operation failed");
    expect(rpcCalls("demo_cleanup_expired_sessions")).toHaveLength(1);
    expect(state.deleteUser).not.toHaveBeenCalled();
  });
  it("preserves the provisioning error and leaves Auth markers for scheduled cleanup if rollback fails", async () => {
    state.fetch.mockImplementation(async (input: string) => ["demo_seed_session", "demo_expire_session", "demo_cleanup_expired_sessions"].includes(rpcName(input)!) ? json({}, 500) : defaultRpc(input));
    await expect(getOrCreateDemoVisit(undefined, new Headers())).rejects.toThrow("demo_seed_session");
    expect(rpcCalls("demo_cleanup_expired_sessions")).toHaveLength(1);
    expect(state.deleteUser).not.toHaveBeenCalled();
  });
  it("rolls back instead of exposing a visit whose completed identities are absent", async () => {
    state.fetch.mockImplementation(async (input: string) => rpcName(input) === "demo_get_session" ? json(createdVisit) : defaultRpc(input));
    await expect(getOrCreateDemoVisit(undefined, new Headers())).rejects.toThrow("Demo profiles are incomplete");
    expect(rpcCalls("demo_expire_session")).toHaveLength(1);
    expect(rpcCalls("demo_cleanup_expired_sessions")).toHaveLength(1);
    expect(state.deleteUser).not.toHaveBeenCalled();
  });
});

describe("login token is bound to the visitor's actual Auth identity", () => {
  it.each(DEMO_ROLES)("generates a server-only OTP for the visit's %s account", async (role) => {
    expect(await getDemoLoginToken(completedVisit, role)).toBe("fixture-hashed-otp");
    expect(state.getUserById).toHaveBeenCalledExactlyOnceWith(identities[role]);
    expect(state.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "magiclink", email: userFor(role).email });
  });
  it("cannot mint a token for an arbitrary UID injected into a visit object", async () => {
    const altered = { ...completedVisit, identities: { ...identities, seeker: "00000000-0000-4000-8000-000000000099" } };
    await expect(getDemoLoginToken(altered, "seeker")).rejects.toThrow("Demo identity does not match this visit");
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it.each([
    { data: { user: null }, error: null },
    { data: { user: userFor("seeker") }, error: new Error("Fixture lookup failure") },
  ])("does not generate a token after an absent or failed Auth lookup", async (result) => {
    state.getUserById.mockResolvedValue(result);
    await expect(getDemoLoginToken(completedVisit, "seeker")).rejects.toThrow("Demo identity does not match this visit");
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it.each([
    { data: { user: userFor("company"), properties: { hashed_token: "wrong-identity-token" } }, error: null },
    { data: { user: userFor("seeker"), properties: {} }, error: null },
    { data: { user: userFor("seeker"), properties: { hashed_token: "fixture-token" } }, error: new Error("Fixture link failure") },
  ])("refuses a mismatched or incomplete generated login", async (result) => {
    state.generateLink.mockResolvedValue(result);
    await expect(getDemoLoginToken(completedVisit, "seeker")).rejects.toThrow("Demo login could not be created");
  });
});
