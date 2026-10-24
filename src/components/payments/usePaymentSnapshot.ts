"use client";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { resolvePaymentSnapshot, type PaymentSnapshotOverride } from "./payment-snapshot";

/** Keeps an embedded form mounted while new confirmed server props replace data. */
export function usePaymentSnapshot<T>(source: T) {
    const [override, setOverride] = useState<PaymentSnapshotOverride<T> | null>(null);
    const committedSource = useRef(source);
    useEffect(() => { committedSource.current = source; }, [source]);
    const current = resolvePaymentSnapshot(source, override);
    const setSnapshot = useCallback((next: SetStateAction<T>) => {
        if (committedSource.current !== source) return;
        setOverride(previous => {
            const state = resolvePaymentSnapshot(source, previous);
            return { source, value: typeof next === "function" ? (next as (current: T) => T)(state.value) : next, unknown: state.unknown };
        });
    }, [source]);
    const setUnknown = useCallback((unknown: boolean) => {
        if (committedSource.current !== source) return;
        setOverride(previous => ({ source, value: resolvePaymentSnapshot(source, previous).value, unknown }));
    }, [source]);
    const isCurrentSource = useCallback(() => committedSource.current === source, [source]);
    return { snapshot: current.value, unknown: current.unknown, setSnapshot, setUnknown, isCurrentSource };
}
