import type { OnboardingRole } from "@/lib/types";

/** Parse calendar dates without treating an ISO date-only value as UTC. */
export function validateOnboardingBirthdate(value: string, role?: OnboardingRole | null, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { value: "", error: "Bitte gib dein Geburtsdatum vollständig ein." };

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value: "", error: "Bitte gib ein gültiges Datum ein." };
  }

  let age = now.getFullYear() - year;
  if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age -= 1;

  const oldest = new Date(now);
  oldest.setFullYear(now.getFullYear() - 120);
  oldest.setHours(0, 0, 0, 0);
  if (date > now || date < oldest) return { value, error: "Bitte prüfe dein Geburtsdatum." };
  if (role === "youth" && age < 14) {
    return { value, error: "Du musst für Workfare mindestens 14 Jahre alt sein." };
  }
  if (role === "youth" && age >= 21) {
    return { value, error: "Ein Jobsuchenden-Konto ist für Jugendliche von 14 bis 20 Jahren vorgesehen." };
  }
  if (role && role !== "youth" && age < 18) {
    return { value, error: "Für diese Rolle musst du mindestens 18 Jahre alt sein." };
  }
  return { value, error: null };
}

export function getOnboardingProfileError(profile: { fullName: string; birthdate: string; role: OnboardingRole | null }, now = new Date()) {
  const name = profile.fullName.trim();
  if (name.length < 2 || name.length > 120) return "Bitte gib deinen vollständigen Namen mit 2 bis 120 Zeichen ein.";
  return validateOnboardingBirthdate(profile.birthdate, profile.role, now).error;
}

export function getOnboardingCompanyError(company: { companyName: string; companyEmail: string; companyMessage: string }) {
  if (!company.companyName.trim() || company.companyName.trim().length > 160) return "Bitte gib den Namen deiner Organisation mit höchstens 160 Zeichen ein.";
  const email = company.companyEmail.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Bitte gib eine gültige E-Mail-Adresse deiner Organisation ein.";
  if (!company.companyMessage.trim() || company.companyMessage.trim().length > 2000) return "Bitte ergänze eine Nachricht mit höchstens 2000 Zeichen.";
  return null;
}
