import "server-only";
import type Stripe from "stripe";
import { isIP } from "node:net";
import { ageInBerlin } from "@/lib/age";
import type { GuardianEvidence, GuardianRecipientReason, RecipientMinorBinding } from "./recipient-minor-types";
import { PaymentFlowError } from "./runtime.server";

export function stripeBirthdate(value: { day?: number | null; month?: number | null; year?: number | null } | null | undefined): string | null {
    if (!value || !Number.isInteger(value.day) || !Number.isInteger(value.month) || !Number.isInteger(value.year)) return null;
    const text = `${String(value.year).padStart(4,"0")}-${String(value.month).padStart(2,"0")}-${String(value.day).padStart(2,"0")}`;
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === text ? text : null;
}
export function minorStripeBirthdate(binding: RecipientMinorBinding) {
    const age = ageInBerlin(binding.childBirthdate);
    if (age === null || age < 14 || age > 17) throw new PaymentFlowError("recipient_minor_age_invalid", 409);
    const [year,month,day] = binding.childBirthdate.split("-").map(Number);
    return { day,month,year };
}
const name = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("de-DE");

/** A role flag is insufficient: require the actually verified bound adult and real Stripe acceptance. */
export function guardianEvidenceFromPersons(page: Stripe.ApiList<Stripe.Person>, accountRef: string, binding: RecipientMinorBinding, now=Date.now()):
    { evidence: GuardianEvidence | null; reason: GuardianRecipientReason | null } {
    if (page.object !== "list" || !Array.isArray(page.data) || page.data.length>100 || page.has_more !== false) return { evidence:null,reason:"guardian_kyc_required" };
    const matches = page.data.filter(person => person.account === accountRef && /^person_[A-Za-z0-9]+$/.test(person.id)
        && person.relationship?.legal_guardian === true && person.verification?.status === "verified"
        && stripeBirthdate(person.dob) === binding.guardianBirthdate && (ageInBerlin(binding.guardianBirthdate) ?? -1) >= 18
        && typeof person.email === "string" && person.email.trim().toLowerCase() === binding.guardianEmail.trim().toLowerCase()
        && name(`${person.first_name ?? ""} ${person.last_name ?? ""}`) === name(binding.guardianName));
    if (matches.length !== 1) return { evidence:null,reason:page.data.some(person=>person.relationship?.legal_guardian && person.verification?.status==="verified") ? "guardian_identity_mismatch" : "guardian_kyc_required" };
    const person = matches[0], accepted = person.additional_tos_acceptances?.account?.date;
    if (!Number.isSafeInteger(accepted) || !accepted || accepted<1 || accepted*1000>now) return { evidence:null,reason:"guardian_terms_required" };
    return { evidence:{personRef:person.id,tosAcceptedAt:new Date(accepted*1000).toISOString()},reason:null };
}

/** Accounts v2 has no per-person "verified" flag. This is acceptance evidence
 * paired with Stripe's actual completed account requirements and capabilities;
 * it is never presented as an independent identity-document verification. */
export function guardianEvidenceFromV2Persons(page: Stripe.V2List<Stripe.V2.Core.AccountPerson>, account: Stripe.V2.Core.Account, binding: RecipientMinorBinding, now=Date.now()):
    { evidence: GuardianEvidence | null; reason: GuardianRecipientReason | null } {
    const unavailable = { evidence: null, reason: "guardian_kyc_required" as const };
    const capabilities = account.configuration?.recipient?.capabilities?.stripe_balance;
    if (account.livemode !== true || account.closed || account.identity?.country?.toUpperCase() !== "DE"
        || account.identity.entity_type !== "individual" || account.dashboard !== "none"
        || account.metadata?.workfare_pay_minor_guardian !== binding.guardianId
        || account.metadata.workfare_pay_minor_consent !== binding.consentId
        || account.metadata.workfare_pay_minor_birthdate !== binding.childBirthdate
        || stripeBirthdate(account.identity.individual?.date_of_birth) !== binding.childBirthdate
        || capabilities?.stripe_transfers?.status !== "active" || capabilities.payouts?.status !== "active"
        || !Array.isArray(account.requirements?.entries) || account.requirements.entries.length !== 0
        || !Array.isArray(page.data) || page.data.length > 20 || page.next_page_url !== null
        || page.data.some(person => person.livemode !== true || person.account !== account.id || !/^person_[A-Za-z0-9]+$/.test(person.id))) return unavailable;
    const guardians = page.data.filter(person => person.relationship?.legal_guardian === true);
    if (guardians.length !== 1) return unavailable;
    const person = guardians[0];
    if (stripeBirthdate(person.date_of_birth) !== binding.guardianBirthdate || (ageInBerlin(binding.guardianBirthdate) ?? -1) < 18
        || person.email?.trim().toLowerCase() !== binding.guardianEmail.trim().toLowerCase()
        || name(`${person.given_name ?? ""} ${person.surname ?? ""}`) !== name(binding.guardianName)) {
        return { evidence: null, reason: "guardian_identity_mismatch" };
    }
    const acceptance = person.additional_terms_of_service?.account;
    const accepted = acceptance?.date ? Date.parse(acceptance.date) : NaN;
    const accountAcceptance = account.identity.attestations?.terms_of_service?.account;
    const accountAccepted = accountAcceptance?.date;
    if (!Number.isFinite(accepted) || accepted < Date.UTC(2000,0,1) || accepted > now || !acceptance?.ip || !isIP(acceptance.ip)
        || !accountAccepted || !Number.isFinite(Date.parse(accountAccepted)) || Date.parse(accountAccepted) > now
        || Date.parse(accountAccepted) < Date.UTC(2000,0,1) || !accountAcceptance?.ip || !isIP(accountAcceptance.ip)) {
        return { evidence: null, reason: "guardian_terms_required" };
    }
    return { evidence: { personRef: person.id, tosAcceptedAt: new Date(accepted).toISOString() }, reason: null };
}

/** Only classifies provider errors; raw messages, names and request data never reach the browser. */
export function minorProviderError(error: unknown): never {
    if (error instanceof PaymentFlowError) throw error;
    const value=error && typeof error === "object" ? error as {code?:unknown;param?:unknown;message?:unknown} : {};
    const classification = [value.code,value.param,value.message].filter(item=>typeof item==="string").join(" ");
    throw new PaymentFlowError(/(?:unsupported|not supported|guardian|under.?18|date_of_birth|\bdob\b|country|dashboard)/i.test(classification)
        ? "recipient_country_model_unsupported" : "recipient_onboarding_unavailable", 409);
}
