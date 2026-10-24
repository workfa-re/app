/** The server action may finish after a connection loss; a timeout is never success. */
export async function guardianAction<T>(action: () => Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            action(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("Der aktuelle Stand konnte nicht bestätigt werden. Bitte prüfe ihn erneut.")), 25_000);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function invitationLink(origin: string, token: string) {
    const url = new URL("/guardian/access", origin);
    url.searchParams.set("token", token);
    return url.toString();
}

export function guardianInitials(name: string | null) {
    return name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("de-DE") || "";
}
