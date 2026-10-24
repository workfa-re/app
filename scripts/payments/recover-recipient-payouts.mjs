import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Runs inside the private app environment. Never accepts a payout instruction. */
export async function recoverRecipientPayouts({ environment = process.env, request = fetch } = {}) {
    const mode = environment.WORKFARE_PAY_MODE;
    const origin = new URL(environment.APP_ORIGIN ?? '');
    const secret = environment.WORKFARE_PAY_HOSTED_STATE_SECRET;
    const port = environment.PORT ?? '3000';
    if (!['sandbox', 'live'].includes(mode) || !secret || secret.length < 32
        || typeof port !== 'string' || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535
        || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
        || mode === 'live' && (origin.protocol !== 'https:' || /(?:localhost|\.local|\.test|\.example|\.invalid)$/.test(origin.hostname) || /^[\d.]+$/.test(origin.hostname) || origin.hostname.includes(':'))
        || mode === 'sandbox' && (!['http:', 'https:'].includes(origin.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
        throw new Error('Recovery environment is incomplete.');
    }
    const token = createHmac('sha256', secret).update('workfare:recipient-payout-recovery:v1').digest('hex');
    // This worker runs inside the app container. Keep its HMAC on loopback;
    // public ingress challenges must not prevent restoration after a crash.
    const target = new URL(`http://127.0.0.1:${port}/api/payments/recipient/payout-recovery`);
    const response = await request(target, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(240_000),
        headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true || !Number.isSafeInteger(result.reconciled) || result.reconciled < 0
        || !Number.isSafeInteger(result.pending) || result.pending < 0 || result.reconciled + result.pending > 20) {
        throw new Error('Recovery was not confirmed.');
    }
    return { ok: true, reconciled: result.reconciled, pending: result.pending };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { console.log(JSON.stringify({ at: new Date().toISOString(), ...await recoverRecipientPayouts() })); }
    catch { console.error('Recipient payout recovery failed. Check the private application configuration and health.'); process.exitCode = 1; }
}
