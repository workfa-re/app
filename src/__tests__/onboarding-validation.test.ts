import { afterAll, describe, expect, it } from "vitest";
import { getOnboardingCompanyError, getOnboardingProfileError, getProviderOnboardingAddressError, validateOnboardingBirthdate } from "@/lib/onboarding-validation";

const originalTimezone = process.env.TZ;
afterAll(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe.each(["Europe/Berlin", "America/Los_Angeles", "Pacific/Auckland"])("onboarding calendar validation in %s", (timezone) => {
  const validate = (date: string, role: "youth" | "adult" | "company" = "youth") => {
    process.env.TZ = timezone;
    return validateOnboardingBirthdate(date, role, new Date(2026, 9, 22, 12));
  };

  it("accepts a fourteenth birthday today, but not tomorrow", () => {
    expect(validate("2012-10-22").error).toBeNull();
    expect(validate("2012-10-23").error).toContain("mindestens 14");
  });

  it("keeps the twenty-first birthday outside the youth age range", () => {
    expect(validate("2005-10-23").error).toBeNull();
    expect(validate("2005-10-22").error).toContain("14 bis 20");
  });

  it("requires an eighteenth birthday for both provider roles", () => {
    for (const role of ["adult", "company"] as const) {
      expect(validate("2008-10-22", role).error).toBeNull();
      expect(validate("2008-10-23", role).error).toContain("mindestens 18");
    }
  });

  it("validates leap days and calendar boundaries without rolling them over", () => {
    expect(validate("2008-02-29").value).toBe("2008-02-29");
    for (const date of ["2009-02-29", "2010-04-31", "2010-00-15", "2010-12-00", "0000-01-01"]) {
      expect(validate(date).value).toBe("");
      expect(validate(date).error).toContain("gültiges Datum");
    }
  });

  it("rejects partial dates, future dates and dates beyond the database limit", () => {
    expect(validate("2010-10-").value).toBe("");
    expect(validate("2027-10-22").error).toContain("prüfe dein Geburtsdatum");
    expect(validate("1906-10-22", "adult").error).toBeNull();
    expect(validate("1906-10-21", "adult").error).toContain("prüfe dein Geburtsdatum");
  });
});

describe("validation before saving edited summary data", () => {
  it("rechecks the existing birthdate against a newly selected role", () => {
    const profile = { fullName: "Test Person", birthdate: "2010-10-22", role: "youth" as const };
    const now = new Date(2026, 9, 22, 12);
    expect(getOnboardingProfileError(profile, now)).toBeNull();
    expect(getOnboardingProfileError({ ...profile, role: "adult" }, now)).toContain("mindestens 18");
  });

  it("rejects missing or oversized profile names before a server action", () => {
    const profile = { fullName: " ", birthdate: "2000-01-01", role: "adult" as const };
    expect(getOnboardingProfileError(profile)).toContain("vollständigen Namen");
    expect(getOnboardingProfileError({ ...profile, fullName: "x".repeat(121) })).toContain("120 Zeichen");
  });

  it("requires valid company data when an edited role becomes an organisation", () => {
    const company = { companyName: "Test GmbH", companyEmail: "company@example.test", companyMessage: "Wir suchen Unterstützung." };
    expect(getOnboardingCompanyError(company)).toBeNull();
    expect(getOnboardingCompanyError({ ...company, companyName: " " })).toContain("Organisation");
    expect(getOnboardingCompanyError({ ...company, companyEmail: "invalid" })).toContain("E-Mail-Adresse");
    expect(getOnboardingCompanyError({ ...company, companyMessage: "" })).toContain("Nachricht");
    expect(getOnboardingCompanyError({ ...company, companyMessage: "x".repeat(2001) })).toContain("2000 Zeichen");
  });
});


describe("provider home address validation", () => {
  const address = { street: "Musterweg", houseNumber: "12a", city: "Rheinbach", zip: "53359", latitude: 50.63, longitude: 6.95 };
  it("accepts a complete selected address", () => {
    expect(getProviderOnboardingAddressError(address)).toBeNull();
  });
  it("requires the house number, postcode and city without accepting a free-text-only address", () => {
    for (const value of [undefined, null, { ...address, houseNumber: "" }, { ...address, zip: "5335" }, { ...address, city: "" }]) {
      expect(getProviderOnboardingAddressError(value)).toContain("vollständige Adresse");
    }
  });
  it("requires real finite coordinates from the selected result", () => {
    for (const patch of [{ latitude: null }, { longitude: Infinity }, { latitude: NaN }, { latitude: 91 }, { longitude: -181 }]) {
      expect(getProviderOnboardingAddressError({ ...address, ...patch })).toContain("Suchvorschlägen");
    }
  });
});
