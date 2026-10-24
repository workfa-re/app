const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function getRecipientJobReturnPath(jobId: string): string | null {
    return UUID.test(jobId) ? `/app-home/jobs?job=${jobId}` : null;
}
export function sanitizeRecipientReturnPath(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = value.match(/^\/app-home\/jobs\?job=([0-9a-f-]{36})$/i);
    return match && getRecipientJobReturnPath(match[1]) === value ? value : null;
}
export function getRecipientSettingsHref(jobId: string): string {
    const path = getRecipientJobReturnPath(jobId);
    return path ? `/app-home/settings/payments?returnTo=${encodeURIComponent(path)}` : "/app-home/settings/payments";
}
export function readRecipientReturnJobId(value: unknown): string | null {
    return typeof value === "string" && UUID.test(value) ? value : null;
}
