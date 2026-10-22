import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { getAppointmentRequests, manageJobAppointment } from "@/app/app-home/applications/actions";

const id = "00000000-0000-4000-8000-000000000001";
describe("appointment server actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
        const query = { select: mocks.select, eq: mocks.eq, order: mocks.order, limit: mocks.limit };
        mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query); mocks.order.mockReturnValue(query);
        mocks.limit.mockResolvedValue({ data: [], error: null });
        mocks.rpc.mockResolvedValue({ data: { ok: true, appointment: { id, starts_at: "2026-10-24T13:00:00.000Z" } }, error: null });
    });
    afterEach(() => vi.useRealTimers());

    it("serializes a bounded edited appointment through the authenticated atomic RPC", async () => {
        const result = await manageJobAppointment({ applicationId: id, action: "update", appointmentId: id, startsAt: "2026-10-24T15:00:00+02:00", endsAt: "2026-10-24T16:00:00+02:00", note: "  Gate at the side  " });
        expect(result).toMatchObject({ ok: true, appointment: { id } });
        expect(mocks.rpc).toHaveBeenCalledWith("manage_job_appointment", { p_application_id: id, p_action: "update", p_appointment_id: id, p_request_id: null, p_starts_at: "2026-10-24T13:00:00.000Z", p_ends_at: "2026-10-24T14:00:00.000Z", p_note: "Gate at the side" });
        expect(mocks.revalidate).toHaveBeenCalledWith("/app-home/activities");
    });
    it("accepts only the persisted proposal rather than caller-provided replacement dates", async () => {
        await manageJobAppointment({ applicationId: id, action: "accept", requestId: id, startsAt: "invalid", endsAt: "invalid" });
        expect(mocks.rpc).toHaveBeenCalledWith("manage_job_appointment", expect.objectContaining({ p_request_id: id, p_starts_at: null, p_ends_at: null }));
    });
    it("rejects bad input before any RPC or invalidation", async () => {
        expect(await manageJobAppointment({ applicationId: id, action: "update", appointmentId: id, startsAt: "invalid" })).toHaveProperty("error");
        expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
    });
    it("preserves an authorization or stale-proposal database refusal", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: false, error: "Der Termin wurde inzwischen geändert." }, error: null });
        expect(await manageJobAppointment({ applicationId: id, action: "accept", requestId: id })).toEqual({ error: "Der Termin wurde inzwischen geändert." });
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });
    it("does not report unconfirmed or failed mutations as saved", async () => {
        mocks.rpc.mockResolvedValue({ data: {}, error: null });
        expect(await manageJobAppointment({ applicationId: id, action: "cancel", appointmentId: id })).toHaveProperty("error", "Die Terminänderung wurde nicht bestätigt.");
        mocks.rpc.mockResolvedValue({ data: null, error: { message: "private internal database detail" } });
        const result = await manageJobAppointment({ applicationId: id, action: "cancel", appointmentId: id });
        expect(result).toEqual({ error: "Die Terminänderung konnte nicht gespeichert werden." });
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });
    it("normalizes an empty SQL record to null so requesting cannot inject a phantom appointment", async () => {
        mocks.rpc.mockResolvedValue({ data: { ok: true, appointment: { id: null, starts_at: null } }, error: null });
        expect(await manageJobAppointment({ applicationId: id, action: "decline", requestId: id })).toHaveProperty("appointment", null);
    });
    it("reads only the current conversation's pending proposal and handles an unavailable migration", async () => {
        expect(await getAppointmentRequests(id)).toEqual({ available: true, requests: [] });
        expect(mocks.from).toHaveBeenCalledWith("job_appointment_requests");
        expect(mocks.eq).toHaveBeenCalledWith("application_id", id);
        expect(mocks.eq).toHaveBeenCalledWith("status", "pending");
        expect(mocks.limit).toHaveBeenCalledWith(1);
        mocks.limit.mockResolvedValue({ data: null, error: { code: "PGRST205" } });
        expect(await getAppointmentRequests(id)).toEqual({ available: false, error: "Terminanfragen konnten nicht geladen werden." });
    });
});
