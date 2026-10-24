import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { recoverRecipientPayouts } from './recover-recipient-payouts.mjs';
const environment = { WORKFARE_PAY_MODE: 'live', APP_ORIGIN: 'https://app.workfa.re', WORKFARE_PAY_HOSTED_STATE_SECRET: 'offline-only-secret-at-least-32-chars' };
test('worker only invokes the scope-bound restore endpoint and exposes counts', async () => {
    const calls = [];
    const result = await recoverRecipientPayouts({ environment, request: async (...args) => { calls.push(args); return Response.json({ ok: true, reconciled: 2, pending: 1, private: 'must not escape' }); } });
    assert.deepEqual(result, { ok: true, reconciled: 2, pending: 1 });
    assert.equal(calls.length, 1); assert.equal(String(calls[0][0]), 'http://127.0.0.1:3000/api/payments/recipient/payout-recovery');
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

test('worker only uses a validated local bind port, never APP_ORIGIN as an HMAC destination', async () => {
    const calls = [];
    await recoverRecipientPayouts({ environment: { ...environment, PORT: '4317' }, request: async (...args) => { calls.push(args); return Response.json({ ok: true, reconciled: 0, pending: 0 }); } });
    const target = calls[0][0];
    assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '4317');
    assert.equal(target.pathname, '/api/payments/recipient/payout-recovery'); assert.equal(target.search, '');
    assert.equal(calls[0][1].redirect, 'error');
});
test('worker rejects malformed, out-of-range and destination-bearing ports before networking', async () => {
    let count = 0;
    const request = async () => { count++; return Response.json({ ok: true, reconciled: 0, pending: 0 }); };
    for (const PORT of ['', '0', '65536', '999999', '-1', '3000/path', '3000@evil.example', ' 3000', '3000 ', '03000', '3000?redirect=evil', 'https://evil.example']) {
        await assert.rejects(recoverRecipientPayouts({ environment: { ...environment, PORT }, request }), /Recovery environment is incomplete/);
    }
    assert.equal(count, 0);
});
test('worker never follows a loopback redirect that could expose its HMAC', async () => {
    let requests = 0, redirectedRequests = 0;
    const redirectTarget = createServer((_request, response) => { redirectedRequests++; response.end('must not be called'); });
    redirectTarget.listen(0, '127.0.0.1'); await once(redirectTarget, 'listening');
    const server = createServer((request, response) => {
        requests++;
        assert.equal(request.url, '/api/payments/recipient/payout-recovery');
        assert.equal(request.method, 'POST');
        assert.match(request.headers.authorization, /^Bearer [a-f0-9]{64}$/);
        response.writeHead(302, { Location: `http://127.0.0.1:${redirectTarget.address().port}/must-not-receive-authorization` }); response.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        await assert.rejects(recoverRecipientPayouts({ environment: { ...environment, PORT: String(server.address().port) } }));
        assert.equal(requests, 1); assert.equal(redirectedRequests, 0);
    } finally {
        await Promise.all([server, redirectTarget].map(listener => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))));
    }
});
