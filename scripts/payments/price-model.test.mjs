import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBundle, minimumBundle } from './price-model.mjs';

test('minimum price preserves wages, covers stated costs and leaves the six percent target', () => {
    for (const jobs of [1, 10, 25]) for (const vat of [0, 1900]) for (const rate of [150, 280, 315]) {
        const result = minimumBundle({ wagesCents: 1700, jobsPerActiveMonth: jobs, feeVatBasisPoints: vat, processingBasisPoints: rate });
        assert.equal(result.totalCents - result.feeCents, 1700);
        assert.equal(result.contributionCents, result.feeCents - result.feeVatCents - result.directCostsCents);
        assert.equal(result.targetCents, 102); assert.equal(result.meetsTarget, true);
        assert.equal(result.planningOnly, true); assert.equal(result.tariffActivated, false);
    }
});
test('integer minimum is the first feasible fee, including independent rounding boundaries', () => {
    for (const wages of [50, 99, 499, 1700, 3000, 100000]) for (const vat of [0, 1900]) {
        const input = { wagesCents: wages, feeVatBasisPoints: vat, processingBasisPoints: 280 };
        const minimum = minimumBundle(input);
        for (let fee = 0; fee < minimum.feeCents; fee++) assert.equal(evaluateBundle(input, fee).meetsTarget, false);
    }
});
test('low account activity, more bank payouts, routing and premium cards cost more', () => {
    const input = { wagesCents: 1700 };
    const base = minimumBundle(input);
    for (const patch of [{jobsPerActiveMonth:1}, {payoutsPerActiveMonth:10}, {additionalRoutingBasisPoints:25}, {processingBasisPoints:280}]) {
        assert.ok(minimumBundle({...input,...patch}).feeCents > base.feeCents);
    }
});
test('six percent charged to the buyer is not six percent contribution after costs', () => {
    assert.equal(evaluateBundle({wagesCents:1700}, 102).meetsTarget, false);
});
test('published 17-euro example includes VAT, account allocation and the fee on the full buyer total', () => {
    assert.deepEqual(minimumBundle({wagesCents:1700}), {
        planningOnly:true,tariffActivated:false,wagesCents:1700,feeCents:215,totalCents:1915,
        feeVatCents:34,processingCents:54,allocatedAccountAndPayoutFixedCents:21,payoutAndRoutingCents:4,
        directCostsCents:79,contributionCents:102,targetCents:102,meetsTarget:true,
    });
});
test('invalid money, counts and cost assumptions are refused', () => {
    for (const patch of [{wagesCents:0},{wagesCents:1.5},{wagesCents:Infinity},{jobsPerActiveMonth:0},{payoutsPerActiveMonth:-1},{feeVatBasisPoints:10000},{processingBasisPoints:10000}]) {
        assert.throws(()=>minimumBundle({wagesCents:1700,...patch}));
    }
    assert.throws(()=>minimumBundle({wagesCents:99_999_999}));
});
