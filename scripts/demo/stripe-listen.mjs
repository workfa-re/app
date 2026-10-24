import { spawn } from "node:child_process";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dockerConnection, ENV_FILE, fail, loadDemoEnvironment, ROOT, verifyProject } from "./common.mjs";

const VERSION = "1.55.1";
export function listenerDefinitions(origin) {
  if (origin !== "http://localhost:3001") throw new Error("Only the verified local demo origin is supported.");
  return [
    { name: "buyer", key: "STRIPE_WEBHOOK_SECRET", args: ["--events", "checkout.session.completed,setup_intent.succeeded,payment_method.detached", "--forward-to", `${origin}/api/payments/webhook`] },
    { name: "recipient", key: "STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET", args: ["--events", "account.updated,account.external_account.created,account.external_account.updated,account.external_account.deleted,person.updated,person.deleted", "--forward-to", `${origin}/api/payments/recipient/webhook-snapshot`, "--forward-connect-to", `${origin}/api/payments/recipient/webhook-snapshot`] },
    // CLI 1.55.1 treats only nonempty event.context as a connected-account
    // event. Platform-owned Accounts-v2 changes must also reach this handler;
    // @accounts would discard their context-free notifications before POST.
    // Keep the explicit event-type allowlist and server-side owner checks.
    { name: "recipient-thin", key: "STRIPE_CONNECT_WEBHOOK_SECRET", args: ["--events", "v2.core.account[configuration.recipient].capability_status_updated,v2.core.account[configuration.recipient].updated,v2.core.account[requirements].updated,v2.core.account[future_requirements].updated,v2.core.account[identity].updated,v2.core.account.closed", "--events-from", "all", "--forward-to", `${origin}/api/payments/recipient/webhook`] },
    { name: "orders", key: "STRIPE_PAYMENT_WEBHOOK_SECRET", args: ["--events", "payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.canceled,payment_intent.payment_failed,payment_intent.processing,refund.created,refund.updated,refund.failed,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated", "--forward-to", `${origin}/api/payments/orders/webhook`] },
  ];
}

export function signingSecret(line) {
  const match = line.match(/\bwhsec_[a-zA-Z0-9]{12,}\b/g);
  return match?.length === 1 ? match[0] : null;
}

async function saveSecret(key, value) {
  let source = await readFile(ENV_FILE, "utf8");
  const expression = new RegExp(`^${key}=.*$`, "gm");
  const count = [...source.matchAll(expression)].length;
  if (count > 1) throw new Error("Ambiguous private webhook configuration was preserved.");
  source = count ? source.replace(expression, `${key}=${value}`) : `${source.endsWith("\n") ? source : source + "\n"}${key}=${value}\n`;
  const temporary = `${ENV_FILE}.webhook-${randomUUID()}`;
  try {
    await writeFile(temporary, source, { mode: 0o600, flag: "wx" });
    await rename(temporary, ENV_FILE); await chmod(ENV_FILE, 0o600);
  } finally { await unlink(temporary).catch(() => undefined); }
}

export async function listen() {
  await loadDemoEnvironment(); await verifyProject(await dockerConnection());
  if (process.env.WORKFARE_PAY_MODE !== "sandbox" || !/^(?:sk|rk)_test_[a-zA-Z0-9]+$/.test(process.env.STRIPE_SECRET_KEY ?? "")) {
    throw new Error("An explicitly configured local Stripe sandbox is required.");
  }
  const definitions = listenerDefinitions(process.env.APP_ORIGIN);
  const children = [];
  let writes = Promise.resolve();
  let stopping = false;
  const ready = new Set();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); }
      catch { /* Already stopped. */ }
    }
  };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  for (const definition of definitions) {
    const child = spawn("npx", ["--yes", `@stripe/cli@${VERSION}`, "listen", "--device-name", `workfare-local-demo-${definition.name}`, ...definition.args], {
      cwd: ROOT, env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY, STRIPE_NO_AUTO_UPDATE: "1" },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let buffer = "";
    const consume = (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 64_000) buffer = buffer.slice(-32_000);
      const lines = buffer.split(/[\r\n]+/); buffer = lines.pop() ?? "";
      for (const line of lines) {
        const secret = signingSecret(line);
        if (secret && !ready.has(definition.name)) {
          ready.add(definition.name);
          writes = writes.then(() => saveSecret(definition.key, secret)).then(() => {
            console.log(`Local Stripe ${definition.name} listener ready; signing secret stored privately.`);
          }).catch(() => { console.error("Private webhook configuration could not be saved."); process.exitCode = 1; stop(); });
        } else {
          const status = line.match(/\[([2-5][0-9]{2})\]\s+POST\b/);
          if (status) console.log(`Local Stripe ${definition.name} webhook response: ${status[1]}.`);
          // Do not forward CLI output, objects, credentials or raw events to logs.
        }
      }
    };
    child.stdout.on("data", consume); child.stderr.on("data", consume);
    child.on("error", () => { console.error(`Local Stripe ${definition.name} listener could not start.`); process.exitCode = 1; stop(); });
    child.on("exit", (code) => { if (!stopping) { console.error(`Local Stripe ${definition.name} listener stopped (${code ?? "signal"}).`); process.exitCode = 1; stop(); } });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) listen().catch(fail);
