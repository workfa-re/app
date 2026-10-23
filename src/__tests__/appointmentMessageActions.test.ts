import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), limit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: mocks.client }));
import { getAppointmentRequestForMessage } from "@/app/app-home/applications/actions";

const applicationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const senderId = "00000000-0000-4000-8000-000000000004";
const createdAt = "2026-10-23T12:00:00.123456+00:00";
const message = { id: messageId, application_id: applicationId, sender_id: senderId, kind: "system", content: "Ein weiterer Termin wurde angefragt.", created_at: createdAt, deleted_at: null };
const request = { id: requestId, application_id: applicationId, requested_by: senderId, created_at: createdAt, status: "declined" };

describe("appointment request lookup for a selected message", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const query = { select: mocks.select, eq: mocks.eq, limit: mocks.limit };
        mocks.client.mockResolvedValue({ from: mocks.from });
        mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query);
    });

    it("uses the authorized message and full SQL timestamp to find its historical request", async () => {
        mocks.limit.mockResolvedValueOnce({ data: [message], error: null }).mockResolvedValueOnce({ data: [request], error: null });
        expect(await getAppointmentRequestForMessage(applicationId, messageId)).toEqual({ available: true, request });
        expect(mocks.from.mock.calls).toEqual([["messages"], ["job_appointment_requests"]]);
        expect(mocks.eq).toHaveBeenCalledWith("id", messageId);
        expect(mocks.eq.mock.calls.filter(([column]) => column === "application_id")).toEqual([["application_id", applicationId], ["application_id", applicationId]]);
        expect(mocks.eq).toHaveBeenCalledWith("kind", "system");
        expect(mocks.eq).toHaveBeenCalledWith("requested_by", senderId);
        expect(mocks.eq).toHaveBeenCalledWith("created_at", createdAt);
        expect(mocks.eq).not.toHaveBeenCalledWith("status", "pending");
        expect(mocks.limit.mock.calls).toEqual([[1], [2]]);
    });

    it.each([
        { requests: [] },
        { requests: [request, { ...request, id: "00000000-0000-4000-8000-000000000005" }] },
    ])("never guesses when the matching request is missing or ambiguous", async ({ requests }) => {
        mocks.limit.mockResolvedValueOnce({ data: [message], error: null }).mockResolvedValueOnce({ data: requests, error: null });
        expect(await getAppointmentRequestForMessage(applicationId, messageId)).toEqual({ available: true, request: null });
    });

    it.each([
        null,
        { ...message, kind: "chat" },
        { ...message, content: "Der Termin wurde verbindlich vereinbart." },
        { ...message, content: "Eine unbekannte Systemnachricht" },
        { ...message, deleted_at: "2026-10-23T13:00:00Z" },
    ])("keeps unrelated, hidden or inaccessible messages from resolving the current request: %j", async selectedMessage => {
        mocks.limit.mockResolvedValueOnce({ data: selectedMessage ? [selectedMessage] : [], error: null });
        expect(await getAppointmentRequestForMessage(applicationId, messageId)).toEqual({ available: true, request: null });
        expect(mocks.from).toHaveBeenCalledTimes(1);
    });

    it("rejects malformed identifiers before creating a database client", async () => {
        expect(await getAppointmentRequestForMessage("not-an-id", messageId)).toMatchObject({ available: false, request: null });
        expect(await getAppointmentRequestForMessage(applicationId, "wrong")).toMatchObject({ available: false, request: null });
        expect(mocks.client).not.toHaveBeenCalled();
    });

    it.each(["messages", "requests", "rejected promise"])("returns a generic failure without exposing database internals: %s", async failure => {
        if (failure === "rejected promise") mocks.limit.mockRejectedValueOnce(new Error("private database detail"));
        else {
            if (failure === "requests") mocks.limit.mockResolvedValueOnce({ data: [message], error: null });
            mocks.limit.mockResolvedValueOnce({ data: null, error: { message: "private database detail" } });
        }
        expect(await getAppointmentRequestForMessage(applicationId, messageId)).toEqual({ available: false, request: null, error: "Die Terminanfrage konnte nicht geladen werden." });
    });
});
