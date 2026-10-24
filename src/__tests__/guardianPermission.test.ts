import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), configured: vi.fn(), code: vi.fn(), receipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/guardian/permission-mail.server", () => ({ guardianMailConfigured: mock.configured, sendGuardianCode: mock.code, sendGuardianReceipt: mock.receipt }));
import { loadPermissionPreview, requestPermissionCode, submitPermission, revokePermission } from "@/lib/guardian/permission.server";
import { GUARDIAN_DECLARATION_VERSION } from "@/lib/guardian/types";

const token = "a".repeat(64), receipt = "b".repeat(64), challengeId = "d1796378-5778-44a1-b427-07e3d48c8c0e";
const input = { token, receipt, challengeId, code: "12345678", fullName: "Paula Beispiel", relationshipType: "mother", adultConfirmed: true, accepted: true, declarationVersion: GUARDIAN_DECLARATION_VERSION };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ready = { ready: true, release: "workfare-guardian-permission-v1", revision: "20261024173209" };
describe("accountless email-confirmed guardian permission", () => {
    beforeEach(() => {
        vi.resetAllMocks(); mock.configured.mockReturnValue(true); mock.code.mockResolvedValue(undefined); mock.receipt.mockResolvedValue(undefined);
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.workfa.re");
        mock.rpc.mockImplementation(async name => ({ data: name === "get_guardian_permission_readiness" ? ready : { ok: true }, error: null }));
    });
    afterEach(() => vi.unstubAllEnvs());
    it("closes the accountless email path before any database operation when mail is not configured", async () => {
        mock.configured.mockReturnValue(false);
        expect(await requestPermissionCode({ token, email: "parent@example.invalid" })).toMatchObject({ ok: false, code: "mail_unavailable" });
        expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.code).not.toHaveBeenCalled();
    });
    it("requires its own completed schema capability before privileged operations", async () => {
        mock.rpc.mockResolvedValue({ data: { ...ready, revision: "old" }, error: null });
        expect((await requestPermissionCode({ token, email: "parent@example.invalid" })).ok).toBe(false);
        expect(mock.rpc).toHaveBeenCalledOnce(); expect(mock.code).not.toHaveBeenCalled();
    });
    it("sends only an eight-digit code, persisting a salted hash instead of raw credentials", async () => {
        const result = await requestPermissionCode({ token, email: " PARENT@example.invalid " });
        expect(result.ok).toBe(true);
        const [name, args] = mock.rpc.mock.calls[1];
        expect(name).toBe("prepare_guardian_permission"); expect(args.p_email).toBe("parent@example.invalid");
        const [email, code] = mock.code.mock.calls[0];
        expect(email).toBe("parent@example.invalid"); expect(code).toMatch(/^\d{8}$/);
        expect(args.p_code_hash).toBe(sha(`${args.p_challenge}:${code}`));
        expect(JSON.stringify(result)).not.toContain(code); expect(JSON.stringify(args)).not.toContain(`"${code}"`);
        expect(mock.rpc.mock.calls.every(([rpc]) => !/profile|auth|relationship/.test(rpc))).toBe(true);
    });
    it("does not deliver a code when the DB enforces cooldown or rejects the child's own email", async () => {
        mock.rpc.mockImplementation(async name => ({ data: name === "get_guardian_permission_readiness" ? ready : { ok: false, code: "permission_rate_limited" }, error: null }));
        expect(await requestPermissionCode({ token, email: "parent@example.invalid" })).toMatchObject({ ok: false, code: "permission_rate_limited" });
        expect(mock.code).not.toHaveBeenCalled();
    });
    it.each([{ ...input, declarationVersion: "old" }, { ...input, accepted: false }, { ...input, adultConfirmed: false }, { ...input, userId: challengeId }, { ...input, code: "bad" }])("rejects invalid scope/acceptance or target-bearing payloads before DB", async value => {
        expect((await submitPermission(value)).ok).toBe(false); expect(mock.rpc).not.toHaveBeenCalled();
    });
    it("commits only the current declaration and sends receipt only to the database-confirmed parent mailbox", async () => {
        mock.rpc.mockImplementation(async name => ({ data: name === "get_guardian_permission_readiness" ? ready : { ok: true, parentEmail: "verified-parent@example.invalid", reused: false }, error: null }));
        expect(await submitPermission(input)).toEqual({ ok: true, receipt, receiptSent: true });
        expect(mock.rpc.mock.calls[1]).toEqual(["submit_guardian_permission", { p_token: token, p_challenge: challengeId, p_code_hash: sha(`${challengeId}:12345678`), p_name: "Paula Beispiel", p_relationship: "mother", p_accepted: true, p_adult_confirmed: true, p_version: GUARDIAN_DECLARATION_VERSION, p_receipt_hash: sha(receipt) }]);
        expect(mock.receipt).toHaveBeenCalledWith("verified-parent@example.invalid", `https://app.workfa.re/guardian/permission#receipt=${receipt}`);
    });
    it("never reports a false rollback when confirmation mail fails after the database commit", async () => {
        mock.rpc.mockImplementation(async name => ({ data: name === "get_guardian_permission_readiness" ? ready : { ok: true, parentEmail: "verified-parent@example.invalid", reused: false }, error: null }));
        mock.receipt.mockRejectedValue(new Error("private SMTP diagnostics"));
        expect(await submitPermission(input)).toEqual({ ok: true, receipt, receiptSent: false });
    });
    it("a lost-response retry keeps its prechosen receipt without resending or inventing delivery", async () => {
        mock.rpc.mockImplementation(async name => ({ data: name === "get_guardian_permission_readiness" ? ready : { ok: true, reused: true }, error: null }));
        expect(await submitPermission(input)).toEqual({ ok: true, receipt, receiptSent: false });
        expect(mock.receipt).not.toHaveBeenCalled();
    });
    it("validates the minimal token preview without exposing family or parent PII", async () => {
        const preview = { ok: true, direction: "child_to_guardian", childName: "Mila", minorRequired: true, status: "available", expiresAt: "2026-10-26T12:00:00Z" };
        mock.rpc.mockImplementation(async name => ({ data: name === "get_guardian_permission_readiness" ? ready : { ...preview, email: "never-returned@example.invalid", birthdate: "2010-01-01" }, error: null }));
        expect(await loadPermissionPreview({ token })).toEqual({ ok: true, preview, emailAvailable: true });
    });
    it("revokes only by its own unpredictable receipt and does not fabricate a target ID", async () => {
        expect(await revokePermission(receipt)).toEqual({ ok: true });
        expect(mock.rpc.mock.calls[1]).toEqual(["revoke_guardian_permission", { p_receipt: receipt }]);
        mock.rpc.mockClear(); expect((await revokePermission("bad")).ok).toBe(false); expect(mock.rpc).not.toHaveBeenCalled();
    });
    it("recovers a browser receipt after lost response while allowing the precommit original invitation", async () => {
        const preview = { ok: true, direction: "child_to_guardian", childName: "Mila", minorRequired: true, status: "available", expiresAt: "2026-10-26T12:00:00Z" };
        mock.rpc.mockImplementation(async (name, args) => ({ data: name === "get_guardian_permission_readiness" ? ready : args.p_receipt ? { ok: false } : preview, error: null }));
        expect(await loadPermissionPreview({ token, receipt })).toMatchObject({ ok: true, preview });
        expect(mock.rpc).toHaveBeenCalledWith("get_guardian_permission_context", { p_token: token, p_receipt: receipt });
        expect(mock.rpc).toHaveBeenCalledWith("get_guardian_permission_context", { p_token: token, p_receipt: null });
    });
});
