import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/app/app-home/offers/edit/[jobId]/components/actions", () => ({ updateJobAction: state.update }));
import { submitJobEdit } from "@/app/app-home/offers/edit/[jobId]/components/jobEditSubmission";

const jobId = "11111111-1111-4111-8111-111111111111";
function edits() {
    const form = new FormData();
    for (const [key, value] of Object.entries({ title: "Frisch geänderter Job", description: "Diese neue Beschreibung muss nach der Einrichtung noch da sein.",
        category: "garden", wage_hourly: "24.50", payment_type: "fixed", reach: "extended", status: "open",
        job_kind: "recurring", recurrence_rule: "biweekly", continuity_preferred: "true" })) form.set(key, value);
    return form;
}
beforeEach(() => { vi.clearAllMocks(); state.update.mockResolvedValue({ success: true }); });

describe("lossless edit handoff to payment setup", () => {
    it.each(["draft", "closed"] as const)("saves all changes as %s before offering the payment return", async currentStatus => {
        const formData = edits();
        const result = await submitJobEdit({ jobId, currentStatus, formData, preparePayment: true });
        const [savedId, savedForm] = state.update.mock.calls[0];
        expect(savedId).toBe(jobId);
        expect(savedForm).not.toBe(formData);
        expect(Object.fromEntries(savedForm)).toEqual({ ...Object.fromEntries(formData), status: currentStatus });
        expect(formData.get("status")).toBe("open");
        expect(result).toEqual({ success: true, nextHref: `/app-home/settings/payments?returnTo=%2Fapp-home%2Foffers%2Fedit%2F${jobId}%3Fresume%3Dpayment` });
    });

    it("does not navigate or drop the edited text after a failed private save", async () => {
        state.update.mockResolvedValue({ success: false, error: "Der Job wurde inzwischen geändert." });
        const formData = edits();
        const before = [...formData];
        const result = await submitJobEdit({ jobId, currentStatus: "draft", formData, preparePayment: true });
        expect(result).toEqual({ success: false, error: "Der Job wurde inzwischen geändert." });
        expect(result).not.toHaveProperty("nextHref");
        expect([...formData]).toEqual(before);
    });

    it("keeps the normal publication unchanged when payment setup is not needed", async () => {
        const formData = edits();
        expect(await submitJobEdit({ jobId, currentStatus: "draft", formData, preparePayment: false }))
            .toEqual({ success: true, nextHref: "/app-home/offers" });
        expect(state.update.mock.calls[0][1].get("status")).toBe("open");
    });

    it.each(["open", "reserved", "filled"] as const)("never silently hides an existing %s job just to start setup", async currentStatus => {
        expect((await submitJobEdit({ jobId, currentStatus, formData: edits(), preparePayment: true })).success).toBe(false);
        expect(state.update).not.toHaveBeenCalled();
    });
});
