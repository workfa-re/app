"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion, type MotionProps } from "framer-motion";
import { OnboardingFrame, OnboardingHeading as CardHeader, OnboardingChoice as ChoiceTile } from "./onboarding/OnboardingFrame";
import { ButtonPrimary } from "./ui/ButtonPrimary";
import { ButtonSecondary } from "./ui/ButtonSecondary";
import { Loader } from "./ui/Loader";
import { signUpWithEmail, signInWithEmail } from "@/lib/authClient";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { useEmailResend } from "@/lib/hooks/useEmailResend";
import { type OnboardingRole, type Profile } from "@/lib/types";
import { safeInternalRedirectOr } from "@/lib/safe-redirect";
import { readBrandStorage, writeBrandStorage, removeBrandStorage } from "@/lib/brand-storage";
import { ArrowRight, BriefcaseBusiness, HandHeart, Building2, Mail, Eye, EyeOff, Pencil, ShieldCheck } from "lucide-react";
import { LocationStep } from "./onboarding/LocationStep";
import { CinematicDateInput } from "@/components/ui/CinematicDateInput";
import { getOnboardingCompanyError, getOnboardingProfileError } from "@/lib/onboarding-validation";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { guardianReturnPath } from "@/lib/guardian/navigation";
import {
  getInitialOnboardingRole,
  getOnboardingEntryStep,
  inferOnboardingRole,
  mustChooseOnboardingRole,
  type OnboardingStep,
} from "@/lib/onboardingFlow";

type Step = OnboardingStep;

type AuthMode = "signup" | "signin" | null;

type OnboardingDraft = {
  version: 1;
  step: Step;
  mode: AuthMode;
  email: string;
  profileData: {
    role: OnboardingRole | null;
    fullName: string;
    birthdate: string;
    region: string;
    marketId: string | null;
    companyName: string;
    companyEmail: string;
    companyMessage: string;
  };
  updatedAt: number;
};

type OnboardingWizardProps = {
  initialProfile?: Profile | null;
  forcedStep?: Step | null;
  initialEmail?: string;
  initialRegion?: string;
  redirectTo?: string;
  initialMode?: AuthMode;
  isJustVerified?: boolean;
  reserveFooterSpace?: boolean;
  initialError?: string | null;
  providerUpgrade?: boolean;
  familySetup?: boolean;
};

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || "";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ONBOARDING_DRAFT_KEY = "workfare-onboarding-draft:v1";
const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

const STEP_MOTION: MotionProps = {
  initial: { opacity: 0.2, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
};

const isProfileComplete = (profile: Profile | null | undefined) => {
  return Boolean(
    profile?.full_name && profile.birthdate && profile.city && profile.account_type
  );
};

function readOnboardingDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = readBrandStorage(window.localStorage, ONBOARDING_DRAFT_KEY);
    if (!raw) return null;

    const draft = JSON.parse(raw) as OnboardingDraft;
    if (draft.version !== 1 || !draft.updatedAt) return null;
    if (!["welcome", "mode", "location", "auth", "email-confirm", "role", "profile", "contact", "summary"].includes(draft.step)) return null;
    if (![null, "signup", "signin"].includes(draft.mode) || typeof draft.email !== "string" || !draft.profileData) return null;
    if (!["fullName", "birthdate", "region", "companyName", "companyEmail", "companyMessage"].every(key => typeof draft.profileData[key as keyof OnboardingDraft["profileData"]] === "string")) return null;

    if (Date.now() - draft.updatedAt > DRAFT_MAX_AGE_MS) {
      removeBrandStorage(window.localStorage, ONBOARDING_DRAFT_KEY);
      return null;
    }

    return draft;
  } catch {
    removeBrandStorage(window.localStorage, ONBOARDING_DRAFT_KEY);
    return null;
  }
}

function writeOnboardingDraft(draft: Omit<OnboardingDraft, "version" | "updatedAt">) {
  if (typeof window === "undefined") return;

  writeBrandStorage(
    window.localStorage,
    ONBOARDING_DRAFT_KEY,
    JSON.stringify({
      ...draft,
      version: 1,
      updatedAt: Date.now(),
    } satisfies OnboardingDraft),
  );
}

function clearOnboardingDraft() {
  if (typeof window === "undefined") return;
  removeBrandStorage(window.localStorage, ONBOARDING_DRAFT_KEY);
}

type FeedbackTone = "danger" | "warning" | "success";

