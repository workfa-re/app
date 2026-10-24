import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: vi.fn() }));
import { missingGuardianRpc, readGuardianSchemaState } from "@/lib/guardian/schema-readiness.server";
const missing = (name: string) => ({ code: "PGRST202", message: `Could not find the function public.${name} without parameters in the schema cache` });
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as Parameters<typeof readGuardianSchemaState>[0];
describe("explicit family-purpose schema readiness", () => {
    it("requires the installed release and revision marker", async () => {
        const rpc = vi.fn().mockResolvedValue({ data: { ready: true, release: "workfare-guardian-purpose-v1", revision: "20261024101749" }, error: null });
        expect(await readGuardianSchemaState(client(rpc))).toBe("ready"); expect(rpc).toHaveBeenCalledOnce();
    });
    it.each([null, { ready: true }, { ready: true, release: "future-release", revision: "20261024101749" }, { ready: true, release: "workfare-guardian-purpose-v1", revision: "old" }])("does not infer readiness from an invalid response", async data => {
        expect(await readGuardianSchemaState(client(vi.fn().mockResolvedValue({ data, error: null })))).toBe("unavailable");
    });
    it("accepts legacy only after both explicit readiness and purpose-context RPC are missing", async () => {
        const rpc = vi.fn().mockImplementation(async name => ({ data: null, error: missing(name) }));
        expect(await readGuardianSchemaState(client(rpc))).toBe("legacy");
        expect(rpc.mock.calls.map(call => call[0])).toEqual(["get_guardian_schema_readiness", "get_guardian_access_context"]);
    });
    it.each([{ data: { authenticated: true }, error: null }, { data: null, error: { code: "42501", message: "permission denied" } }])("keeps a partial new deployment closed", async context => {
        const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: missing("get_guardian_schema_readiness") }).mockResolvedValueOnce(context);
        expect(await readGuardianSchemaState(client(rpc))).toBe("unavailable");
    });
    it.each([{ code: "42501" }, { code: "08006" }, { code: "PGRST202" }, { code: "42883", message: "function guardian_private.helper() does not exist" }])("never treats arbitrary errors as a legacy deployment", async error => {
        const rpc = vi.fn().mockResolvedValue({ data: null, error });
        expect(await readGuardianSchemaState(client(rpc))).toBe("unavailable"); expect(rpc).toHaveBeenCalledOnce();
    });
    it("distinguishes a missing target RPC from a missing nested function", () => {
        expect(missingGuardianRpc({ code: "42883", message: "function public.get_guardian_application_access() does not exist" }, "get_guardian_application_access")).toBe(true);
        expect(missingGuardianRpc({ code: "42883", message: "function guardian_private.application_access() does not exist" }, "get_guardian_application_access")).toBe(false);
        expect(missingGuardianRpc({ code: "42883", message: "function guardian_private.application_access() does not exist", details: "called by function public.get_guardian_application_access()" }, "get_guardian_application_access")).toBe(false);
    });
});
