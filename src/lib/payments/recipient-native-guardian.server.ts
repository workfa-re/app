import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type Stripe from "stripe";
import { ageInBerlin } from "@/lib/age";
import type { PaymentMode } from "./types";
import type { RecipientMinorBinding } from "./recipient-minor-types";
import type { VerifiedRecipientState } from "./recipient-types";
import type { NativeGuardianAddress, NativeGuardianEvidence, NativeGuardianInput, NativeGuardianStripeSetup } from "./guardian-native.server";
import { getRecipientAccount } from "./recipient-repository.server";
import { stripeBirthdate, minorProviderError } from "./recipient-guardian-evidence.server";
import { assertStripeModeObject } from "./stripe-mode.server";
import { PaymentFlowError } from "./runtime.server";

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
const sameName = (first: string, last: string, expected: string) => normalize(`${first} ${last}`) === normalize(expected);
const mismatch = (): never => { throw new PaymentFlowError("guardian_native_identity_mismatch", 409); };
const version = "workfare-pay-guardian-2026-10-24-v1";
const dob = (value: string) => { const [year, month, day] = value.split("-").map(Number); return { year, month, day }; };
const splitName = (value: string) => { const [givenName, ...surname] = value.trim().split(/\s+/); return { givenName, surname: surname.join(" ") }; };
const address = (value: Stripe.V2.Core.AccountPerson.Address | null | undefined): NativeGuardianAddress | null =>
    value?.country === "DE" && value.line1 && value.city && /^\d{5}$/.test(value.postal_code ?? "")
        ? { line1: value.line1, city: value.city, postalCode: value.postal_code!, country: "DE" } : null;
const stripeAddress = (value: NativeGuardianAddress) => ({ line1: value.line1, postal_code: value.postalCode, city: value.city, country: value.country });

