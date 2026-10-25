import { z } from "zod";

export type GuardianChildView = "active" | "completed";
export type GuardianChildJob = Readonly<{
    id: string;
    title: string;
    status: "reserved" | "agreed" | "completed";
    partner: { name: string; avatarUrl: string | null };
    startsAt: string | null;
    completedAt: string | null;
}>;
export type GuardianChildOverviewSnapshot = Readonly<{
    ownerId: string;
    child: { id: string; name: string; avatarUrl: string | null };
    access: "minor_jobs" | "profile_only";
    counts: { active: number; completed: number; contacts: number } | null;
    view: GuardianChildView;
    jobs: GuardianChildJob[];
    nextCursor: string | null;
}>;

/** Images stay on the platform's own assets/storage; arbitrary profile URLs cannot track a family visit. */
export function trustedGuardianAvatar(value: unknown, databaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
    if (typeof value !== "string" || value.length > 2_048 || /[\u0000-\u0020\\]/.test(value)) return null;
    if (/^\/(?:media\/)?avatars\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes("..")) return value;
    try {
        const url = new URL(value), database = new URL(databaseOrigin ?? "");
        return url.origin === database.origin && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash
            && /^\/storage\/v1\/object\/public\/(?:avatars|profile-avatars|profile-pictures)\/[A-Za-z0-9_./%~-]+$/.test(url.pathname)
            && !/%2f|%5c|%2e/i.test(url.pathname) ? url.href : null;
    } catch { return null; }
}

const text = z.string().min(1).max(300).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const name = text.max(120).refine(value => !value.includes("@"));
const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const avatar = z.string().nullable().refine(value => value === null || trustedGuardianAvatar(value) === value);
const job = z.object({ id: z.uuid(), title: text, status: z.enum(["reserved", "agreed", "completed"]),
    partner: z.object({ name, avatarUrl: avatar }).strict(), startsAt: stamp.nullable(), completedAt: stamp.nullable() }).strict();
export const guardianChildOverviewSchema = z.object({
    ownerId: z.uuid(), child: z.object({ id: z.uuid(), name, avatarUrl: avatar }).strict(), access: z.enum(["minor_jobs", "profile_only"]),
    counts: z.object({ active: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), completed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), contacts: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict().nullable(),
    view: z.enum(["active", "completed"]), jobs: z.array(job).max(6), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).nullable(),
}).strict().refine(value => value.access === "profile_only"
    ? value.counts === null && value.jobs.length === 0 && value.nextCursor === null
    : value.counts !== null && value.jobs.every(item => value.view === "completed" ? item.status === "completed" : item.status !== "completed"));

export function validGuardianChildOverview(value: unknown, ownerId: string, childId: string, view: GuardianChildView): value is GuardianChildOverviewSnapshot {
    const result = guardianChildOverviewSchema.safeParse(value);
    return result.success && result.data.ownerId === ownerId && result.data.child.id === childId && result.data.view === view;
}
