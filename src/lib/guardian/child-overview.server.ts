import "server-only";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertPaymentRequestHost } from "@/lib/payments/runtime.server";
import { guardianChildOverviewSchema, trustedGuardianAvatar, type GuardianChildOverviewSnapshot, type GuardianChildView } from "./child-overview-types";

export class GuardianOverviewError extends Error {
    constructor(readonly code: "authentication_required" | "owner_context_changed" | "child_forbidden" | "invalid_request" | "same_origin_required" | "overview_unavailable", readonly status: number) {
        super(code); this.name = "GuardianOverviewError";
    }
}
const uuid = z.uuid();
const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const nullableText = z.string().nullable();
const rawOverview = z.object({
    ownerId: uuid, child: z.object({ id: uuid, name: nullableText, avatarUrl: nullableText }).strict(), access: z.enum(["minor_jobs", "profile_only"]),
    counts: z.object({ active: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), contacts: z.number().int().nonnegative() }).strict().nullable(),
    view: z.enum(["active", "completed"]), jobs: z.array(z.object({ id: uuid, title: nullableText, status: z.enum(["reserved", "agreed", "completed"]),
        partner: z.object({ name: nullableText, avatarUrl: nullableText }).strict(), startsAt: stamp.nullable(), completedAt: stamp.nullable(), sortAt: stamp }).strict()).max(6), hasMore: z.boolean(),
}).strict();
const cursorSchema = z.object({ v: z.literal(1), childId: uuid, view: z.enum(["active", "completed"]), at: stamp, id: uuid }).strict();

export function guardianChildCursor(value: string | null, childId: string, view: GuardianChildView) {
    if (value === null) return null;
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new GuardianOverviewError("invalid_request", 400);
    try {
        const result = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
        if (!result.success || result.data.childId !== childId || result.data.view !== view) throw new Error();
        return result.data;
    } catch { throw new GuardianOverviewError("invalid_request", 400); }
}

/** Reuses the tested reverse-proxy host check without enabling or contacting any payment service. */
export function assertGuardianOverviewOrigin(request: Request, configuredOrigin = process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL) {
    try {
        const origin = new URL(configuredOrigin ?? "");
        if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
            || !["https:", "http:"].includes(origin.protocol)
            || origin.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error();
        assertPaymentRequestHost(request, { origin: origin.origin, mode: origin.protocol === "https:" ? "live" : "local_simulation" });
        const source = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
        if (source !== null && source !== origin.origin || site !== null && !["same-origin", "none"].includes(site)) throw new Error();
    } catch { throw new GuardianOverviewError("same_origin_required", 403); }
}

function cleanText(value: string | null, fallback: string, max = 120) {
    const cleaned = value?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
    return cleaned || fallback;
}
function displayName(value: string | null, fallback: string) {
    return value?.includes("@") ? fallback : cleanText(value, fallback);
}

export async function readGuardianChildOverview(input: { childId: string; view: GuardianChildView; cursor: string | null; expectedOwnerId: string }): Promise<GuardianChildOverviewSnapshot> {
    if (!uuid.safeParse(input.childId).success || !["active", "completed"].includes(input.view)) throw new GuardianOverviewError("invalid_request", 400);
    const cursor = guardianChildCursor(input.cursor, input.childId, input.view);
    const client = await supabaseServer();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user?.email_confirmed_at) throw new GuardianOverviewError("authentication_required", 401);
    if (!uuid.safeParse(input.expectedOwnerId).success || user.id !== input.expectedOwnerId) throw new GuardianOverviewError("owner_context_changed", 409);
    // Auth.uid() is the sole actor. An expected UI owner never selects a target guardian.
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)("get_guardian_child_overview", {
        p_child_id: input.childId, p_view: input.view, p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null,
    });
    if (error?.code === "42501") throw new GuardianOverviewError("child_forbidden", 403);
    if (error) throw new GuardianOverviewError("overview_unavailable", 503);
    const parsed = rawOverview.safeParse(data);
    if (!parsed.success || parsed.data.ownerId !== user.id || parsed.data.child.id !== input.childId || parsed.data.view !== input.view) throw new GuardianOverviewError("overview_unavailable", 503);
    const value = parsed.data, last = value.jobs.at(-1);
    const result = guardianChildOverviewSchema.safeParse({
        ownerId: user.id, child: { id: value.child.id, name: displayName(value.child.name, "Dein Kind"), avatarUrl: trustedGuardianAvatar(value.child.avatarUrl) },
        access: value.access, counts: value.counts, view: value.view,
        jobs: value.jobs.map(item => ({ id: item.id, title: cleanText(item.title, "Job", 300), status: item.status,
            partner: { name: displayName(item.partner.name, "Anbieter"), avatarUrl: trustedGuardianAvatar(item.partner.avatarUrl) }, startsAt: item.startsAt, completedAt: item.completedAt })),
        nextCursor: value.hasMore && last ? Buffer.from(JSON.stringify({ v: 1, childId: input.childId, view: input.view, at: last.sortAt, id: last.id })).toString("base64url") : null,
    });
    if (!result.success) throw new GuardianOverviewError("overview_unavailable", 503);
    return result.data;
}
