type ConnectSession = { logout: () => Promise<void> };
const sessions = new Set<ConnectSession>();
let owner: string | null = null;
let generation = 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Every instance gets a fresh owner-bound AccountSession, never another user's instance. */
export function createRecipientConnectSession<T extends ConnectSession>(ownerId: string | undefined, create: (assertCurrentOwner: () => void) => T): T {
    if (!ownerId || !UUID.test(ownerId) || (owner !== null && owner !== ownerId)) throw new Error("connect_owner_changed");
    owner = ownerId;
    const ticket = generation;
    const assertCurrentOwner = () => { if (owner !== ownerId || generation !== ticket) throw new Error("connect_owner_changed"); };
    const session = create(assertCurrentOwner);
    assertCurrentOwner();
    sessions.add(session);
    return session;
}

/** Only the actual app logout/account switch calls this; ordinary unmounts don't. */
export async function logoutRecipientConnectSessions(): Promise<void> {
    generation += 1;
    owner = null;
    const previous = [...sessions];
    sessions.clear();
    if (!previous.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            Promise.allSettled(previous.map(session => Promise.resolve().then(() => session.logout()))),
            new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000); }),
        ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}
