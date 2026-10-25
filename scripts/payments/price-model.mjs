import { pathToFileURL } from 'node:url';

// Offline planning only. This module has no environment, database or Stripe access.
const cap = 99_999_999;
const round = (n, d) => (n + d / 2n) / d;
const ceil = (n, d) => (n + d - 1n) / d;
function integer(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid planning assumption.');
    return BigInt(value);
}
function assumptions(input) {
    const wages = integer(input.wagesCents, 50, cap);
    const processing = integer(input.processingBasisPoints ?? 150, 0, 5000);
    const fixed = integer(input.processingFixedCents ?? 25, 0, cap);
    const target = integer(input.targetBasisPoints ?? 600, 0, 10000);
    const vat = integer(input.feeVatBasisPoints ?? 1900, 0, 2500);
    const jobs = integer(input.jobsPerActiveMonth ?? 10, 1, 1000);
    const payouts = integer(input.payoutsPerActiveMonth ?? 1, 1, 1000);
    const account = integer(input.activeAccountMonthlyCents ?? 200, 0, cap);
    const payoutFixed = integer(input.payoutFixedCents ?? 10, 0, cap);
    const payoutRate = integer(input.payoutBasisPoints ?? 25, 0, 5000);
    const routing = integer(input.additionalRoutingBasisPoints ?? 0, 0, 5000);
    return { wages, processing, fixed, target, vat,
        allocated: ceil(account + payouts * payoutFixed, jobs),
        payoutCosts: round(wages * payoutRate, 10000n) + round(wages * routing, 10000n) };
}
function outcome(a, fee) {
    const total = a.wages + fee;
    if (fee < 0n || total > BigInt(cap)) throw new Error('Planning amount exceeds limit.');
    const feeVat = round(fee * a.vat, 10000n + a.vat);
    const processing = round(total * a.processing, 10000n) + a.fixed;
    const costs = processing + a.allocated + a.payoutCosts;
    const contribution = fee - feeVat - costs;
    const target = ceil(a.wages * a.target, 10000n);
    return { planningOnly: true, tariffActivated: false, wagesCents: Number(a.wages), feeCents: Number(fee),
        totalCents: Number(total), feeVatCents: Number(feeVat), processingCents: Number(processing),
        allocatedAccountAndPayoutFixedCents: Number(a.allocated), payoutAndRoutingCents: Number(a.payoutCosts),
        directCostsCents: Number(costs), contributionCents: Number(contribution), targetCents: Number(target),
        meetsTarget: contribution >= target };
}
export function evaluateBundle(input, feeCents) {
    return outcome(assumptions(input), integer(feeCents, 0, cap));
}
export function minimumBundle(input) {
    const a = assumptions(input), unit = 10000n, taxUnit = unit + a.vat;
    const denominator = unit * unit - a.processing * taxUnit;
    const target = ceil(a.wages * a.target, unit);
    // Each independently rounded variable cost differs from its exact ratio by
    // at most half a cent. The lower bound allows a full cent of rounding gain;
    // scanning upward finds the first feasible integer, including VAT boundaries.
    const basis = target + a.fixed + a.allocated + a.payoutCosts;
    const lowerNumerator = ((basis - 1n) * unit + a.processing * a.wages) * taxUnit;
    let fee = lowerNumerator > 0n ? ceil(lowerNumerator, denominator) : 0n;
    for (;;) {
        const result = outcome(a, fee);
        if (result.meetsTarget) return result;
        fee++;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const rows = [];
    for (const jobs of [1, 10]) for (const rate of [150, 280]) for (const wages of [1000, 1700, 3000]) {
        const input = { wagesCents: wages, jobsPerActiveMonth: jobs, processingBasisPoints: rate };
        const result = minimumBundle(input);
        rows.push({ jobsPerActiveMonth: jobs, cardRateBasisPoints: rate, ...result });
    }
    console.log(JSON.stringify({ assumptions: 'Public DE list prices; 6% contribution target; 19% fee VAT scenario, not tax advice; actual contract/routing unconfirmed', rows }, null, 2));
}
