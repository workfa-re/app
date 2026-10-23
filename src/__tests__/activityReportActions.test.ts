import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityReportInput } from "@/lib/activity/reporting";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ rpc: mocks.rpc }) }));
import { reportActivityItem } from "@/app/app-home/applications/actions";

const applicationId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";
const contentId = "00000000-0000-4000-8000-000000000003";
const reportId = "00000000-0000-4000-8000-000000000004";
const base: ActivityReportInput = { applicationId, scope: "conversation", reasonCode: "safety", reportedUserId: personId };

describe("activity report actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.rpc.mockResolvedValue({ data: { ok: true, report_id: reportId }, error: null });
    });

    it("sends explicit scope and optional trimmed context through the authenticated RPC", async () => {
        expect(await reportActivityItem({ ...base, details: "  Bitte prüfen.  " })).toMatchObject({ ok: true, report_id: reportId });
        expect(mocks.rpc).toHaveBeenCalledWith("report_activity_item_scoped", {
            p_application_id: applicationId, p_scope: "conversation", p_reason_code: "safety",
            p_reported_user_id: personId, p_details: "Bitte prüfen.", p_message_id: null, p_reopen_request_id: null,
        });
        expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/app-home/activities");
    });

    it.each(["messageId", "reopenRequestId"] as const)("keeps a selected %s distinct from a person report", async target => {
        await reportActivityItem({ ...base, scope: "message", [target]: contentId });
        expect(mocks.rpc).toHaveBeenCalledWith("report_activity_item_scoped", expect.objectContaining({
            p_scope: "message", p_message_id: target === "messageId" ? contentId : null,
            p_reopen_request_id: target === "reopenRequestId" ? contentId : null, p_details: null,
        }));
    });

    it("preserves legacy actions by inferring person or selected-content scope", async () => {
        await reportActivityItem({ applicationId, reasonCode: "other" });
        expect(mocks.rpc).toHaveBeenLastCalledWith("report_activity_item_scoped", expect.objectContaining({ p_scope: "person" }));
        await reportActivityItem({ applicationId, reasonCode: "other", reopenRequestId: contentId });
        expect(mocks.rpc).toHaveBeenLastCalledWith("report_activity_item_scoped", expect.objectContaining({ p_scope: "message" }));
    });

    it.each([
        null,
        { ...base, applicationId: "not-an-id" },
        { ...base, reportedUserId: "not-an-id" },
        { ...base, scope: "job" },
        { ...base, scope: null },
        { ...base, scope: "message" },
        { ...base, scope: "message", messageId: contentId, reopenRequestId: contentId },
        { ...base, messageId: contentId },
        { ...base, scope: "person", reopenRequestId: contentId },
        { ...base, scope: "message", messageId: "not-an-id" },
        { ...base, reasonCode: "invented" },
        { ...base, details: 17 },
        { ...base, details: "x".repeat(1501) },
    ])("rejects malformed or ambiguous input without a mutation: %j", async input => {
        expect(await reportActivityItem(input as ActivityReportInput)).toHaveProperty("error");
        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it("preserves an authorized database refusal without claiming a saved report", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: false, error: "Nicht berechtigt." }, error: null });
        expect(await reportActivityItem(base)).toEqual({ error: "Nicht berechtigt." });
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it.each([null, {}, { ok: true }, { ok: true, report_id: "not-an-id" }, { ok: false, report_id: reportId }])("requires a confirmed persisted report identifier: %j", async data => {
        mocks.rpc.mockResolvedValue({ data, error: null });
        expect(await reportActivityItem(base)).toHaveProperty("error");
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it("keeps internal transport diagnostics private", async () => {
        mocks.rpc.mockResolvedValue({ data: null, error: { message: "private PostgreSQL detail" } });
        expect(await reportActivityItem(base)).toEqual({ error: "Die Meldung konnte nicht gesendet werden." });
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });
});