function OnboardingFeedbackCard({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: FeedbackTone;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="onboarding-feedback-card" data-tone={tone} role="status">
      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="onboarding-feedback-icon">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="onboarding-feedback-title">{title}</h4>
            <div className="onboarding-feedback-copy">
              {children}
            </div>
          </div>
        </div>
        {actions && (
          <div className="onboarding-feedback-actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

function OnboardingInlineFeedback({
  tone = "danger",
  children,
  action,
  className,
}: {
  tone?: FeedbackTone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`onboarding-inline-feedback${className ? ` ${className}` : ""}`} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function OnboardingWizard({
  initialProfile,
  forcedStep = null,
  initialEmail = "",
  initialRegion = "",
  redirectTo,
  initialMode = null,
  isJustVerified = false,
  initialError = null,
  providerUpgrade = false,
  familySetup = false,
}: OnboardingWizardProps) {
  const router = useRouter();
  const safeRedirectTo = safeInternalRedirectOr(redirectTo, "/app-home");
  const [step, setStep] = useState<Step>(() => getOnboardingEntryStep({ forcedStep: forcedStep || (familySetup ? "auth" : null), initialMode }));
  const [mode, setMode] = useState<AuthMode>(initialMode ?? (familySetup ? "signup" : null));
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [checkingRegion, setCheckingRegion] = useState(false);
  const [errorType, setErrorType] = useState<"general" | null>(initialError ? "general" : null);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [editingFromSummary, setEditingFromSummary] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(isJustVerified);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const {
    cooldown: resendCooldown,
    error: resendError,
    loading: resendLoading,
    resend: handleResendConfirmation,
    forceResend: forceResendConfirmation,
    markSent: markConfirmationEmailSent,
  } = useEmailResend(email, familySetup ? guardianReturnPath(safeRedirectTo) || "/guardian/access" : undefined);
  const mustChooseRole = mustChooseOnboardingRole(forcedStep, isJustVerified);

  // Initialwerte aus Session, Profil und lokalem Onboarding-Entwurf zusammenführen.
  const [profileData, setProfileData] = useState({
    role: providerUpgrade ? "adult" as const : getInitialOnboardingRole({ profile: initialProfile, forcedStep, isJustVerified }),
    fullName: initialProfile?.full_name || "",
    birthdate: initialProfile?.birthdate || "",
    region: initialProfile?.city || initialRegion || "",
    marketId: initialProfile?.market_id || null,
    companyName: "",
    companyEmail: "",
    companyMessage: "",
  });
  const [resumeChecked, setResumeChecked] = useState(Boolean(forcedStep || initialEmail || initialProfile));
  const [animateSteps, setAnimateSteps] = useState(false);
  useEffect(() => { if (resumeChecked) setAnimateSteps(true); }, [resumeChecked]);
  const confirmationCheck = useRef<{ email: string; promise: Promise<boolean> } | null>(null);
  const confirmedEmailRef = useRef<string | null>(null);
  const confirmationEpoch = useRef(0);
  const confirmationTransition = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const verifyingCode = useRef(false);

  useEffect(() => () => {
    confirmationEpoch.current += 1;
    confirmationCheck.current = null;
    confirmedEmailRef.current = null;
    if (confirmationTransition.current) clearTimeout(confirmationTransition.current);
  }, [step, email]);

  useEffect(() => {
    const draft = readOnboardingDraft();
    const normalizedInitialEmail = normalizeEmail(initialEmail);
    const normalizedDraftEmail = normalizeEmail(draft?.email);
    const draftMatchesSession = Boolean(draft && (!normalizedInitialEmail || normalizedDraftEmail === normalizedInitialEmail));

    if (draft && draftMatchesSession && !initialMode && !providerUpgrade && !familySetup) {
      setEmail(draft.email);
      setMode(draft.mode);
      setProfileData((prev) => ({
        ...prev,
        ...draft.profileData,
        role: mustChooseRole ? null : draft.profileData.role || prev.role,
        region: draft.profileData.region || prev.region,
        marketId: draft.profileData.marketId || prev.marketId,
      }));

      if (!forcedStep) {
        setStep(getOnboardingEntryStep({ draftStep: draft.step }));
      }
    }

    setResumeChecked(true);
  }, [forcedStep, initialEmail, initialProfile, isJustVerified, mustChooseRole, initialMode, providerUpgrade, familySetup]);

  useEffect(() => {
    if (!resumeChecked) return;
    if (mode === "signin") return;
    if (step === "welcome" && !email && !profileData.region && !profileData.role) return;

    writeOnboardingDraft({
      step,
      mode,
      email,
      profileData,
    });
  }, [email, mode, profileData, resumeChecked, step]);

  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (code.length < 8 || loading || resendLoading || verifyingCode.current) return;
    verifyingCode.current = true;
    setLoading(true);
    setCodeError(null);
    setCodeMessage(null);
    try {
      const { data, error } = await supabaseBrowser.auth.verifyOtp({
        email,
        token: code,
        type: 'signup'
      });
      if (error) throw error;
      const confirmed = await checkSessionAfterEmailConfirm(data.user ?? null);
      if (!confirmed) {
        throw new Error("Bestätigung war erfolgreich, aber die Sitzung konnte nicht übernommen werden. Bitte versuche es erneut.");
      }
    } catch (err: unknown) {
      setCodeError(getErrorMessage(err, "Code ungültig."));
    } finally {
      verifyingCode.current = false;
      setLoading(false);
    }
  };

  const checkSessionAfterEmailConfirm = useCallback(async (verifiedUser?: User | null) => {
    const expectedEmail = normalizeEmail(email);
    if (confirmedEmailRef.current === expectedEmail) return true;
    if (confirmationCheck.current?.email === expectedEmail) return confirmationCheck.current.promise;
    const epoch = confirmationEpoch.current;
    const check = async () => {
      let user = verifiedUser ?? null;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (epoch !== confirmationEpoch.current) return false;
        if (user?.email_confirmed_at) {
          break;
        }

        const { data } = await supabaseBrowser.auth.getUser();
        user = data.user ?? user;
        if (!user?.email_confirmed_at) {
          await wait(250);
        }
      }

      if (!user || epoch !== confirmationEpoch.current) return false;

      const confirmedEmail = normalizeEmail(user.email);
      if (expectedEmail && confirmedEmail && confirmedEmail !== expectedEmail) {
        return false;
      }

      const { data: profile } = await supabaseBrowser
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (epoch !== confirmationEpoch.current) return false;

      const profileTyped = profile as Profile | null;
      const isComplete = isProfileComplete(profileTyped);
      const isConfirmed = !!user.email_confirmed_at;

      if (isConfirmed && (familySetup || guardianReturnPath(safeRedirectTo))) {
        confirmedEmailRef.current = expectedEmail;
        clearOnboardingDraft();
        window.location.href = guardianReturnPath(safeRedirectTo) || "/guardian/access";
        return true;
      }

      if (isConfirmed && isComplete) {
        confirmedEmailRef.current = expectedEmail;
        setEmailConfirmed(true);
        clearOnboardingDraft();
        setCodeMessage("Code bestätigt. Du wirst weitergeleitet...");
        confirmationTransition.current = setTimeout(() => {
          if (epoch === confirmationEpoch.current) window.location.href = safeRedirectTo;
        }, 1000); // Give user a moment to see success
        return true;
      }

      if (isConfirmed) {
        confirmedEmailRef.current = expectedEmail;
        setEmailConfirmed(true);
        setCodeMessage("Code bestätigt. Bitte wähle jetzt deine Rolle.");
        confirmationTransition.current = setTimeout(() => {
          if (epoch !== confirmationEpoch.current) return;
          if (profileTyped) {
            setProfileData((prev) => ({
              ...prev,
              role: null,
              fullName: profileTyped.full_name || prev.fullName,
              birthdate: profileTyped.birthdate || prev.birthdate,
              region: profileTyped.city || prev.region,
              marketId: profileTyped.market_id || prev.marketId,
            }));
          } else {
            setProfileData((prev) => ({
              ...prev,
              role: null,
            }));
          }
          setStep("role");
        }, 1000);
        return true;
      }

      if (profileTyped) {
        setProfileData((prev) => ({
          ...prev,
          role: mustChooseRole ? null : inferOnboardingRole(profileTyped) || prev.role,
          fullName: profileTyped.full_name || prev.fullName,
          birthdate: profileTyped.birthdate || prev.birthdate,
          region: profileTyped.city || prev.region,
          marketId: profileTyped.market_id || prev.marketId,
        }));
      }
      return false;
    };
    const promise = check();
    confirmationCheck.current = { email: expectedEmail, promise };
    try {
      return await promise;
    } finally {
      if (confirmationCheck.current?.promise === promise) confirmationCheck.current = null;
    }
  }, [email, mustChooseRole, safeRedirectTo, familySetup, setEmailConfirmed, setCodeMessage, setStep, setProfileData]);

  useEffect(() => {
    if (step !== "email-confirm") return;

    let disposed = false;
    const deferredChecks = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (session?.user.email_confirmed_at) {
          // Supabase holds its auth lock while notifying subscribers. Defer API
          // calls until this synchronous callback has released that lock.
          const timer = setTimeout(() => {
            deferredChecks.delete(timer);
            if (!disposed) void checkSessionAfterEmailConfirm(session.user).catch(() => {
              if (!disposed) setCodeError("Die Sitzung konnte nicht geprüft werden. Bitte versuche es erneut.");
            });
          }, 0);
          deferredChecks.add(timer);
        }
      }
    });

    const interval = setInterval(async () => {
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        if (!disposed && session?.user.email_confirmed_at) {
          await checkSessionAfterEmailConfirm(session.user);
        }
      } catch {
        // A later poll or the explicit confirmation action can retry.
      }
    }, 3000);

    return () => {
      disposed = true;
      subscription.unsubscribe();
      clearInterval(interval);
      deferredChecks.forEach(clearTimeout);
    };
  }, [step, checkSessionAfterEmailConfirm]);

  useEffect(() => {
    if (isJustVerified && step === "email-confirm") {
      const timer = setTimeout(() => {
        void checkSessionAfterEmailConfirm().catch(() => {
          setCodeError("Die Sitzung konnte nicht geprüft werden. Bitte versuche es erneut.");
        });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isJustVerified, step, checkSessionAfterEmailConfirm]);


  const resumePendingEmailConfirmation = useCallback(async (sourceMode: AuthMode = mode || "signup") => {
    const nextMode = sourceMode || "signup";

    setCode("");
    setCodeError(null);
    setErrorType(null);
    setErrorMsg(null);
    setEmailConfirmed(false);
    writeOnboardingDraft({
      step: "email-confirm",
      mode: nextMode,
      email,
      profileData,
    });
    setMode(nextMode);
    setStep("email-confirm");

    const sent = await forceResendConfirmation("Neuer Bestätigungscode wurde gesendet.");
    setCodeMessage(
      sent
        ? null
        : "Wir haben dein Konto gefunden. Bitte bestätige deine E-Mail mit dem Code. Falls kein neuer Code ankommt, ist der Versand gleich erneut möglich.",
    );
  }, [email, forceResendConfirmation, mode, profileData, setCode, setCodeError, setErrorType, setErrorMsg, setEmailConfirmed, setMode, setStep, setCodeMessage]);

  const handleSignIn = async () => {
    setLoading(true);
    setErrorType(null);
    setErrorMsg(null);
    setResetSuccess(false);

    try {
      const { error } = await signInWithEmail(email.trim(), password);

      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("email not confirmed") || message.includes("not confirmed")) {
          await resumePendingEmailConfirmation("signin");
          return;
        }

        setErrorType("general");
        setErrorMsg("Die Anmeldung war nicht möglich. Prüfe E-Mail-Adresse, Passwort und ob dein Account bereits bestätigt ist.");
        return;
      }

      clearOnboardingDraft();
      window.location.href = safeRedirectTo;
    } catch (err: unknown) {
      setErrorType("general");
      setErrorMsg(getErrorMessage(err, "Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es noch einmal."));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      setErrorType("general");
      setErrorMsg("Bitte gib deine E-Mail oben ein, um das Passwort zurückzusetzen.");
      return;
    }
    setResettingPassword(true);
    setErrorType(null);
    setErrorMsg(null);
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const callback = new URL("/auth/callback", siteUrl);
      const familyReturn = guardianReturnPath(safeRedirectTo);
      callback.searchParams.set("next", familyReturn ? `/auth/update-password?redirectTo=${encodeURIComponent(familyReturn)}` : "/auth/update-password");
      const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, { redirectTo: callback.href });
      if (error) throw error;
      setResetSuccess(true);
    } catch (err: unknown) {
      setErrorType("general");
      setErrorMsg(getErrorMessage(err, "Wir konnten leider keinen Link senden. Versuche es später nochmal."));
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSignUp = async () => {
    setLoading(true);
    setErrorType(null);
    setErrorMsg(null);
    setEmailConfirmed(false);
    setCodeError(null);
    try {
      await import("@/components/payments/recipient-connect-lifecycle")
        .then(({ logoutRecipientConnectSessions }) => logoutRecipientConnectSessions())
        .catch(() => undefined);
      const { error: signOutError } = await supabaseBrowser.auth.signOut();
      if (signOutError) throw signOutError;

      const signUpData = {
        city: profileData.region,
        full_name: "",
        market_id: profileData.marketId
      };
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", familySetup ? guardianReturnPath(safeRedirectTo) || "/guardian/access" : `/onboarding?redirectTo=${encodeURIComponent(safeRedirectTo)}`);
      const { error } = await signUpWithEmail(email, password, familySetup ? { signup_purpose: "family" } : signUpData, callback.toString());

      if (error?.message === "Error sending confirmation email") {
        throw new Error("Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut oder kontaktiere den Support.");
      }

      if (error) throw error;

      markConfirmationEmailSent("Bestätigungs-E-Mail mit Code wurde gesendet.");
      writeOnboardingDraft({
        step: "email-confirm",
        mode: "signup",
        email,
        profileData,
      });
      setCodeMessage(null);
      setStep("email-confirm");
    } catch (err: unknown) {
      setErrorType("general");
      setErrorMsg(getErrorMessage(err, "Registrierung fehlgeschlagen."));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailConfirmation = async () => {
    if (loading || resendLoading) return;
    setLoading(true);
    try {
      await checkSessionAfterEmailConfirm();
    } catch {
      setCodeError("Die Sitzung konnte nicht geprüft werden. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  };

  const handleCompanyContact = async () => {
    const error = getOnboardingCompanyError(profileData);
    if (error) {
      setErrorMsg(error);
      return;
    }
    setErrorMsg(null);
    setEditingFromSummary(false);
    setStep("summary");
  };

  const handleCompleteOnboarding = async () => {
    if (saving.current) return;
    saving.current = true;
    setIsSaving(true);
    setErrorType(null);
    setErrorMsg(null);

    try {
      if (!profileData.role) throw new Error("Keine Rolle ausgewählt.");
      const profileError = getOnboardingProfileError(profileData);
      if (profileError) throw new Error(`${profileError} Bitte prüfe „Profil bearbeiten“.`);
      if (!profileData.region || !profileData.marketId) throw new Error("Bitte prüfe deine Region noch einmal über „Region bearbeiten“.");
      if (profileData.role === "company") {
        const companyError = getOnboardingCompanyError(profileData);
        if (companyError) throw new Error(`${companyError} Bitte prüfe „Organisation bearbeiten“.`);
      }

      const { completeOnboarding } = await import("@/app/onboarding/actions");

      const result = await completeOnboarding({
        full_name: profileData.fullName.trim(),
        birthdate: profileData.birthdate,
        city: profileData.region.trim(),
        market_id: profileData.marketId,
        role: profileData.role as any,
        company_name: profileData.role === "company" ? profileData.companyName : undefined,
        company_email: profileData.role === "company" ? profileData.companyEmail : undefined,
        company_message: profileData.role === "company" ? profileData.companyMessage : undefined,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      clearOnboardingDraft();
      window.location.href = safeRedirectTo;
    } catch (err: unknown) {
      setErrorType("general");
      setErrorMsg(getErrorMessage(err, "Speichern fehlgeschlagen. Bitte versuche es erneut."));
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  const nextStep = () => {
    if (step === "welcome") {
      setStep("mode");
    } else if (step === "mode") {
      if (mode === "signin") {
        setStep("auth");
      } else {
        setStep("location");
      }
    } else if (step === "location") {
      setStep(providerUpgrade ? "summary" : "auth");
    } else if (step === "auth") {
      if (mode === "signup") {
        handleSignUp();
      } else {
        handleSignIn();
      }
    } else if (step === "email-confirm") {
      handleEmailConfirmation();
    } else if (step === "role") {
      if (!profileData.role) {
        setErrorType("general");
        setErrorMsg("Bitte wähle eine Rolle aus.");
        return;
      }
      setStep("profile");
    } else if (step === "profile") {
      const profileError = getOnboardingProfileError(profileData);
      if (profileError) {
        setErrorType("general");
        setErrorMsg(profileError);
        return;
      }

      setErrorMsg(null);
      setErrorType(null);

      if (profileData.role === "company") {
        setStep("contact");
      } else {
        setEditingFromSummary(false);
        setStep("summary");
      }
    } else if (step === "contact") {
      handleCompanyContact();
    } else if (step === "summary") {
      handleCompleteOnboarding();
    }
  };

  const prevStep = () => {
    if (loading || resettingPassword || isSaving || checkingRegion || resendLoading) return;
    if (passwordResetOpen) {
      setPasswordResetOpen(false); setErrorMsg(null); setErrorType(null); setResetSuccess(false);
      return;
    }
    if (editingFromSummary) {
      setEditingFromSummary(false);
      setStep("summary");
      setErrorMsg(null);
      return;
    }
    if (step === "mode") {
      setStep("welcome");
    } else if (step === "location") {
      if (providerUpgrade) { router.push("/guardian/access"); return; }
      setStep("welcome");
    } else if (step === "auth") {
      if (familySetup) { router.push(guardianReturnPath(safeRedirectTo) || "/guardian/access"); return; }
      if (mode === "signup") {
        setStep("location");
      } else {
        setStep("welcome");
      }
    } else if (step === "email-confirm") {
      if (!emailConfirmed && !loading) {
        setCode("");
        setCodeError(null);
        setCodeMessage(null);
        setStep("auth");
      }
    } else if (step === "profile") {
      setStep(providerUpgrade ? "location" : "role");
    } else if (step === "contact") {
      setStep("profile");
    } else if (step === "summary") {
      setStep("profile");
    }
    setErrorType(null);
    setErrorMsg(null);
  };

  const beginAuth = (nextMode: "signup" | "signin") => {
    if (loading || resettingPassword || isSaving) return;
    setMode(nextMode);
    setStep(nextMode === "signin" ? "auth" : "location");
    setPassword("");
    setPasswordResetOpen(false);
    setPasswordVisible(false);
    setResetSuccess(false);
    setErrorType(null);
    setErrorMsg(null);
    setEditingFromSummary(false);
  };
  const editSummary = (nextStep: Step) => {
    setEditingFromSummary(true);
    setErrorMsg(null);
    setStep(nextStep);
  };
  const authBusy = loading || resettingPassword || isSaving || checkingRegion || resendLoading;
  const canGoBack = !authBusy && (["location", "auth", "email-confirm", "profile", "contact", "summary"].includes(step) || editingFromSummary);
  const panelClass = "onboarding-step-panel";
  const emailConfirmStatus = resendError || codeMessage;
  const emailConfirmStatusTone: FeedbackTone = resendError ? "danger" : "success";

  if (!resumeChecked) {
    return (
      <OnboardingFrame step={step} mode={mode}><Loader text="Dein Einstieg wird geladen…" /></OnboardingFrame>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <OnboardingFrame step={step} mode={mode}
        onBack={canGoBack ? prevStep : undefined}>
        {initialError && errorMsg === initialError && step !== "auth" && <OnboardingInlineFeedback>{errorMsg}</OnboardingInlineFeedback>}
        <div className="onboarding-step-transition">
          {(step === "welcome" || step === "mode") && (
            <motion.div key="welcome" className="onboarding-entry-panel" {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}>
              <div className={panelClass}>
                <CardHeader title="Willkommen." subtitle="Finde Jobs oder Unterstützung in deiner Nähe." />
                <div className="onboarding-entry-actions">
                  <button type="button" className="onboarding-primary" onClick={() => beginAuth("signup")}>
                    Konto erstellen <ArrowRight size={20} aria-hidden="true" />
                  </button>
                  <button type="button" className="onboarding-secondary" onClick={() => beginAuth("signin")}>Anmelden</button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Schritt 3 (optional): Location NUR wenn mode="signup" */}
          {step === "location" && (
            <motion.div
              key="location"
              {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
            >
              <div className={panelClass}>
                <LocationStep
                  onBusyChange={setCheckingRegion}
                  onComplete={(regionData) => {
                    setProfileData((prev) => ({
                      ...prev,
                      region: regionData.city,
                      marketId: regionData.region_live_id ?? null,
                    }));
                    setStep(editingFromSummary || providerUpgrade ? "summary" : "auth");
                    setEditingFromSummary(false);
                  }}
                />
              </div>
            </motion.div>
          )}

          {/* Schritt 3: E-Mail & Passwort */}
          {step === "auth" && (
            <motion.div
              key="auth"
              {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
            >
              <div className={panelClass}>

                <CardHeader
                  title={passwordResetOpen ? "Passwort zurücksetzen" : mode === "signup" ? "Konto erstellen" : "Anmelden"}
                  subtitle={passwordResetOpen ? "Wir senden dir einen Link an deine E-Mail-Adresse." : mode === "signup" ? familySetup ? "Dein Familienkonto: Lege deine Zugangsdaten fest und bestätige deine E-Mail." : "Lege deine Zugangsdaten fest. Danach bestätigst du deine E-Mail." : "Schön, dass du wieder bei Workfare bist."}
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (passwordResetOpen) handleResetPassword();
                    else nextStep();
                  }}
                  className="space-y-6"
                >
                  <div className="onboarding-field">
                    <label htmlFor="auth-email" className="mb-2 block text-lg font-medium text-white">
                      E-Mail-Adresse
                    </label>
                    <input
                      id="auth-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setResetSuccess(false); }}
                      className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder="name@beispiel.de"
                      required
                      disabled={loading || resettingPassword}
                    />
                  </div>
                  {!passwordResetOpen && <div className="onboarding-field">
                    <label htmlFor="auth-password" className="mb-2 block text-lg font-medium text-white">
                      Passwort
                    </label>
                    <div className="onboarding-password-field"><input
                      id="auth-password"
                      name="password"
                      type={passwordVisible ? "text" : "password"}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder={mode === "signup" ? familySetup ? "Mindestens 10 Zeichen" : "Mindestens 6 Zeichen" : "Dein Passwort"}
                      required
                      minLength={mode === "signup" ? familySetup ? 10 : 6 : undefined}
                      maxLength={128}
                      disabled={loading || resettingPassword}
                    />
                    <button type="button" className="onboarding-password-toggle" aria-label={passwordVisible ? "Passwort verbergen" : "Passwort anzeigen"}
                      aria-pressed={passwordVisible} onClick={() => setPasswordVisible(visible => !visible)}>
                      {passwordVisible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
                    </button></div>
                    {mode === "signup" && <p className="onboarding-field-hint">Mindestens {familySetup ? 10 : 6} Zeichen.</p>}
                    {mode === "signin" && <div className="onboarding-password-help"><button type="button" className="onboarding-link" disabled={authBusy}
                      onClick={() => { setPasswordResetOpen(true); setPassword(""); setErrorMsg(null); setErrorType(null); setResetSuccess(false); }}>Passwort vergessen?</button></div>}
                  </div>}

                  <AnimatePresence initial={false} mode="wait">
                    {resetSuccess ? (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <OnboardingFeedbackCard
                          tone="success"
                          icon={<Mail className="h-6 w-6" />}
                          title="E-Mail gesendet"
                        >
                          <p>
                            Wir haben einen Link zum Zurücksetzen deines Passworts an <strong>{email}</strong> geschickt.
                          </p>
                        </OnboardingFeedbackCard>
                      </motion.div>
                    ) : errorType === "general" ? (
                      <motion.div
                        key="error-general"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <OnboardingInlineFeedback>
                          {errorMsg}
                        </OnboardingInlineFeedback>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <div className="onboarding-auth-actions">
                    <ButtonPrimary disabled={resetSuccess && passwordResetOpen} type="submit" className="w-full" loading={loading || resettingPassword}>
                      {passwordResetOpen ? "Link anfordern" : mode === "signup" ? "Konto erstellen" : "Anmelden"}
                      <ArrowRight size={20} aria-hidden="true" />
                    </ButtonPrimary>
                  </div>

                </form>
              </div>
            </motion.div>
          )}

          {/* Schritt 4: E-Mail-Bestätigung */}
          {step === "email-confirm" && (
            <motion.div
              key="email-confirm"
              {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
            >
              <div className={panelClass}>
                <div className="text-center space-y-4 max-w-lg mx-auto">
                  <CardHeader
                    title="Bestätige deine E-Mail"
                    subtitle={`Gib den achtstelligen Code aus der E-Mail an ${email || "deine E-Mail-Adresse"} ein.`}
                    showLogo
                    spacing="compact"
                  />
                  {emailConfirmed && (
                    <div className="space-y-4">
                      <OnboardingInlineFeedback tone="success">
                        E-Mail erfolgreich bestätigt! Du wirst weitergeleitet...
                      </OnboardingInlineFeedback>
                      <ButtonPrimary
                        onClick={handleEmailConfirmation}
                        loading={loading}
                        className="w-full h-12 bg-green-600 hover:bg-green-500 text-white"
                      >
                        Weiter
                      </ButtonPrimary>
                    </div>
                  )}
                  {!emailConfirmed && (
                    <>
                      {loading && <Loader text={resendLoading ? "Code wird gesendet..." : "Session wird geprüft..."} />}
                      <div className="mt-3 space-y-5 text-left">
                        <form onSubmit={handleVerifyCode} className="onboarding-code-form space-y-3">
                          <div className="flex items-center">
                            <label htmlFor="email-confirmation-code" className="text-sm font-semibold text-white">
                              Mit Code bestätigen
                            </label>
                          </div>

                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <input
                              id="email-confirmation-code"
                              type="text"
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^0-9]/g, "");
                                setCode(raw.slice(0, 8));
                                setCodeError(null);
                                setCodeMessage(null);
                              }}
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              aria-invalid={Boolean(codeError)}
                              minLength={8}
                              pattern="[0-9]*"
                              maxLength={16}
                              className={`min-w-0 flex-1 rounded-2xl border ${codeError ? "border-rose-400/50 bg-rose-500/10 focus:ring-rose-500/25" : "border-white/15 bg-[#0F0F12] focus:border-cyan-300/40 focus:ring-cyan-300/20"} px-5 py-4 text-center text-xl font-semibold tracking-[0.34em] text-white placeholder:text-slate-700 transition-[background-color,border-color,box-shadow,color] duration-200 ease-out focus:outline-none focus:ring-2`}
                              placeholder="12345678"
                              value={code}
                              disabled={loading || resendLoading}
                              autoFocus
                            />
                            <ButtonPrimary
                              type="submit"
                              loading={loading}
                              className="h-14 w-full rounded-2xl px-6 sm:w-auto"
                              disabled={loading || resendLoading || code.length < 8}
                            >
                              Code prüfen
                            </ButtonPrimary>
                          </div>
                        </form>

                        <div className="space-y-2">
                          <ButtonSecondary
                            onClick={handleResendConfirmation}
                            disabled={resendCooldown > 0 || resendLoading || loading}
                            className="w-full border-white/[0.08] bg-white/[0.025] text-sm text-slate-400 hover:bg-white/[0.055] hover:text-slate-200"
                          >
                            {resendCooldown > 0 ? `Code erneut senden (${resendCooldown}s)` : "Code erneut senden"}
                          </ButtonSecondary>

                          {emailConfirmStatus && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                            >
                              <OnboardingInlineFeedback tone={emailConfirmStatusTone}>
                                {emailConfirmStatus}
                              </OnboardingInlineFeedback>
                            </motion.div>
                          )}
                        </div>

                        {codeError && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <OnboardingInlineFeedback>
                              {codeError}
                            </OnboardingInlineFeedback>
                          </motion.div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Schritt 5: Rollenwahl */}
          {step === "role" && (
            <motion.div
              key="role"
              {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
            >
              <div className={panelClass}>

                <CardHeader
                  title="Welche Rolle passt zu dir?"
                />

                <div className="onboarding-roles">
                  {[
                    {
                      value: "youth" as OnboardingRole,
                      title: "Jobs finden",
                      description: "Taschengeldjobs für 14- bis 20-Jährige",
                      icon: <BriefcaseBusiness size={22} aria-hidden="true" />,
                    },
                    {
                      value: "adult" as OnboardingRole,
                      title: "Privatperson / Elternteil",
                      description: "Aufträge vergeben oder Elternfreigabe erteilen · ab 18 Jahren",
                      icon: <HandHeart size={22} aria-hidden="true" />,
                    },
                    {
                      value: "company" as OnboardingRole,
                      title: "Organisation / Unternehmen",
                      description: "Ich vertrete ein Unternehmen",
                      icon: <Building2 size={22} aria-hidden="true" />,
                    },
                  ].map((role) => {
                    const active = profileData.role === role.value;
                    return (
                      <ChoiceTile
                        key={role.value}
                        onClick={() => {
                          setProfileData((prev) => ({ ...prev, role: role.value }));
                          setErrorMsg("");
                        }}
                        selected={active}
                      >
                        <div className="flex items-start gap-4">
                          <div className="onboarding-choice-icon">
                            {role.icon}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="onboarding-choice-title">
                              {role.title}
                            </div>
                            <div className="onboarding-choice-text">
                              {role.description}
                            </div>
                          </div>
                        </div>
                      </ChoiceTile>
                    );
                  })}
                </div>

                {/* Error Display */}
                {errorMsg && (
                  <OnboardingInlineFeedback className="mb-6">
                    {errorMsg}
                  </OnboardingInlineFeedback>
                )}

                {/* Continue Button */}
                <ButtonPrimary onClick={nextStep} disabled={!profileData.role} className="w-full">
                  Weiter
                </ButtonPrimary>
              </div>
            </motion.div>
          )}

          {/* Schritt 6: Profil-Daten */}
          {step === "profile" && (
            <motion.div
              key="profile"
              {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
            >
              <div className={panelClass}>

                <CardHeader
                  title="Dein Profil"
                  subtitle="Dein Name und dein Geburtsdatum."
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    nextStep();
                  }}
                  className="onboarding-details-form"
                >
                  <div className="onboarding-field">
                    <label htmlFor="profile-full-name">
                      Vollständiger Name
                    </label>
                    <input
                      type="text"
                      id="profile-full-name"
                      name="name"
                      autoComplete="name"
                      value={profileData.fullName}
                      onChange={(e) => {
                        setProfileData((prev) => ({ ...prev, fullName: e.target.value }));
                        setErrorMsg(null);
                      }}
                      placeholder="Vor- und Nachname"
                      required
                    />
                  </div>
                  <div>
                    <p className="onboarding-field-label">Geburtsdatum</p>
                    {providerUpgrade ? <input
                      aria-label="Geburtsdatum"
                      value={new Date(`${profileData.birthdate}T12:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      readOnly
                      aria-readonly="true"
                    /> : <CinematicDateInput
                      value={profileData.birthdate}
                      role={profileData.role}
                      onChange={(val) => {
                        setProfileData((prev) => ({ ...prev, birthdate: val }));
                        setErrorMsg(null);
                      }}
                      onErrorChange={(msg) => setErrorMsg(msg)}
                    />}
                    <p className="onboarding-field-hint">
                      {providerUpgrade ? "Aus deinem Elternkonto übernommen." : "Für die Prüfung der Altersvoraussetzungen."}
                    </p>
                  </div>
                  {errorMsg && <OnboardingInlineFeedback>{errorMsg}</OnboardingInlineFeedback>}
                  <div className="onboarding-details-actions">
                    <ButtonPrimary type="submit" className="w-full">
                      Weiter
                    </ButtonPrimary>
                  </div>
                </form>
              </div>
            </motion.div>
          )
          }

          {/* Schritt 7: Company-Kontakt */}
          {
            step === "contact" && (
              <motion.div
                key="contact"
                {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
              >
                <div className={panelClass}>

                  <CardHeader
                    title="Deine Organisation"
                    subtitle="Hinterlege die Kontaktdaten deines Unternehmens."
                  />
                  {isSaving ? (
                    <Loader text="Wird gespeichert..." />
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleCompanyContact();
                      }}
                      className="onboarding-details-form"
                    >
                      <div className="onboarding-field">
                        <label htmlFor="company-name">
                          Firmenname / Organisation
                        </label>
                        <input
                          id="company-name"
                          name="organization"
                          type="text"
                          autoComplete="organization"
                          value={profileData.companyName}
                          onChange={(e) =>
                            setProfileData((prev) => ({ ...prev, companyName: e.target.value }))
                          }
                          placeholder="Musterfirma GmbH"
                          required
                        />
                      </div>
                      <div className="onboarding-field">
                        <label htmlFor="company-email">
                          E-Mail-Adresse
                        </label>
                        <input
                          id="company-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="email"
                          value={profileData.companyEmail}
                          onChange={(e) =>
                            setProfileData((prev) => ({ ...prev, companyEmail: e.target.value }))
                          }
                          placeholder="kontakt@firma.de"
                          required
                        />
                      </div>
                      <div className="onboarding-field">
                        <label htmlFor="company-message">
                          Nachricht
                        </label>
                        <textarea
                          id="company-message"
                          name="message"
                          value={profileData.companyMessage}
                          onChange={(e) =>
                            setProfileData((prev) => ({ ...prev, companyMessage: e.target.value }))
                          }
                          rows={5}
                          placeholder="Erzähl uns kurz, was du suchst oder anbietest..."
                          required
                        />
                      </div>
                      {errorMsg && (
                        <OnboardingInlineFeedback
                          action={(
                            <button
                              type="button"
                              onClick={handleCompanyContact}
                              className="onboarding-inline-feedback-action"
                            >
                              Noch einmal versuchen
                            </button>
                          )}
                        >
                          {errorMsg}
                        </OnboardingInlineFeedback>
                      )}
                      <div className="onboarding-details-actions">
                        <ButtonPrimary type="submit" className="w-full" loading={isSaving}>
                          Angaben prüfen
                        </ButtonPrimary>
                      </div>
                    </form>
                  )}
                </div>
              </motion.div>
            )
          }

          {/* Schritt 8: Zusammenfassung */}
          {
            step === "summary" && (
              <motion.div
                key="summary"
                {...STEP_MOTION} initial={animateSteps ? STEP_MOTION.initial : false}
              >
                <div className={panelClass}>

                  <CardHeader
                    title="Deine Angaben"
                    subtitle="Prüfe kurz, ob alles stimmt."
                  />
                  {isSaving ? (
                    <Loader text="Wird gespeichert..." />
                  ) : (
                    <>
                      <dl className="onboarding-summary-list">
                        <div className="onboarding-summary-row">
                          <div>
                            <dt>Rolle</dt>
                            <dd>{profileData.role === "youth" ? "Jobs finden" : profileData.role === "adult" ? "Privatperson / Elternteil" : "Unternehmen / Organisation"}</dd>
                            {profileData.role === "youth" && <dd className="onboarding-summary-meta">14–20 Jahre</dd>}
                          </div>
                          {!providerUpgrade && <button type="button" className="onboarding-icon-button onboarding-summary-edit" onClick={() => editSummary("role")} aria-label="Rolle bearbeiten" title="Rolle bearbeiten"><Pencil aria-hidden="true" /></button>}
                        </div>
                        <div className="onboarding-summary-row">
                          <div>
                            <dt>Profil</dt>
                            <dd>{profileData.fullName}</dd>
                            <dd className="onboarding-summary-meta">{profileData.birthdate ? new Date(`${profileData.birthdate}T12:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "Geburtsdatum fehlt"}</dd>
                          </div>
                          <button type="button" className="onboarding-icon-button onboarding-summary-edit" onClick={() => editSummary("profile")} aria-label="Profil bearbeiten" title="Profil bearbeiten"><Pencil aria-hidden="true" /></button>
                        </div>
                        <div className="onboarding-summary-row">
                          <div><dt>Region</dt><dd>{profileData.region || "Bitte eine Region wählen"}</dd></div>
                          <button type="button" className="onboarding-icon-button onboarding-summary-edit" onClick={() => editSummary("location")} aria-label="Region bearbeiten" title="Region bearbeiten"><Pencil aria-hidden="true" /></button>
                        </div>
                        {profileData.role === "company" && <div className="onboarding-summary-row">
                          <div><dt>Organisation</dt><dd>{profileData.companyName}</dd><dd className="onboarding-summary-meta">{profileData.companyEmail}</dd>{profileData.companyMessage && <dd className="onboarding-summary-meta">{profileData.companyMessage}</dd>}</div>
                          <button type="button" className="onboarding-icon-button onboarding-summary-edit" onClick={() => editSummary("contact")} aria-label="Organisation bearbeiten" title="Organisation bearbeiten"><Pencil aria-hidden="true" /></button>
                        </div>}
                      </dl>
                      {profileData.role === "youth" && <div className="onboarding-summary-note"><ShieldCheck aria-hidden="true" /><p>Unter 18? Für deine erste Bewerbung brauchst du eine Elternfreigabe. Du kannst sie anschließend in deinem Konto anfordern.</p></div>}
                      {errorMsg && (
                        <OnboardingInlineFeedback
                          action={(
                            <button
                              type="button"
                              onClick={handleCompleteOnboarding}
                              className="onboarding-inline-feedback-action"
                            >
                              Noch einmal versuchen
                            </button>
                          )}
                        >
                          {errorMsg}
                        </OnboardingInlineFeedback>
                      )}
                      <div className="onboarding-summary-actions">
                        <ButtonPrimary onClick={handleCompleteOnboarding} className="w-full" loading={isSaving}>
                          Profil speichern und starten
                        </ButtonPrimary>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )
          }
        </div>

      </OnboardingFrame>
    </MotionConfig>
  );
}
