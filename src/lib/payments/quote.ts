/** Technical bound for the initial EUR/Stripe scenario, not a published job limit. */
export const MAX_QUOTE_CENTS = 99_999_999;
/** Economic planning target after direct costs; never a default service-fee rate. */
export const CONTRIBUTION_TARGET_BASIS_POINTS = 600;

export type FeeTaxSnapshot = Readonly<{
    jurisdiction: "DE";
    treatment: "no_vat" | "vat_included";
    rateBasisPoints: number;
    recordedAt: string;
    determinationReference: string;
}>;

export type ApprovedServiceFee = Readonly<{
    approved: true;
    policyVersion: string;
    approvedAt: string;
    grossCents: number;
    tax: FeeTaxSnapshot;
}>;

export type DirectCostEstimate = Readonly<{
    version: string;
    processingCents: number;
    recipientAccountAllocationCents: number;
    payoutCents: number;
    otherCents: number;
}>;

export type PaymentQuoteInput = Readonly<{
    currency: "eur";
    recipientEarningsCents: number;
    serviceFee: ApprovedServiceFee;
    directCosts: DirectCostEstimate;
    quotedAt: string;
}>;

export class PaymentQuoteError extends Error {
    constructor(readonly code: "invalid_money" | "amount_limit" | "unsupported_currency" | "fee_not_approved" | "invalid_snapshot" | "invalid_tax_snapshot") {
        super(`Workfare Pay quote invalid: ${code}`);
        this.name = "PaymentQuoteError";
    }
}

function cents(value: unknown, positive = false): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new PaymentQuoteError("invalid_money");
    if (value > MAX_QUOTE_CENTS) throw new PaymentQuoteError("amount_limit");
}

function reference(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function timestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function roundRatio(numerator: bigint, denominator: bigint) {
    return Number((numerator + denominator / BigInt(2)) / denominator);
}

/** Integer half-up rounding; the caller supplies its explicitly chosen tariff. */
export function grossFeeForRate(earningsCents: number, rateBasisPoints: number) {
    cents(earningsCents, true);
    if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) throw new PaymentQuoteError("invalid_snapshot");
    const amount = roundRatio(BigInt(earningsCents) * BigInt(rateBasisPoints), BigInt(10_000));
    cents(amount);
    return amount;
}

/** Arithmetic only: this function does not establish any actual tax obligation. */
export function taxIncludedInGrossFee(grossCents: number, rateBasisPoints: number) {
    cents(grossCents);
    if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) throw new PaymentQuoteError("invalid_tax_snapshot");
    return roundRatio(BigInt(grossCents) * BigInt(rateBasisPoints), BigInt(10_000 + rateBasisPoints));
}

/**
 * Pure offline quote from explicit, previously approved fee values. No tariff,
 * tax status, payment-method surcharge or PSP cost is guessed. Recipient earnings
 * remain the full agreed amount; this is not a payroll/tax calculation for them.
 */
export function quoteSandboxPayment(input: PaymentQuoteInput) {
    if (!input || typeof input !== "object") throw new PaymentQuoteError("invalid_snapshot");
    if (input.currency !== "eur") throw new PaymentQuoteError("unsupported_currency");
    cents(input.recipientEarningsCents, true);
    const fee = input.serviceFee;
    if (!fee || fee.approved !== true) throw new PaymentQuoteError("fee_not_approved");
    cents(fee.grossCents);
    if (!reference(fee.policyVersion) || !timestamp(input.quotedAt) || !timestamp(fee.approvedAt) || fee.approvedAt > input.quotedAt) {
        throw new PaymentQuoteError("invalid_snapshot");
    }
    const tax = fee.tax;
    if (!tax || tax.jurisdiction !== "DE" || !["no_vat", "vat_included"].includes(tax.treatment)
        || !Number.isSafeInteger(tax.rateBasisPoints) || tax.rateBasisPoints < 0 || tax.rateBasisPoints > 10_000
        || (tax.treatment === "no_vat" ? tax.rateBasisPoints !== 0 : tax.rateBasisPoints === 0)
        || !reference(tax.determinationReference) || !timestamp(tax.recordedAt) || tax.recordedAt > input.quotedAt) {
        throw new PaymentQuoteError("invalid_tax_snapshot");
    }
    const costs = input.directCosts;
    if (!costs || !reference(costs.version)) throw new PaymentQuoteError("invalid_snapshot");
    const costValues = [costs.processingCents, costs.recipientAccountAllocationCents, costs.payoutCents, costs.otherCents];
    for (const cost of costValues) cents(cost);
    const directCostsCents = costValues.reduce((sum, cost) => sum + cost, 0);
    cents(directCostsCents);
    const buyerTotalCents = input.recipientEarningsCents + fee.grossCents;
    cents(buyerTotalCents, true);
    const serviceFeeTaxCents = tax.treatment === "no_vat" ? 0 : roundRatio(
        BigInt(fee.grossCents) * BigInt(tax.rateBasisPoints), BigInt(10_000 + tax.rateBasisPoints),
    );
    const serviceFeeNetCents = fee.grossCents - serviceFeeTaxCents;
    // Direct PSP costs are deducted from fee revenue after removing fee VAT,
    // never from the recipient's agreed earnings and never from a tax base twice.
    const contributionCents = serviceFeeNetCents - directCostsCents;
    const targetContributionCents = Number((BigInt(input.recipientEarningsCents) * BigInt(CONTRIBUTION_TARGET_BASIS_POINTS) + BigInt(9_999)) / BigInt(10_000));
    return Object.freeze({
        currency: "eur" as const,
        recipientEarningsCents: input.recipientEarningsCents,
        serviceFeeGrossCents: fee.grossCents,
        serviceFeeNetCents,
        serviceFeeTaxCents,
        buyerTotalCents,
        directCostsCents,
        contributionCents,
        targetContributionCents,
        meetsContributionTarget: contributionCents >= targetContributionCents,
        feePolicyVersion: fee.policyVersion,
        directCostVersion: costs.version,
        taxSnapshot: Object.freeze({ ...tax }),
        quotedAt: input.quotedAt,
        mode: "offline_sandbox_quote" as const,
        livePaymentsEnabled: false as const,
    });
}
