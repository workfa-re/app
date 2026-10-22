/** One workspace for an application, its messages, appointments and history. */
export function getActivityConversationHref(applicationId?: string | null): string {
    const id = applicationId?.trim();
    return id
        ? `/app-home/activities?conversation=${encodeURIComponent(id)}`
        : "/app-home/activities";
}
