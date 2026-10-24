import assert from "node:assert/strict";
import test from "node:test";
import { listenerDefinitions, signingSecret } from "./stripe-listen.mjs";

test("webhook forwarding remains loopback-only, split by event format and purpose", () => {
  const listeners = listenerDefinitions("http://localhost:3001");
  assert.equal(listeners.length, 4);
  assert.equal(new Set(listeners.map(listener => listener.key)).size, 4);
  for (const listener of listeners) {
    assert.ok(!listener.args.includes("--live"));
    assert.ok(!listener.args.includes("--skip-verify"));
    for (const value of listener.args.filter(value => value.startsWith("http"))) assert.equal(new URL(value).origin, "http://localhost:3001");
  }
  const thin = listeners.find(listener => listener.name === "recipient-thin");
  assert.ok(thin.args[thin.args.indexOf("--events") + 1].split(",").every(event => event.startsWith("v2.core.account")));
  assert.ok(!listeners.find(listener => listener.name === "orders").args.includes("--forward-connect-to"));
  for (const origin of [undefined, "https://app.workfa.re", "http://localhost:3001/untrusted", "http://localhost:3001@remote.test", "http://192.0.2.1:3001"]) assert.throws(() => listenerDefinitions(origin));
});
test("Accounts-v2 notifications reach the thin handler with or without a connected-account context", () => {
  const thin = listenerDefinitions("http://localhost:3001").find(listener => listener.name === "recipient-thin");
  // Official CLI 1.55.1 filterByV2Source rejects context-free platform events
  // under @accounts. Forward-to already supplies both destinations under all.
  assert.equal(thin.args[thin.args.indexOf("--events-from") + 1], "all");
  assert.equal(thin.args[thin.args.indexOf("--forward-to") + 1], "http://localhost:3001/api/payments/recipient/webhook");
  assert.ok(!thin.args.includes("--all-thin"));
  assert.ok(!thin.args.includes("--all-snapshot"));
  assert.ok(!thin.args.includes("--thin-events"));
  const selected = thin.args[thin.args.indexOf("--events") + 1].split(",");
  assert.ok(selected.includes("v2.core.account[configuration.recipient].capability_status_updated"));
  assert.ok(selected.every(event => event.startsWith("v2.core.account") && !event.includes("*")));
});
test("only an unambiguous signing secret is accepted, with no raw CLI log forwarding", () => {
  assert.equal(signingSecret("Ready whsec_fixturePrivateSigningSecret123 [test]"), "whsec_fixturePrivateSigningSecret123");
  assert.equal(signingSecret("whsec_short"), null);
  assert.equal(signingSecret("whsec_fixtureSecretOne123 whsec_fixtureSecretTwo123"), null);
  assert.equal(signingSecret("No secret"), null);
});
test("order reconciliation listens explicitly for the dispute lifecycle without performing financial actions", () => {
  const orders = listenerDefinitions("http://localhost:3001").find(listener => listener.name === "orders");
  const events = orders.args[orders.args.indexOf("--events") + 1].split(",");
  for (const event of ["created", "updated", "closed", "funds_withdrawn", "funds_reinstated"]) assert.ok(events.includes(`charge.dispute.${event}`));
  assert.ok(events.includes("refund.updated"));
  assert.ok(events.includes("refund.created"));
  assert.ok(events.includes("refund.failed"));
  assert.ok(!events.some(event => event.includes("*")));
});

test("guardian identity updates and removals reach the signed snapshot reconciler",()=>{
  const listener=listenerDefinitions("http://localhost:3001").find(value=>value.key==="STRIPE_CONNECT_SNAPSHOT_WEBHOOK_SECRET");
  const events=listener.args[listener.args.indexOf("--events")+1].split(",");
  assert.ok(events.includes("person.updated"));assert.ok(events.includes("person.deleted"));
  assert.equal(listener.args[listener.args.indexOf("--forward-connect-to")+1],"http://localhost:3001/api/payments/recipient/webhook-snapshot");
  assert.ok(!events.some(value=>value.includes("*")));
});
