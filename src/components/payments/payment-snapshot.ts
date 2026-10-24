export type PaymentSnapshotOverride<T> = Readonly<{ source: T; value: T; unknown: boolean }>;

/** A newly delivered server projection wins over overrides of its predecessor. */
export function resolvePaymentSnapshot<T>(source: T, override: PaymentSnapshotOverride<T> | null) {
    return override !== null && override.source === source ? { value: override.value, unknown: override.unknown } : { value: source, unknown: false };
}
