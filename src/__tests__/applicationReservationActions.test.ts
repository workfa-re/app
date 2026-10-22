import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));

import { applyToJob } from "@/app/app-home/jobs/actions";
import { rejectApplication, withdrawApplication } from "@/app/app-home/applications/actions";

const jobId = "00000000-0000-4000-8000-000000000001";
const applicationId = "00000000-0000-4000-8000-000000000002";

describe("exclusive reservation actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUser.mockResolvedValue({ data: { user: { id: "seeker" } }, error: null });
        mocks.rpc.mockResolvedValue({ data: { ok: true, is_primary: true, application: { id: applicationId, status: "negotiating" } }, error: null });
    });

    it("opens only a database-confirmed primary reservation and returns its real conversation ID", async () => {
        const result = await applyToJob(jobId);
        expect(result).toEqual({ success: true, application: { id: applicationId, status: "negotiating" } });
        expect(mocks.rpc).toHaveBeenCalledWith("submit_job_application", { p_job_id: jobId, p_message: "Ich interessiere mich für diesen Job." });
        expect(mocks.revalidate).toHaveBeenCalledWith("/app-home/jobs");
    });

    it.each([
        {},
        { ok: true, application: null },
        { ok: true, is_primary: false, application: { id: applicationId, status: "waitlisted" } },
        { ok: true, is_primary: true, application: { id: applicationId, status: "rejected" } },
    ])("never announces an unconfirmed or legacy queued application as reserved", async payload => {
        mocks.rpc.mockResolvedValue({ data: payload, error: null });
        expect(await applyToJob(jobId)).toHaveProperty("error");
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it("keeps a concurrent-claim refusal visible and never tries to join a queue", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: false, error: "Dieser Job ist bereits reserviert." }, error: null });
        expect(await applyToJob(jobId)).toEqual({ error: "Dieser Job ist bereits reserviert." });
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it("requires authentication before applying", async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        expect(await applyToJob(jobId)).toEqual({ error: "Nicht authentifiziert." });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("lets the provider decline and release without requiring a written explanation", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: true, job_id: jobId }, error: null });
        expect(await rejectApplication(applicationId)).toHaveProperty("success", true);
        expect(mocks.rpc).toHaveBeenCalledWith("reject_application", { p_application_id: applicationId, p_reason: null });
        expect(mocks.revalidate).toHaveBeenCalledWith("/app-home/offers/[jobId]", "page");
    });

    it("keeps an optional reason bounded and never sends an oversized one", async () => {
        expect(await rejectApplication(applicationId, "x".repeat(501))).toHaveProperty("error");
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("does not attribute an invented reason to the person withdrawing", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
        expect(await withdrawApplication(applicationId)).toHaveProperty("success", true);
        expect(mocks.rpc).toHaveBeenCalledWith("withdraw_application", { p_application_id: applicationId, p_reason: null });
    });

    it.each([rejectApplication, withdrawApplication])("does not close the UI or refresh until a release is confirmed", async action => {
        mocks.rpc.mockResolvedValue({ data: {}, error: null });
        expect(await action(applicationId)).toHaveProperty("error");
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it("preserves an authorization refusal and refreshes neither role's pages", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: false, error: "Keine Berechtigung." }, error: null });
        expect(await rejectApplication(applicationId)).toEqual({ error: "Keine Berechtigung." });
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });
});
