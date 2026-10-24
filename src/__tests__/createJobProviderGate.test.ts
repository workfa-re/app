import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, create: vi.fn(), payment: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/platform", () => ({ createJob: state.create, getEffectiveView: async () => ({ ok: true, data: { viewRole: "job_provider", roles: [] } }) }));
vi.mock("@/lib/payments/repository.server", () => ({ getPaymentSettingsSnapshot: state.payment }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "provider" } } }) },
    from: () => {
        const builder = { select: () => builder, eq: () => builder, single: async () => ({ data: state.profile, error: null }) };
        return builder;
    },
}) }));

import { createJob } from "@/app/app-home/offers/actions";

function validJob() {
    const form = new FormData();
    for (const [key, value] of Object.entries({ title: "Rasen mähen", description: "Bitte den Rasen im Garten mähen.", category: "garden", wage: "18", use_default_location: "true" })) form.set(key, value);
    return form;
}

describe("provider job creation matches the database verification gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.profile = { account_type: "job_provider", market_id: "market", street: "Musterstraße", house_number: "1", zip: "53359", city: "Rheinbach", lat: 50.63, lng: 6.95, provider_verification_status: "verified", provider_verified_at: "2026-10-20T12:00:00Z" };
        state.create.mockResolvedValue({ ok: true, data: { id: "synthetic-job" } });
        state.payment.mockResolvedValue({ kind: "disabled", featureEnabled: false, buyerReady: false });
    });

    it.each(["rejected"])("does not let a stale timestamp override %s", async status => {
        state.profile.provider_verification_status = status;
        expect(await createJob(null, validJob())).toMatchObject({ status: "error", error: { message: "Bitte hinterlege zuerst deine vollständige Adresse im Profil." } });
        expect(state.create).not.toHaveBeenCalled();
    });

    it("still requires a complete address independently of any verification badge", async () => {
        state.profile.street = null;
        expect(await createJob(null, validJob())).toMatchObject({ status: "error" });
        expect(state.create).not.toHaveBeenCalled();
    });

    it.each(["none", "pending"])("accepts a complete address without a manual approval (%s)", async status => {
        state.profile.provider_verification_status = status;
        state.profile.provider_verified_at = null;
        expect(await createJob(null, validJob())).toEqual({ status: "success" });
        expect(state.create).toHaveBeenCalledOnce();
    });

    it("still creates a valid offer after a complete provider verification", async () => {
        await expect(createJob(null, validJob())).resolves.toEqual({ status: "success" });
        expect(state.create).toHaveBeenCalledOnce();
        expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ posted_by: "provider", status: "open" }) }));
    });

    it("preserves the production flow when the payment feature is disabled", async () => {
        await expect(createJob(null, validJob())).resolves.toEqual({ status: "success" });
        expect(state.payment).toHaveBeenCalledExactlyOnceWith("provider");
        expect(state.create).toHaveBeenCalledOnce();
    });

    it("blocks an active payment publication gate using server evidence, even when the client claims readiness", async () => {
        state.payment.mockResolvedValue({ kind: "local", featureEnabled: true, buyerReady: false });
        const form = validJob();
        form.set("buyer_payment_ready", "true");
        form.set("returnTo", "https://untrusted.example.invalid/");
        expect(await createJob(null, form)).toMatchObject({ status: "error", error: { code: "buyer_payment_required" } });
        expect(state.create).not.toHaveBeenCalled();
    });

    it("allows the verified provider to publish once its own server-side buyer setup is ready", async () => {
        state.payment.mockResolvedValue({ kind: "local", featureEnabled: true, buyerReady: true });
        await expect(createJob(null, validJob())).resolves.toEqual({ status: "success" });
        expect(state.create).toHaveBeenCalledOnce();
    });

    it("does not require payment setup to save a database draft", async () => {
        const form = validJob(); form.set("intent", "draft");
        await expect(createJob(null, form)).resolves.toEqual({ status: "success" });
        expect(state.payment).not.toHaveBeenCalled();
        expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ status: "draft" }) }));
    });

    it("never substitutes buyer payment readiness for a complete provider address", async () => {
        state.profile.provider_verification_status = "pending";
        state.profile.street = null;
        state.payment.mockResolvedValue({ kind: "local", featureEnabled: true, buyerReady: true });
        expect(await createJob(null, validJob())).toMatchObject({ status: "error", error: { message: "Bitte hinterlege zuerst deine vollständige Adresse im Profil." } });
        expect(state.payment).not.toHaveBeenCalled();
        expect(state.create).not.toHaveBeenCalled();
    });

    it.each([
        { job_kind: "recurring" },
        { job_kind: "one_time", recurrence_rule: "weekly" },
        { job_kind: "one_time", continuity_preferred: "true" },
    ])("rejects forged recurring creation metadata (%j) before any database write", async fields => {
        const form = validJob();
        for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value);
        expect(await createJob(null, form)).toMatchObject({ status: "error", error: { message: "Aktuell kannst du nur einmalige Jobs erstellen." } });
        expect(state.create).not.toHaveBeenCalled();
        expect(state.payment).not.toHaveBeenCalled();
    });

    it("persists new offers with one-off semantics even without client-supplied kind fields", async () => {
        expect(await createJob(null, validJob())).toEqual({ status: "success" });
        expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ job_kind: "one_time", recurrence_rule: null, continuity_preferred: false }) }));
    });

    it("never confirms success or clears a draft when the actual database creation failed", async () => {
        state.create.mockResolvedValue({ ok: false, error: { message: "Der Job konnte nicht gespeichert werden." } });
        const form = validJob();
        form.set("setup", "success");
        form.set("status", "success");
        expect(await createJob(null, form)).toEqual({ status: "error", error: { message: "Der Job konnte nicht gespeichert werden." } });
        expect(state.create).toHaveBeenCalledOnce();
    });
});