/** First-party requirement collection. It never creates a parent account or moves funds. */
export function createNativeGuardianStripeAdapter(context: {
    mode: PaymentMode;
    sdk: () => Promise<Stripe>;
    retrieve: (userId: string, accountRef: string) => Promise<Stripe.V2.Core.Account>;
    inspect: (userId: string, accountRef: string, binding: RecipientMinorBinding) => Promise<VerifiedRecipientState>;
}) {
    async function current(userId: string, accountRef: string, binding: RecipientMinorBinding) {
        if (context.mode !== "live") throw new PaymentFlowError("recipient_guardian_live_required", 409);
        const [account, stored] = await Promise.all([context.retrieve(userId, accountRef), getRecipientAccount(userId, "live")]);
        if (!stored) return mismatch();
        if (stored.userId !== userId || stored.accountRef !== accountRef || !stored.displayName
            || stored.birthdate !== binding.childBirthdate || !stored.minorBinding
            || Object.entries(binding).some(([key, value]) => stored.minorBinding?.[key as keyof RecipientMinorBinding] !== value)
            || account.metadata?.workfare_pay_minor_guardian !== binding.guardianId
            || account.metadata?.workfare_pay_minor_consent !== binding.consentId
            || account.metadata?.workfare_pay_minor_birthdate !== binding.childBirthdate
            || stripeBirthdate(account.identity?.individual?.date_of_birth) !== binding.childBirthdate
            || (ageInBerlin(binding.childBirthdate) ?? 0) < 14 || (ageInBerlin(binding.childBirthdate) ?? 18) >= 18
            || (ageInBerlin(binding.guardianBirthdate) ?? 0) < 18
            || account.defaults?.responsibilities?.requirements_collector !== "application") mismatch();
        const page = await (await context.sdk()).v2.core.accounts.persons.list(accountRef, { limit: 20 });
        if (!Array.isArray(page.data) || page.data.length > 20 || page.next_page_url !== null) mismatch();
        for (const person of page.data) {
            assertStripeModeObject(person, "live");
            if (person.account !== accountRef || !/^person_[A-Za-z0-9]+$/.test(person.id)) mismatch();
        }
        const guardians = page.data.filter(person => person.relationship?.legal_guardian === true);
        if (guardians.length > 1) mismatch();
        const guardian = guardians[0] ?? null;
        if (guardian && ((guardian.given_name && guardian.surname && !sameName(guardian.given_name, guardian.surname, binding.guardianName))
            || (guardian.date_of_birth && stripeBirthdate(guardian.date_of_birth) !== binding.guardianBirthdate)
            || (guardian.email && guardian.email.toLowerCase() !== binding.guardianEmail.toLowerCase())
            || (guardian.metadata?.workfare_pay_guardian && guardian.metadata.workfare_pay_guardian !== binding.guardianId)
            || (guardian.metadata?.workfare_pay_minor_consent && guardian.metadata.workfare_pay_minor_consent !== binding.consentId))) mismatch();
        return { account, stored, guardian };
    }

    function requirements(account: Stripe.V2.Core.Account, guardian: Stripe.V2.Core.AccountPerson | null) {
        const entries = account.requirements?.entries;
        if (!Array.isArray(entries) || entries.length > 100) throw new PaymentFlowError("guardian_native_requirements_unavailable", 503);
        const due = entries.filter(entry => entry.awaiting_action_from === "user").map(entry => {
            const raw = entry.description ?? "additional_verification";
            const field = guardian ? raw.replace(`${guardian.id}.`, "legal_guardian.") : raw;
            return /^[A-Za-z0-9_.]{1,300}$/.test(field) && !field.includes("person_") ? field : "additional_verification";
        });
        const known = (field: string) => /^(?:defaults\.profile\.(?:business_url|product_description)|identity\.attestations\.terms_of_service\.account\.(?:date|ip|user_agent)|identity\.individual\.(?:given_name|surname|date_of_birth(?:\.(?:day|month|year))?|address\.(?:line1|city|postal_code|country))|legal_guardian(?:\.(?:given_name|surname|first_name|last_name|email|date_of_birth(?:\.(?:day|month|year))?|dob\.(?:day|month|year)|address\.(?:line1|city|postal_code|country)|additional_terms_of_service\.account\.(?:date|ip|user_agent)|additional_tos_acceptances\.account\.(?:date|ip|user_agent)))?)$/.test(field);
        return { due, childAddressRequired: due.some(field => field.startsWith("identity.individual.address.")),
            guardianAddressRequired: due.some(field => field.startsWith("legal_guardian.address.")), unsupported: due.some(field => !known(field)) };
    }

    return {
        async readNativeGuardianSetup(userId: string, accountRef: string, binding: RecipientMinorBinding): Promise<NativeGuardianStripeSetup> {
            const { account, stored, guardian } = await current(userId, accountRef, binding);
            const fields = requirements(account, guardian);
            const individual = account.identity?.individual;
            const childName = splitName(stored.displayName!), parentName = splitName(binding.guardianName);
            if (!childName.surname || !parentName.surname) throw new PaymentFlowError("guardian_profile_correction_required", 409);
            let ready = false;
            try { ready = (await context.inspect(userId, accountRef, binding)).status === "ready"; }
            catch (error) { if (!(error instanceof PaymentFlowError) || !["recipient_identity_unconfirmed", "recipient_identity_mismatch"].includes(error.code)) throw error; }
            const submitted = !!guardian?.additional_terms_of_service?.account?.date
                && !!account.identity?.attestations?.terms_of_service?.account?.date
                && !!individual?.given_name && !!individual.surname;
            return { childGivenName: individual?.given_name ?? childName.givenName, childSurname: individual?.surname ?? childName.surname,
                guardianGivenName: guardian?.given_name ?? parentName.givenName, guardianSurname: guardian?.surname ?? parentName.surname,
                childAddress: address(individual?.address), guardianAddress: address(guardian?.address),
                childAddressRequired: fields.childAddressRequired, guardianAddressRequired: fields.guardianAddressRequired,
                requirements: fields.due, canSubmit: !ready && !fields.unsupported && !(submitted && fields.due.length === 0), needsAdditionalVerification: fields.unsupported, ready };
        },
        async saveNativeGuardianSetup(userId: string, accountRef: string, binding: RecipientMinorBinding, input: NativeGuardianInput, evidence: NativeGuardianEvidence, operationId: string): Promise<void> {
            const acceptedAt = Date.parse(evidence.date);
            if (!isIP(evidence.ip) || !Number.isFinite(acceptedAt) || acceptedAt > Date.now() + 5_000 || acceptedAt < Date.now() - 24 * 60 * 60_000
                || !evidence.userAgent || evidence.userAgent.length > 512 || /[\u0000-\u001f\u007f]/.test(evidence.userAgent)
                || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) throw new PaymentFlowError("guardian_native_acceptance_required", 409);
            const { account, stored, guardian } = await current(userId, accountRef, binding);
            const validName = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
            if (![input.child.givenName,input.child.surname,input.guardian.givenName,input.guardian.surname].every(validName)) mismatch();
            if (!sameName(input.child.givenName, input.child.surname, stored.displayName!)
                || !sameName(input.guardian.givenName, input.guardian.surname, binding.guardianName)) mismatch();
            const fields = requirements(account, guardian);
            if (fields.unsupported) throw new PaymentFlowError("guardian_native_remediation_required", 409);
            const validAddress = (value: NativeGuardianAddress | undefined) => value?.country === "DE" && /^\d{5}$/.test(value.postalCode)
                && typeof value.line1 === "string" && value.line1.trim().length > 0 && value.line1.length <= 160
                && typeof value.city === "string" && value.city.trim().length > 0 && value.city.length <= 100
                && !/[\u0000-\u001f\u007f]/.test(value.line1 + value.city);
            if (fields.childAddressRequired && !validAddress(input.child.address) || fields.guardianAddressRequired && !validAddress(input.guardian.address)) throw new PaymentFlowError("guardian_native_address_required");
            const stripe = await context.sdk();
            const acceptance = { date: evidence.date, ip: evidence.ip, user_agent: evidence.userAgent };
            const metadata = { workfare_pay_guardian: binding.guardianId, workfare_pay_minor_consent: binding.consentId,
                workfare_pay_declaration: version, workfare_pay_operation: operationId };
            const guardianData = { given_name: input.guardian.givenName, surname: input.guardian.surname, email: binding.guardianEmail,
                date_of_birth: dob(binding.guardianBirthdate), relationship: { legal_guardian: true }, metadata,
                ...(fields.guardianAddressRequired && input.guardian.address ? { address: stripeAddress(input.guardian.address) } : {}),
                additional_terms_of_service: { account: acceptance } };
            try {
                const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
                const saved = guardian
                    ? await stripe.v2.core.accounts.persons.update(accountRef, guardian.id, guardianData,
                        { idempotencyKey: `workfare:guardian-update:${accountRef}:${operationId}:${fingerprint(guardianData)}` })
                    : await stripe.v2.core.accounts.persons.create(accountRef, guardianData,
                        { idempotencyKey: `workfare:guardian-create:${accountRef}:${binding.consentId}` });
                assertStripeModeObject(saved, "live");
                if (!/^person_[A-Za-z0-9]+$/.test(saved.id) || (guardian && saved.id !== guardian.id)
                    || saved.id === account.identity?.individual?.id || saved.account !== accountRef || saved.relationship?.legal_guardian !== true
                    || !sameName(saved.given_name ?? "", saved.surname ?? "", binding.guardianName)
                    || stripeBirthdate(saved.date_of_birth) !== binding.guardianBirthdate
                    || saved.email?.toLowerCase() !== binding.guardianEmail.toLowerCase()
                    || saved.metadata?.workfare_pay_guardian !== binding.guardianId || saved.metadata.workfare_pay_minor_consent !== binding.consentId
                    || saved.metadata.workfare_pay_declaration !== version || saved.metadata.workfare_pay_operation !== operationId
                    || saved.additional_terms_of_service?.account?.date !== evidence.date
                    || saved.additional_terms_of_service.account.ip !== evidence.ip
                    || saved.additional_terms_of_service.account.user_agent !== evidence.userAgent) mismatch();
                // Agreement acceptance is the verified parent's current request,
                // never a fabricated acceptance by the minor or by the platform.
                const update = { identity: { individual: { given_name: input.child.givenName, surname: input.child.surname,
                    ...(fields.childAddressRequired && input.child.address ? { address: stripeAddress(input.child.address) } : {}) },
                    attestations: { terms_of_service: { account: acceptance } } },
                    defaults: { profile: { product_description: "Gelegentliche, altersgerechte Nachbarschaftshilfe über Workfare." } },
                    include: ["configuration.recipient", "requirements", "identity", "defaults"] as Stripe.V2.Core.AccountUpdateParams["include"] };
                const updated = await stripe.v2.core.accounts.update(accountRef, update,
                    { idempotencyKey: `workfare:guardian-account:${accountRef}:${operationId}:${fingerprint(update)}` });
                assertStripeModeObject(updated, "live");
                const agreement = updated.identity?.attestations?.terms_of_service?.account;
                if (updated.id !== accountRef || updated.metadata?.workfare_pay_user !== userId
                    || updated.metadata.workfare_pay_minor_guardian !== binding.guardianId || updated.metadata.workfare_pay_minor_consent !== binding.consentId
                    || !sameName(updated.identity?.individual?.given_name ?? "", updated.identity?.individual?.surname ?? "", stored.displayName!)
                    || stripeBirthdate(updated.identity?.individual?.date_of_birth) !== binding.childBirthdate
                    || agreement?.date !== evidence.date || agreement.ip !== evidence.ip || agreement.user_agent !== evidence.userAgent) mismatch();
            } catch (error) { minorProviderError(error); }
        },
    };
}
