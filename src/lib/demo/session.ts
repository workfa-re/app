import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDemoEnvironment } from "./environment";
import { DEMO_IDENTITIES, type DemoIdentity, type DemoRole } from "./roles";

export const DEMO_VISITOR_COOKIE = "wf-demo-visitor";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const visitSchema = z.object({
  id: z.string().uuid(),
  expires_at: z.string().datetime({ offset: true }),
  identities: z.object({
    seeker: z.string().uuid(),
    "private-provider": z.string().uuid(),
    company: z.string().uuid(),
    guardian: z.string().uuid(),
    "peer-seeker": z.string().uuid(),
  }).optional(),
});
export type DemoVisit = z.infer<typeof visitSchema>;

/** Private cookies and rate-limit keys never store the visitor's address in the database. */
export function demoTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function rateKey(headers: Headers): string {
  const secret = process.env.WORKFARE_DEMO_RATE_SECRET;
  if (!secret || secret.length < 32) throw new Error("Demo rate-limit secret is not configured.");
  // Only use a client-IP header when the deployment explicitly trusts its reverse proxy.
  // Without that contract, the database's shared quota remains the safe default.
  const address = process.env.WORKFARE_DEMO_TRUST_CLOUDFLARE === "true"
    ? headers.get("cf-connecting-ip")?.slice(0, 128) || "unknown"
    : "shared";
  return createHmac("sha256", secret).update(address).digest("hex");
}

async function demoRpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const env = requireDemoEnvironment();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Demo service credentials are not configured.");
  const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(parameters),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Demo database operation failed (${name}, ${response.status}).`);
  return response.json();
}

export async function getOrCreateDemoVisit(token: string | undefined, headers: Headers): Promise<{
  visit: DemoVisit & { identities: NonNullable<DemoVisit["identities"]> };
  token: string;
}> {
  requireDemoEnvironment();
  if (token && TOKEN_PATTERN.test(token)) {
    const existing = await demoRpc("demo_get_session", { p_token_hash: demoTokenHash(token) });
    if (existing) {
      const visit = visitSchema.parse(existing);
      if (visit.identities && new Date(visit.expires_at).getTime() > Date.now()) {
        return { visit: { ...visit, identities: visit.identities }, token };
      }
    }
  }

  const nextToken = randomBytes(32).toString("hex");
  const visit = visitSchema.parse(await demoRpc("demo_create_session", {
    p_token_hash: demoTokenHash(nextToken), p_rate_key: rateKey(headers),
  }));
  const admin = getSupabaseAdminClient();
  const identities: Partial<Record<DemoIdentity, string>> = {};
  // Collect all outcomes before cleanup, including requests that finish after another fails.
  const outcomes = await Promise.allSettled(DEMO_IDENTITIES.map(async (identity) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `demo+${visit.id}.${identity}@example.test`,
      email_confirm: true,
      password: randomBytes(32).toString("base64url"),
      app_metadata: { demo_session_id: visit.id, demo_identity: identity },
    });
    if (error || !data.user) throw new Error("Demo profile creation failed.");
    identities[identity] = data.user.id;
  }));

  try {
    if (outcomes.some((outcome) => outcome.status === "rejected")) throw new Error("Demo profile creation failed.");
    await demoRpc("demo_seed_session", { p_session_id: visit.id, p_identities: identities });
    const completed = visitSchema.parse(await demoRpc("demo_get_session", { p_token_hash: demoTokenHash(nextToken) }));
    if (!completed.identities) throw new Error("Demo profiles are incomplete.");
    return { visit: { ...completed, identities: completed.identities }, token: nextToken };
  } catch (error) {
    // Revoke first, then let the database remove profiles and Auth records together.
    // Deleting Auth users directly would orphan profiles created before persona binding.
    await demoRpc("demo_expire_session", { p_session_id: visit.id }).catch(() => undefined);
    await demoRpc("demo_cleanup_expired_sessions", { p_limit: 100 }).catch(() => undefined);
    throw error;
  }
}

export async function getDemoLoginToken(visit: DemoVisit & { identities: NonNullable<DemoVisit["identities"]> }, role: DemoRole): Promise<string> {
  requireDemoEnvironment();
  const userId = visit.identities[role];
  const email = `demo+${visit.id}.${role}@example.test`;
  const admin = getSupabaseAdminClient();
  const { data: identity, error: identityError } = await admin.auth.admin.getUserById(userId);
  if (identityError || identity.user?.email !== email) throw new Error("Demo identity does not match this visit.");
  // generateLink returns an OTP to the server; it does not send an email.
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || data.user?.id !== userId || !data.properties?.hashed_token) {
    throw new Error("Demo login could not be created.");
  }
  return data.properties.hashed_token;
}
