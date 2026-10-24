import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    job: {} as Record<string, unknown>, payment: vi.fn(), rpc: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCompleteProfile: async () => ({ profile: { id: "own-provider" } }) }));
vi.mock("@/lib/payments/repository.server", () => ({ getPaymentSettingsSnapshot: state.payment }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({
    rpc: state.rpc,
    from: () => {
        const query = { select: () => query, eq: () => query, single: async () => ({ data: state.job, error: null }) };
        return query;
    },
}) }));

import { updateJobAction } from "@/app/app-home/offers/edit/[jobId]/components/actions";
const jobId = "11111111-1111-4111-8111-111111111111";
function validForm(status = "open") {
    const form = new FormData();
    for (const [key, value] of Object.entries({ title: "Gartenhilfe gesucht", description: "Diese Beschreibung wird vor der Einrichtung gespeichert.", wage_hourly: "24.50",
        category: "garden", payment_type: "hourly", reach: "extended", status, job_kind: "one_time", recurrence_rule: "", continuity_preferred: "false" })) form.set(key, value);
    return form;
}
beforeEach(() => {
    vi.clearAllMocks();
    state.job = { posted_by: "own-provider", status: "draft", job_kind: "one_time" };
    state.payment.mockResolvedValue({ featureEnabled: false, buyerReady: false });
    state.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("edit publication checks the private buyer evidence", () => {
    it("preserves normal draft publication while the payment feature is disabled", async () => {
        expect(await updateJobAction(jobId, validForm())).toEqual({ success: true });
        expect(state.rpc).toHaveBeenCalledWith("update_owned_job_details", expect.objectContaining({ p_status: "open", p_expected_status: "draft" }));
    });

    it.each(["draft", "closed"])("blocks publication of a %s without an active buyer method", async status => {
        state.job.status = status;
        state.payment.mockResolvedValue({ featureEnabled: true, buyerReady: false });
        expect(await updateJobAction(jobId, validForm())).toMatchObject({ success: false, code: "buyer_payment_required" });
        expect(state.rpc).not.toHaveBeenCalled();
    });

    it.each(["draft", "closed"])("can persist edits as %s before leaving for setup without any payment prerequisite", async status => {
        state.job.status = status;
        expect(await updateJobAction(jobId, validForm(status))).toEqual({ success: true });
        expect(state.payment).not.toHaveBeenCalled();
        expect(state.rpc).toHaveBeenCalledWith("update_owned_job_details", expect.objectContaining({ p_status: status, p_description: "Diese Beschreibung wird vor der Einrichtung gespeichert." }));
    });

    it("allows reopening after current server evidence confirms the buyer method", async () => {
        state.job.status = "closed";
        state.payment.mockResolvedValue({ featureEnabled: true, buyerReady: true });
        expect(await updateJobAction(jobId, validForm())).toEqual({ success: true });
        expect(state.rpc).toHaveBeenCalledOnce();
    });

    it("does not impose a new payment gate on edits to an already public job", async () => {
        state.job.status = "open";
        expect(await updateJobAction(jobId, validForm())).toEqual({ success: true });
        expect(state.payment).not.toHaveBeenCalled();
    });

    it("does not read buyer evidence or update a foreign job", async () => {
        state.job.posted_by = "someone-else";
        expect(await updateJobAction(jobId, validForm())).toMatchObject({ success: false });
        expect(state.payment).not.toHaveBeenCalled();
        expect(state.rpc).not.toHaveBeenCalled();
    });

    it("explains a payment-method removal racing the final database publication check", async () => {
        state.payment.mockResolvedValue({ featureEnabled: true, buyerReady: true });
        state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "buyer_payment_required" } });
        const result = await updateJobAction(jobId, validForm());
        expect(result).toMatchObject({ success: false, code: "buyer_payment_required" });
        expect("error" in result && result.error).not.toContain("42501");
    });

    it("keeps address approval separate from a ready buyer method during reopening", async () => {
        state.payment.mockResolvedValue({ featureEnabled: true, buyerReady: true });
        state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "provider_verification_required" } });
        expect(await updateJobAction(jobId, validForm())).toMatchObject({ success: false, code: "provider_verification_required", error: expect.stringContaining("Ergänze deine Adresse im Profil") });
    });
});


describe("one-off jobs cannot be converted into new recurring workflows", () => {
    it("rejects a forged one-off-to-recurring edit before reading payment data or writing", async () => {
        const form = validForm("draft"); form.set("job_kind", "recurring"); form.set("recurrence_rule", "weekly");
        expect(await updateJobAction(jobId, form)).toEqual({ success: false, error: "Aktuell kannst du nur einmalige Jobs erstellen." });
        expect(state.rpc).not.toHaveBeenCalled();
        expect(state.payment).not.toHaveBeenCalled();
    });
    it("retains existing recurring jobs and their explicit recurrence changes", async () => {
        state.job.job_kind = "recurring";
        const form = validForm("draft"); form.set("job_kind", "recurring"); form.set("recurrence_rule", "biweekly"); form.set("continuity_preferred", "true");
        expect(await updateJobAction(jobId, form)).toEqual({ success: true });
        expect(state.rpc).toHaveBeenCalledWith("update_owned_job_details", expect.objectContaining({ p_job_kind: "recurring", p_recurrence_rule: "biweekly", p_continuity_preferred: true }));
    });
    it("allows an owner to deliberately change an eligible legacy recurring job into a one-off", async () => {
        state.job.job_kind = "recurring";
        expect(await updateJobAction(jobId, validForm("draft"))).toEqual({ success: true });
        expect(state.rpc).toHaveBeenCalledWith("update_owned_job_details", expect.objectContaining({ p_job_kind: "one_time", p_recurrence_rule: null, p_continuity_preferred: false }));
    });
});
