import { describe, expect, it } from "vitest";
import { getInitialOnboardingRole, getOnboardingEntryStep, mustChooseOnboardingRole } from "@/lib/onboardingFlow";
import type { Profile } from "@/lib/types";

const defaultedJobSeekerProfile = {
  id: "user-1",
  account_type: "job_seeker",
  provider_kind: null,
} as Profile;

describe("onboarding entry and resumption", () => {
  it("opens sign-in directly even when an unfinished registration exists", () => {
    expect(getOnboardingEntryStep({ initialMode: "signin", draftStep: "profile" })).toBe("auth");
  });

  it("starts an explicit registration with the regional availability check", () => {
    expect(getOnboardingEntryStep({ initialMode: "signup", draftStep: "email-confirm" })).toBe("location");
  });

  it("keeps the server-required confirmation and profile states ahead of public entry preferences", () => {
    expect(getOnboardingEntryStep({ forcedStep: "email-confirm", initialMode: "signin" })).toBe("email-confirm");
    expect(getOnboardingEntryStep({ forcedStep: "role", initialMode: "signup" })).toBe("role");
  });

  it("resumes a registration without imposing the old account-choice screen", () => {
    expect(getOnboardingEntryStep({ draftStep: "mode" })).toBe("welcome");
    expect(getOnboardingEntryStep({ draftStep: "profile" })).toBe("profile");
    expect(getOnboardingEntryStep({})).toBe("welcome");
  });
});

describe("onboarding role selection", () => {
  it("does not treat the database job_seeker default as an explicit role after email confirmation", () => {
    expect(
      getInitialOnboardingRole({
        profile: defaultedJobSeekerProfile,
        forcedStep: "email-confirm",
        isJustVerified: true,
      }),
    ).toBeNull();
  });

  it("forces the role screen for incomplete authenticated profiles", () => {
    expect(mustChooseOnboardingRole("role", false)).toBe(true);
    expect(
      getInitialOnboardingRole({
        profile: defaultedJobSeekerProfile,
        forcedStep: "role",
        isJustVerified: false,
      }),
    ).toBeNull();
  });

  it("can still infer a role outside the forced onboarding path", () => {
    expect(
      getInitialOnboardingRole({
        profile: defaultedJobSeekerProfile,
        forcedStep: null,
        isJustVerified: false,
      }),
    ).toBe("youth");
  });
});
