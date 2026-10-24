import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingData } from "@/app/onboarding/actions";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn(), user: { id: "provider" } as { id: string } | null }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) }, rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { completeOnboarding } from "@/app/onboarding/actions";

const address = { street: " Musterweg ", houseNumber: " 4a ", city: " Rheinbach ", zip: " 53359 ", latitude: 50.63, longitude: 6.95 };
const provider: OnboardingData = { full_name: "Ada Beispiel", birthdate: "1985-01-01", role: "adult", city: "Rheinbach", market_id: "market", address };

describe("provider onboarding stores the profile and private address atomically", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: "provider" };
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });
  it("sends a complete provider to one database operation, trimming its address", async () => {
    expect(await completeOnboarding(provider)).toEqual({ success: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("complete_provider_onboarding", expect.objectContaining({ p_provider_kind: "private", p_street: "Musterweg", p_house_number: "4a", p_address_city: "Rheinbach", p_zip: "53359", p_lat: 50.63, p_lng: 6.95 }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/app-home", "layout");
  });
  it.each([undefined, { ...address, houseNumber: "" }, { ...address, latitude: null }])("cannot complete a provider without a valid address (%j)", async value => {
    expect(await completeOnboarding({ ...provider, address: value })).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("does not require or store a young jobseeker's private address", async () => {
    expect(await completeOnboarding({ ...provider, role: "youth", birthdate: "2010-01-01", address: undefined })).toEqual({ success: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("complete_profile_onboarding", expect.objectContaining({ p_account_type: "job_seeker", p_provider_kind: null }));
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("p_street");
  });
  it("validates the provider birthdate before the authoritative database age guard", async () => {
    expect(await completeOnboarding({ ...provider, birthdate: "2012-01-01" })).toEqual({ error: "Für diese Rolle musst du mindestens 18 Jahre alt sein." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("cannot turn a failed database address save into successful completion", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error: "invalid_address" }, error: null });
    expect(await completeOnboarding(provider)).toHaveProperty("error");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("includes validated organisation contact fields in the same operation", async () => {
    expect(await completeOnboarding({ ...provider, role: "company", company_name: "Beispiel e.V.", company_email: "team@example.invalid", company_message: "Wir suchen Unterstützung." })).toEqual({ success: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("complete_provider_onboarding", expect.objectContaining({ p_provider_kind: "company", p_company_name: "Beispiel e.V.", p_company_contact_email: "team@example.invalid" }));
  });
  it("rejects malformed external payloads without crashing or touching profile data", async () => {
    for (const value of [{ ...provider, role: "unrecognised" }, { ...provider, full_name: null }, { ...provider, role: "company", company_name: 17 }]) {
      expect(await completeOnboarding(value as unknown as OnboardingData)).toHaveProperty("error");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a real authenticated session", async () => {
    mocks.user = null;
    expect(await completeOnboarding(provider)).toEqual({ error: "Keine aktive Session gefunden." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
