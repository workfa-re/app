import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { recoverRecipientPayouts } from './recover-recipient-payouts.mjs';
const environment = { WORKFARE_PAY_MODE: 'live', APP_ORIGIN: 'https://app.workfa.re', WORKFARE_PAY_HOSTED_STATE_SECRET: 'offline-only-secret-at-least-32-chars' };
test('worker only invokes the scope-bound restore endpoint and exposes counts', async () => {
    const calls = [];
    const result = await recoverRecipientPayouts({ environment, request: async (...args) => { calls.push(args); return Response.json({ ok: true, reconciled: 2, pending: 1, private: 'must not escape' }); } });
    assert.deepEqual(result, { ok: true, reconciled: 2, pending: 1 });
    assert.equal(calls.length, 1); assert.equal(String(calls[0][0]), 'https://app.workfa.re/api/payments/recipient/payout-recovery');
    const options = calls[0][1]; assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, `Bearer ${createHmac('sha256', environment.WORKFARE_PAY_HOSTED_STATE_SECRET).update('workfare:recipient-payout-recovery:v1').digest('hex')}`);
});
test('worker refuses insecure/mixed/missing environments before networking', async () => {
    let count = 0; const request = async () => { count++; return Response.json({ ok: true, reconciled: 0, pending: 0 }); };
    for (const patch of [{ WORKFARE_PAY_MODE: 'local_simulation' }, { APP_ORIGIN: 'http://app.workfa.re' }, { APP_ORIGIN: 'https://app.workfa.re/path' }, { APP_ORIGIN: 'https://localhost' }, { APP_ORIGIN: 'https://app.workfa.re?x=1' }, { WORKFARE_PAY_HOSTED_STATE_SECRET: '' }]) await assert.rejects(recoverRecipientPayouts({ environment: { ...environment, ...patch }, request }));
    assert.equal(count, 0);
});
test('worker rejects an unknown result without serializing server errors', async () => {
    for (const body of [{ ok: false, secret: 'private' }, { ok: true, reconciled: -1, pending: 0 }, { ok: true, reconciled: 21, pending: 0 }]) await assert.rejects(recoverRecipientPayouts({ environment, request: async () => Response.json(body) }), /Recovery was not confirmed/);
});
