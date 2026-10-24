"use client";

import { useEffect, useState } from "react";

export function subscribeMinuteClock(update: (now: number) => void) {
    const timer = setInterval(() => update(Date.now()), 60_000);
    return () => clearInterval(timer);
}

/** Appointment labels and ordering must advance even while the conversation is idle. */
export function useMinuteClock() {
    const [now, setNow] = useState(Date.now);
    useEffect(() => subscribeMinuteClock(setNow), []);
    return now;
}
