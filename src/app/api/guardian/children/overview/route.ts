import { assertGuardianOverviewOrigin, GuardianOverviewError, readGuardianChildOverview } from "@/lib/guardian/child-overview.server";
import type { GuardianChildView } from "@/lib/guardian/child-overview-types";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
    try {
        assertGuardianOverviewOrigin(request);
        const params = new URL(request.url).searchParams;
        if ([...params.keys()].some(key => !["childId", "view", "cursor"].includes(key) || params.getAll(key).length !== 1)) throw new GuardianOverviewError("invalid_request", 400);
        const view = params.get("view") ?? "active";
        if (view !== "active" && view !== "completed") throw new GuardianOverviewError("invalid_request", 400);
        return Response.json(await readGuardianChildOverview({ childId: params.get("childId") ?? "", view: view as GuardianChildView,
            cursor: params.get("cursor"), expectedOwnerId: request.headers.get("x-workfare-owner") ?? "" }), { headers });
    } catch (error) {
        const known = error instanceof GuardianOverviewError;
        const code = known ? error.code : "overview_unavailable";
        const message = code === "authentication_required" ? "Bitte melde dich erneut an."
            : code === "owner_context_changed" ? "Bitte öffne die Familienübersicht nach deiner Anmeldung erneut."
                : code === "child_forbidden" ? "Diese Übersicht ist für dein Konto nicht freigegeben."
                    : "Die Familienübersicht konnte gerade nicht geladen werden.";
        return Response.json({ code, error: message }, { status: known ? error.status : 503, headers });
    }
}
