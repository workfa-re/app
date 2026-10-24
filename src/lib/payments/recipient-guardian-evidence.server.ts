import "server-only";
import type Stripe from "stripe";
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

/** Only classifies provider errors; raw messages, names and request data never reach the browser. */
export function minorProviderError(error: unknown): never {
    if (error instanceof PaymentFlowError) throw error;
    const value=error && typeof error === "object" ? error as {code?:unknown;param?:unknown;message?:unknown} : {};
    const classification = [value.code,value.param,value.message].filter(item=>typeof item==="string").join(" ");
    throw new PaymentFlowError(/(?:unsupported|not supported|guardian|under.?18|date_of_birth|\bdob\b|country|dashboard)/i.test(classification)
        ? "recipient_country_model_unsupported" : "recipient_onboarding_unavailable", 409);
}
