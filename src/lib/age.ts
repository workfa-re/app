const berlinCalendar = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Date-only age for German product gates. Invalid or future dates never grant access. */
export function ageInBerlin(birthdate: string | null | undefined, now = new Date()): number | null {
    if (typeof birthdate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || !Number.isFinite(now.getTime())) return null;
    const parsed = new Date(`${birthdate}T12:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthdate) return null;
    const parts = berlinCalendar.formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(value => value.type === type)?.value);
    const year = part("year"), month = part("month"), day = part("day");
    const [birthYear, birthMonth, birthDay] = birthdate.split("-").map(Number);
    const age = year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
    return age >= 0 ? age : null;
}

export function isAdultBirthdate(birthdate: string | null | undefined, now = new Date()) {
    const age = ageInBerlin(birthdate, now);
    return age !== null && age >= 18;
}
