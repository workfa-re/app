// Generated provider accounts in disposable release-shaped PostgreSQL only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createProductionPaymentFixture } from "./production-payment-fixture.mjs";
import { quote, args, asRole } from "./payment-fixture.mjs";
const directory = new URL("../../infrastructure/database/migrations/", import.meta.url);
const path =
    process.env.WORKFARE_MEMBERSHIP_SQL ??
    new URL(
        (await readdir(directory)).find((x) => x.endsWith("_provider_memberships.sql")) ?? "missing.sql",
        directory,
    );
const migration = await readFile(path, "utf8");
const f = await createProductionPaymentFixture("workfare_memberships", {
        excludeMigrationSuffix: ["_provider_memberships.sql","_membership_fee_tariffs.sql"],
    }),
    { execute, json, dispose } = f;
let checks = 0;
const check = (a, b, label) => {
    assert.deepEqual(a, b, label);
    checks++;
};
const id = () => randomUUID(),
    owner = id(),
    other = id(),
    operation = id(),
    periodEnd = new Date(Date.now() + 3600000).toISOString();
const call = (name, values, role = "service_role", who = null) =>
    json(asRole(role, who, `SELECT coalesce(to_json(public.${name}(${args(values)})),'null'::json)`));
try {
    await execute(`BEGIN;${migration.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "")}ROLLBACK;`);
    check(await json("SELECT to_json(to_regclass('payment_private.memberships')IS NULL)"), true, "atomic rollback");
    await execute(migration);
    await execute(
        `UPDATE payment_private.configuration SET mode='sandbox';INSERT INTO auth.users(id,email,email_confirmed_at)VALUES(${args([owner, "provider@membership.invalid"])},now()),(${args([other, "other@membership.invalid"])},now());INSERT INTO public.profiles(id,full_name,account_type,country,birthdate)VALUES(${args([owner, "Fixture Provider", "job_provider", "DE", "1980-01-01"])}),(${args([other, "Other Fixture", "job_seeker", "DE", "2008-01-01"])})ON CONFLICT(id)DO UPDATE SET account_type=EXCLUDED.account_type;`,
    );
    check((await call("pay_membership_record", [owner, "sandbox"])).enabled, false, "disabled by default");
    await assert.rejects(
        call("pay_membership_checkout_claim", [owner, "sandbox", operation, "workfare-plan-v1", true]),
        /MEMBERSHIP_UNAVAILABLE/,
    );
    checks++;
    await assert.rejects(
        execute(
            "UPDATE payment_private.membership_configuration SET enabled=true,product_ref='prod_fixture',price_ref='price_fixture'WHERE mode='sandbox'",
        ),
        /check constraint/,
    );
    checks++;
    await assert.rejects(
        execute(
            "UPDATE payment_private.membership_configuration SET enabled=true,tax_treatment='vat19',product_ref='prod_fixture',price_ref='price_fixture'WHERE mode='sandbox'",
        ),
        /check constraint/,
    );
    checks++;
    await execute(
        "UPDATE payment_private.membership_configuration SET enabled=true,tax_treatment='small_business',product_ref='prod_membershipFixture',price_ref='price_membershipFixture'WHERE mode='sandbox'",
    );
    await execute(
        `INSERT INTO payment_private.customers(user_id,mode,customer_ref,claim_operation,livemode)VALUES(${args([owner, "sandbox", "cus_membershipFixture", operation, false])})`,
    );
    await assert.rejects(
        call("pay_membership_checkout_claim", [owner, "sandbox", operation, "workfare-plan-v1", false]),
        /MEMBERSHIP_UNAVAILABLE/,
    );
    checks++;
    let result = await call("pay_membership_checkout_claim", [owner, "sandbox", operation, "workfare-plan-v1", true]);
    check(result.status, "none", "checkout alone grants no membership");
    check(result.entitled, false, "checkout alone grants no fee benefit");
    check(result.customerRef, "cus_membershipFixture", "uses existing customer");
    const checkout = result.checkout;
    check(
        (await call("pay_membership_checkout_claim", [owner, "sandbox", operation, "workfare-plan-v1", true])).checkout
            .id,
        checkout.id,
        "operation replay stable",
    );
    await assert.rejects(
        call("pay_membership_checkout_claim", [owner, "sandbox", id(), "workfare-plan-v1", true]),
        /MEMBERSHIP_CHECKOUT_PENDING/,
    );
    checks++;
    await call("pay_membership_checkout_attach", [
        owner,
        "sandbox",
        checkout.id,
        "cs_test_fixture",
        new Date(Date.now() + 3600000).toISOString(),
        false,
    ]);
    await assert.rejects(
        call("pay_membership_checkout_attach", [
            other,
            "sandbox",
            checkout.id,
            "cs_test_foreign",
            new Date(Date.now() + 3600000).toISOString(),
            false,
        ]),
        /MEMBERSHIP_CHECKOUT_CONFLICT/,
    );
    checks++;
    const sync = () => call("pay_membership_sync_begin", [owner, "sandbox", "cus_membershipFixture"]);
    const apply = (generation, status = "active", paid = periodEnd, review = false, cancel = false) =>
        call("pay_membership_sync_apply", [
            owner,
            "sandbox",
            generation,
            "sub_membershipFixture",
            status,
            paid,
            periodEnd,
            cancel,
            paid ? "in_membershipFixture" : null,
            review,
        ]);
    const ticket = await sync();
    await apply(ticket, "incomplete", null);
    check(
        (await call("pay_membership_record", [owner, "sandbox"])).entitled,
        false,
        "unpaid first invoice has no benefit",
    );
    const first = await sync(),
        second = await sync();
    check(await apply(first), false, "stale network result cannot overwrite");
    check(await apply(second), true, "current verified result applies");
    result = await call("pay_membership_record", [owner, "sandbox"]);
    check(result.entitled, true, "paid active period has benefit");
    check(!!result.contractReference, true, "opaque public cancellation reference");
    await execute("UPDATE payment_private.membership_configuration SET enabled=false WHERE mode='sandbox'");
    check(
        (await call("pay_membership_record", [owner, "sandbox"])).entitled,
        true,
        "sales pause preserves paid contract",
    );
    await execute("UPDATE payment_private.membership_configuration SET enabled=true WHERE mode='sandbox'");
    await call("pay_membership_checkout_attach", [
        owner,
        "sandbox",
        checkout.id,
        "cs_test_fixture",
        new Date(Date.now() + 3600000).toISOString(),
        true,
    ]);
    check(
        await json(
            `SELECT to_json(count(*))FROM public.notifications WHERE type='membership_active'AND user_id=${quote(owner)}`,
        ),
        1,
        "activation notice once",
    );
    await apply(await sync());
    check(
        await json(
            `SELECT to_json(count(*))FROM public.notifications WHERE type='membership_active'AND user_id=${quote(owner)}`,
        ),
        1,
        "same paid period does not duplicate notification",
    );
    await apply(await sync(), "active", periodEnd, false, true);
    check(
        (await call("pay_membership_record", [owner, "sandbox"])).entitled,
        true,
        "period-end cancellation keeps paid benefit",
    );
    await apply(await sync(), "past_due", null);
    check((await call("pay_membership_record", [owner, "sandbox"])).entitled, false, "unpaid renewal no benefit");
    await apply(await sync(), "active", periodEnd, true);
    check(
        (await call("pay_membership_record", [owner, "sandbox"])).entitled,
        false,
        "refunded/disputed review revokes benefit",
    );
    await apply(await sync(), "active", new Date(Date.now() - 1000).toISOString());
    check((await call("pay_membership_record", [owner, "sandbox"])).entitled, false, "expired paid period no benefit");
    await apply(await sync(), "canceled", null);
    const newOperation = id();
    let next = await call("pay_membership_checkout_claim", [owner, "sandbox", newOperation, "workfare-plan-v1", true]);
    await call("pay_membership_checkout_attach", [
        owner,
        "sandbox",
        next.checkout.id,
        "cs_test_newFixture",
        new Date(Date.now() + 3600000).toISOString(),
        false,
    ]);
    await call("pay_membership_sync_apply", [
        owner,
        "sandbox",
        await sync(),
        "sub_newFixture",
        "active",
        periodEnd,
        periodEnd,
        false,
        "in_newFixture",
        false,
    ]);
    next = await call("pay_membership_record", [owner, "sandbox"]);
    check(
        next.contractReference !== result.contractReference,
        true,
        "new subscription rotates public contract reference",
    );
    await execute("UPDATE payment_private.configuration SET mode='disabled'");
    const requestId = id(),
        reference = result.contractReference;
    const cancel = (
        email = "provider@membership.invalid",
        ref = reference,
        req = requestId,
        rate = "a".repeat(64),
        kind = "ordinary",
        reason = null,
        date = null,
    ) =>
        call("pay_membership_cancellation_request", [
            ref,
            email,
            "Fixture Provider",
            req,
            rate,
            "sandbox",
            kind,
            reason,
            date,
        ]);
    const receipt = await cancel();
    check(receipt.reference, requestId, "public receipt is random request identifier");
    check(
        Object.keys(receipt).sort(),
        ["receivedAt", "reference"],
        "receipt never reveals subscription or account existence",
    );
    check(await cancel(), receipt, "same cancellation declaration replays exactly");
    const job = await call("pay_membership_cancellation_take", [requestId, operation]);
    check(job.userId, owner, "exact reference and account email required");
    check(
        job.subscriptionRef,
        "sub_membershipFixture",
        "old declaration stays bound to old subscription after resubscribe",
    );
    check(job.reviewRequired, false, "ordinary earliest is automatic");
    check(
        await call("pay_membership_cancellation_take", [requestId, id()]),
        null,
        "only one cancellation worker lease",
    );
    await call("pay_membership_cancellation_complete", [requestId, operation, new Date().toISOString(), true]);
    const unknownId = id(),
        unknown = await cancel("other@membership.invalid", reference, unknownId);
    check(Object.keys(unknown).sort(), ["receivedAt", "reference"], "unknown combination same response shape");
    check(
        await call("pay_membership_cancellation_take", [unknownId, id()]),
        null,
        "no unauthorized cancellation created",
    );
    const customId = id();
    await cancel(
        "provider@membership.invalid",
        reference,
        customId,
        "b".repeat(64),
        "extraordinary",
        "Serious reason",
        "2026-10-25",
    );
    check(
        (await call("pay_membership_cancellation_take", [customId, id()])).reviewRequired,
        true,
        "extraordinary requested date preserved for review",
    );
    const withdrawalId = id();
    await cancel("provider@membership.invalid", next.contractReference, withdrawalId, "c".repeat(64), "withdrawal");
    const withdrawal = await call("pay_membership_cancellation_take", [withdrawalId, id()]);
    check(withdrawal.kind, "withdrawal", "withdrawal needs no reason");
    check(withdrawal.reviewRequired, true, "withdrawal requires legal refund review");
    check(withdrawal.subscriptionRef, "sub_newFixture", "current declaration binds current contract");
    check(
        await call("pay_membership_cancellation_review_count", ["sandbox"]),
        2,
        "unresolved custom declarations stay visible to operations",
    );
    for (let i = 0; i < 3; i++) await cancel("other@membership.invalid", id(), id());
    await assert.rejects(cancel("other@membership.invalid", id(), id()), /MEMBERSHIP_RATE_LIMITED/);
    checks++;
    for (const role of ["anon", "authenticated"]) {
        await assert.rejects(call("pay_membership_record", [owner, "sandbox"], role, owner), /permission denied/);
        checks++;
        await assert.rejects(
            execute(asRole(role, owner, "SELECT*FROM public.pay_membership_cancellation_pending('sandbox')")),
            /permission denied/,
        );
        checks++;
    }
    check(
        await json(
            "SELECT to_json(bool_and(NOT prosecdef))FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE'pay_membership_%'",
        ),
        true,
        "public wrappers all invoker-only",
    );
    check(
        await json(
            "SELECT to_json(count(*))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='payment_private'AND c.relname LIKE'membership%'AND c.relkind='r'AND NOT c.relrowsecurity",
        ),
        0,
        "all new tables RLS",
    );
    console.log(
        JSON.stringify({ ok: true, checks, hostedWrites: 0, stripeRequests: 0, moneyMoved: 0, externalMessages: 0 }),
    );
} finally {
    await dispose();
}
