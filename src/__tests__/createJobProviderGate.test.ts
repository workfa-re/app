import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, create: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("@/lib/dal/platform", () => ({ createJob: state.create, getEffectiveView: async () => ({ ok: true, data: { viewRole: "job_provider", roles: [] } }) }));
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
    });

    it.each(["none", "pending", "rejected"])("does not let a stale timestamp override %s", async status => {
        state.profile.provider_verification_status = status;
        expect(await createJob(null, validJob())).toMatchObject({ status: "error", error: { message: "Dein Anbieterprofil muss vor der Veröffentlichung geprüft sein." } });
        expect(state.create).not.toHaveBeenCalled();
    });

    it("requires the recorded verification time as well as the verified status", async () => {
        state.profile.provider_verified_at = null;
        expect(await createJob(null, validJob())).toMatchObject({ status: "error" });
        expect(state.create).not.toHaveBeenCalled();
    });

    it("still creates a valid offer after a complete provider verification", async () => {
        await expect(createJob(null, validJob())).rejects.toThrow("REDIRECT:/app-home/offers");
        expect(state.create).toHaveBeenCalledOnce();
        expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ job: expect.objectContaining({ posted_by: "provider", status: "open" }) }));
    });
});
