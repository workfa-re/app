"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CardHeader } from "./ui/CardHeader";
import { ChoiceTile } from "./ui/ChoiceTile";
import { ButtonPrimary } from "./ui/ButtonPrimary";
import { ButtonSecondary } from "./ui/ButtonSecondary";
import { Loader } from "./ui/Loader";
import { signUpWithEmail, signInWithEmail } from "@/lib/authClient";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { useEmailResend } from "@/lib/hooks/useEmailResend";
import { type OnboardingRole, type Profile } from "@/lib/types";
import { safeInternalRedirectOr } from "@/lib/safe-redirect";
import { BRAND_SUPPORT_EMAIL } from "@/lib/constants";
import { currentContactEmail } from "@/lib/brand-compat";
import { readBrandStorage, writeBrandStorage, removeBrandStorage } from "@/lib/brand-storage";
import { Sparkles, HandHeart, Building2, Mail, UserX, KeyRound } from "lucide-react";
import { LocationStep } from "./onboarding/LocationStep";
import { CinematicDateInput } from "@/components/ui/CinematicDateInput";
import type { User } from "@supabase/supabase-js";
import {
  getInitialOnboardingRole,
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
};

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || "";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CONTACT_EMAIL = currentContactEmail(process.env.NEXT_PUBLIC_CONTACT_EMAIL);
const ONBOARDING_DRAFT_KEY = "workfare-onboarding-draft:v1";
const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

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
    <div className="onboarding-feedback-card" data-tone={tone}>
      <div className="onboarding-feedback-sheen" aria-hidden="true" />
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
    <div className={`onboarding-inline-feedback${className ? ` ${className}` : ""}`} data-tone={tone}>
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
  reserveFooterSpace = false,
}: OnboardingWizardProps) {
  const safeRedirectTo = safeInternalRedirectOr(redirectTo, "/app-home");
  const [step, setStep] = useState<Step>(forcedStep || "welcome");
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorType, setErrorType] = useState<"account_not_found" | "wrong_password" | "general" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(isJustVerified);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const {
    cooldown: resendCooldown,
    message: resendMessage,
    error: resendError,
    loading: resendLoading,
    resend: handleResendConfirmation,
    forceResend: forceResendConfirmation,
    markSent: markConfirmationEmailSent,
  } = useEmailResend(email);
  const mustChooseRole = mustChooseOnboardingRole(forcedStep, isJustVerified);

  // Seitenscrolling auf Mobile verhindern
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Initialwerte aus Session, Profil und lokalem Onboarding-Entwurf zusammenführen.
  const [profileData, setProfileData] = useState({
    role: getInitialOnboardingRole({ profile: initialProfile, forcedStep, isJustVerified }),
    fullName: initialProfile?.full_name || "",
    birthdate: initialProfile?.birthdate || "",
    region: initialProfile?.city || initialRegion || "",
    marketId: initialProfile?.market_id || null,
    companyName: "",
    companyEmail: "",
    companyMessage: "",
  });
  const [resumeChecked, setResumeChecked] = useState(Boolean(forcedStep || initialEmail || initialProfile));

  useEffect(() => {
    const draft = readOnboardingDraft();
    const normalizedInitialEmail = normalizeEmail(initialEmail);
    const normalizedDraftEmail = normalizeEmail(draft?.email);
    const draftMatchesSession = Boolean(draft && (!normalizedInitialEmail || normalizedDraftEmail === normalizedInitialEmail));

    if (draft && draftMatchesSession) {
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
        setStep(draft.step === "welcome" ? "mode" : draft.step);
      }
    }

    setResumeChecked(true);
  }, [forcedStep, initialEmail, initialProfile, isJustVerified, mustChooseRole]);

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

  useEffect(() => {
    if (initialMode && step === "welcome") {
      setStep("mode");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode]);
  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (code.length < 8) return;
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
      setLoading(false);
    }
  };

  const checkSessionAfterEmailConfirm = useCallback(async (verifiedUser?: User | null) => {
    const expectedEmail = normalizeEmail(email);
    let user = verifiedUser ?? null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (user?.email_confirmed_at) {
        break;
      }

      const { data } = await supabaseBrowser.auth.getUser();
      user = data.user ?? user;
      if (!user?.email_confirmed_at) {
        await wait(250);
      }
    }

    if (!user) return false;

    const confirmedEmail = normalizeEmail(user.email);
    if (expectedEmail && confirmedEmail && confirmedEmail !== expectedEmail) {
      return false;
    }

    const { data: profile } = await supabaseBrowser
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    const profileTyped = profile as Profile | null;
    const isComplete = isProfileComplete(profileTyped);
    const isConfirmed = !!user.email_confirmed_at;

    if (isConfirmed && isComplete) {
      setEmailConfirmed(true);
      clearOnboardingDraft();
      setCodeMessage("Code bestätigt. Du wirst weitergeleitet...");
      setTimeout(() => {
        window.location.href = safeRedirectTo;
      }, 1000); // Give user a moment to see success
      return true;
    }

    if (isConfirmed) {
      setEmailConfirmed(true);
      setCodeMessage("Code bestätigt. Bitte wähle jetzt deine Rolle.");
      setTimeout(() => {
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
  }, [email, mustChooseRole, safeRedirectTo]);

  useEffect(() => {
    if (step !== "email-confirm") return;

    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (session?.user.email_confirmed_at) {
          await checkSessionAfterEmailConfirm(session.user);
        }
      }
    });

    const interval = setInterval(async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (session?.user.email_confirmed_at) {
        await checkSessionAfterEmailConfirm(session.user);
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [step, checkSessionAfterEmailConfirm]);

  useEffect(() => {
    if (isJustVerified && step === "email-confirm") {
      const timer = setTimeout(() => {
        checkSessionAfterEmailConfirm();
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
  }, [email, forceResendConfirmation, mode, profileData]);

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
      const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/update-password`,
      });
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
      const { error: signOutError } = await supabaseBrowser.auth.signOut();
      if (signOutError) throw signOutError;

      const signUpData = {
        city: profileData.region,
        full_name: "",
        market_id: profileData.marketId
      };
      const { error } = await signUpWithEmail(email, password, signUpData);

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
    setLoading(true);
    await checkSessionAfterEmailConfirm();
    setLoading(false);
  };

  const handleCompanyContact = async () => {
    setStep("summary");
  };

  const handleCompleteOnboarding = async () => {
    setIsSaving(true);
    setErrorType(null);
    setErrorMsg(null);

    try {
      if (!profileData.role) throw new Error("Keine Rolle ausgewählt.");

      const { completeOnboarding } = await import("@/app/onboarding/actions");

      const result = await completeOnboarding({
        full_name: profileData.fullName.trim(),
        birthdate: profileData.birthdate,
        city: profileData.region.trim(),
        market_id: profileData.marketId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      setStep("auth");
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
      if (!profileData.fullName || !profileData.birthdate) {
        setErrorType("general");
        setErrorMsg("Bitte fülle alle Felder aus.");
        return;
      }

      const d = new Date(profileData.birthdate);
      if (Number.isNaN(d.getTime())) {
        setErrorType("general");
        setErrorMsg("Bitte gib ein vollständiges Datum ein.");
        return;
      }

      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;

      setErrorMsg(null);
      setErrorType(null);

      if (profileData.role === "youth" && age >= 21) {
        setErrorType("general");
        setErrorMsg("Als Jugendliche/r oder junge/r Erwachsene/r musst du unter 21 Jahre alt sein.");
        return;
      } else if (profileData.role === "youth" && age < 14) {
        setErrorType("general");
        setErrorMsg("Du musst für Workfare mindestens 14 Jahre alt sein.");
        return;
      } else if (profileData.role !== "youth" && age < 18) {
        setErrorType("general");
        setErrorMsg("Für diese Rolle musst du mindestens 18 Jahre alt sein.");
        return;
      }

      if (profileData.role === "company") {
        setStep("contact");
      } else {
        setStep("summary");
      }
    } else if (step === "contact") {
      handleCompanyContact();
    } else if (step === "summary") {
      handleCompleteOnboarding();
    }
  };

  const prevStep = () => {
    if (step === "mode") {
      setStep("welcome");
    } else if (step === "location") {
      setStep("mode");
    } else if (step === "auth") {
      if (mode === "signup") {
        setStep("location");
      } else {
        setStep("mode");
      }
    } else if (step === "email-confirm") {
      if (!emailConfirmed && !loading) {
        setCode("");
        setCodeError(null);
        setCodeMessage(null);
        setStep("auth");
      }
    } else if (step === "profile") {
      setStep("role");
    } else if (step === "contact") {
      setStep("profile");
    } else if (step === "summary") {
      setStep("profile");
    }
    setErrorType(null);
    setErrorMsg(null);
  };

  const panelClass = "onboarding-panel relative rounded-3xl p-8 md:p-12 overflow-hidden";
  const panelGlowClass = "onboarding-panel-glow pointer-events-none absolute -top-16 -left-16 w-56 h-56";
  const panelTextureClass = "onboarding-panel-texture pointer-events-none absolute inset-0";
  const emailConfirmStatus = codeMessage || resendError || resendMessage;
  const emailConfirmStatusTone: FeedbackTone = resendError ? "danger" : "success";

  if (!resumeChecked) {
    return (
      <div className="onboarding-shell flex items-center justify-center overflow-hidden px-4 py-4 no-scrollbar md:py-8">
        <div className={`${panelClass} w-full max-w-md`}>
          <div className={panelGlowClass} />
          <div className={panelTextureClass} />
          <Loader text="Onboarding wird geladen..." />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "onboarding-shell flex justify-center overflow-y-auto overflow-x-hidden px-4 no-scrollbar",
        reserveFooterSpace
          ? "py-4 pb-28 md:py-8 md:pb-24"
          : "py-4 md:py-8",
      ].join(" ")}
    >
      <div
        className={[
          "relative z-10 my-auto w-full max-w-2xl",
        ].join(" ")}
      >
        <AnimatePresence initial={false} mode="wait">
          {/* Schritt 1: Willkommen */}
          {step === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={panelClass}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />

                <div className="flex flex-col items-start gap-4 text-left">
                  <CardHeader
                    title="Workfare"
                    subtitle="Sichere Taschengeldjobs zwischen Jugendlichen und Auftraggebern."
                    spacing="tight"
                  />
                  <p className="text-base text-slate-200/80 max-w-md">
                    Plattform mit verifizierten Aufgaben, klaren Schritten und seniorenfreundlicher Bedienung.
                  </p>
                  <div className="pt-2 w-full">
                    <ButtonPrimary onClick={nextStep} className="w-full">Jetzt starten</ButtonPrimary>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Schritt 2: Neu oder wiederkehrend */}
          {step === "mode" && (
            <motion.div
              key="mode"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={panelClass}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />

                <CardHeader
                  title="Warst du schon bei Workfare?"
                  subtitle="Damit wir dich richtig weiterleiten können."
                />

                <div className="grid gap-4 mb-8">
                  <ChoiceTile
                    onClick={() => {
                      setMode("signup");
                      setErrorType(null);
                      setErrorMsg(null);
                    }}
                    selected={mode === "signup"}
                    className="onboarding-choice"
                  >
                    <div className="space-y-1">
                      <div className="onboarding-choice-title text-lg font-semibold">Ich bin neu hier</div>
                      <div className="onboarding-choice-text text-sm">Ich möchte ein neues Konto erstellen.</div>
                    </div>
                  </ChoiceTile>
                  <ChoiceTile
                    onClick={() => {
                      setMode("signin");
                      setErrorType(null);
                      setErrorMsg(null);
                    }}
                    selected={mode === "signin"}
                    className="onboarding-choice"
                  >
                    <div className="space-y-1">
                      <div className="onboarding-choice-title text-lg font-semibold">Ich war schon hier</div>
                      <div className="onboarding-choice-text text-sm">Ich habe bereits ein Konto.</div>
                    </div>
                  </ChoiceTile>
                </div>

                <div className="flex gap-4">
                  <ButtonSecondary onClick={prevStep} className="flex-1">
                    Zurück
                  </ButtonSecondary>
                  <ButtonPrimary onClick={nextStep} disabled={!mode} className="flex-1" loading={loading}>
                    Weiter
                  </ButtonPrimary>
                </div>
              </div>
            </motion.div>
          )}

          {/* Schritt 3 (optional): Location NUR wenn mode="signup" */}
          {step === "location" && (
            <motion.div
              key="location"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={`${panelClass} onboarding-location-panel mx-auto w-full max-w-2xl`}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />
                <LocationStep
                  onBack={prevStep}
                  onComplete={(regionData) => {
                    setProfileData((prev) => ({
                      ...prev,
                      region: regionData.city,
                      marketId: regionData.region_live_id ?? null,
                    }));
                    setStep("auth");
                  }}
                />
              </div>
            </motion.div>
          )}

          {/* Schritt 3: E-Mail & Passwort */}
          {step === "auth" && (
            <motion.div
              key="auth"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={panelClass}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />

                <CardHeader
                  title="Dein Konto"
                  subtitle="Für Sicherheit und Identifikation erforderlich."
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    nextStep();
                  }}
                  className="space-y-6"
                >
                  <div>
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
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder="deine@email.de"
                      required
                    />
                    <p className="mt-2 text-sm text-slate-400">
                      Für Sicherheit und Identifikation erforderlich.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="auth-password" className="mb-2 block text-lg font-medium text-white">
                      Passwort
                    </label>
                    <input
                      id="auth-password"
                      name="password"
                      type="password"
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder={mode === "signup" ? "Mindestens 6 Zeichen" : "Dein Passwort"}
                      required
                      minLength={mode === "signup" ? 6 : undefined}
                    />
                    <p className="mt-2 text-sm text-slate-400">
                      Schützt deinen Zugang.
                    </p>
                  </div>

                  <AnimatePresence initial={false} mode="wait">
                    {resetSuccess ? (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, height: 0, scale: 0.95 }}
                        animate={{ opacity: 1, height: "auto", scale: 1 }}
                        exit={{ opacity: 0, height: 0, scale: 0.95 }}
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
                    ) : errorType === "wrong_password" && mode === "signin" ? (
                      <motion.div
                        key="error-wrong-password"
                        initial={{ opacity: 0, height: 0, scale: 0.95 }}
                        animate={{ opacity: 1, height: "auto", scale: 1 }}
                        exit={{ opacity: 0, height: 0, scale: 0.95 }}
                      >
                        <OnboardingFeedbackCard
                          tone="danger"
                          icon={<KeyRound className="h-6 w-6" />}
                          title="Passwort falsch"
                          actions={
                            <>
                            <ButtonPrimary
                              type="button"
                              onClick={handleResetPassword}
                              loading={resettingPassword}
                              className="onboarding-feedback-action onboarding-feedback-action-primary h-12 w-full"
                            >
                              Passwort-Link anfordern
                            </ButtonPrimary>
                            <a
                              href={`mailto:${BRAND_SUPPORT_EMAIL}?subject=Hilfe bei Passwort (Workfare)&body=Hallo Support-Team,%0D%0A%0D%0Amein Passwort für ${email} wird nicht akzeptiert.%0D%0A%0D%0ABitte helft mir weiter.`}
                              className="onboarding-feedback-action onboarding-feedback-action-secondary flex h-12 w-full items-center justify-center text-sm font-semibold transition-[background-color,color,scale,border-color,box-shadow] duration-200 ease-out active:scale-[0.98]"
                            >
                              Support kontaktieren
                            </a>
                            </>
                          }
                        >
                          <p>{errorMsg}</p>
                        </OnboardingFeedbackCard>
                      </motion.div>
                    ) : errorType === "account_not_found" && mode === "signin" ? (
                      <motion.div
                        key="error-not-found"
                        initial={{ opacity: 0, height: 0, scale: 0.95 }}
                        animate={{ opacity: 1, height: "auto", scale: 1 }}
                        exit={{ opacity: 0, height: 0, scale: 0.95 }}
                      >
                        <OnboardingFeedbackCard
                          tone="warning"
                          icon={<UserX className="h-6 w-6" />}
                          title="Account nicht gefunden"
                          actions={
                            <>
                            <ButtonPrimary
                              type="button"
                              onClick={() => {
                                setMode("signup");
                                setStep("location");
                                setErrorType(null);
                                setErrorMsg(null);
                              }}
                              className="onboarding-feedback-action onboarding-feedback-action-primary h-12 w-full"
                            >
                              Jetzt registrieren
                            </ButtonPrimary>
                            <a
                              href={`mailto:${BRAND_SUPPORT_EMAIL}?subject=Account nicht gefunden (Workfare)&body=Hallo Support-Team,%0D%0A%0D%0Aich versuche mich mit ${email} anzumelden, aber der Account existiert angeblich nicht.%0D%0A%0D%0ABitte helft mir weiter.`}
                              className="onboarding-feedback-action onboarding-feedback-action-secondary flex h-12 w-full items-center justify-center text-sm font-semibold transition-[background-color,color,scale,border-color,box-shadow] duration-200 ease-out active:scale-[0.98]"
                            >
                              Support kontaktieren
                            </a>
                            </>
                          }
                        >
                          <p>{errorMsg}</p>
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

                  <div className="flex gap-4">
                    <ButtonSecondary disabled={resettingPassword} onClick={prevStep} className="flex-1">
                      Zurück
                    </ButtonSecondary>
                    <ButtonPrimary disabled={resettingPassword} type="submit" className="flex-1" loading={loading}>
                      {mode === "signup" ? "Registrieren" : "Anmelden"}
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={panelClass}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />
                <div className="text-center space-y-4 max-w-lg mx-auto">
                  <CardHeader
                    title="Bestätige deine E-Mail"
                    subtitle="Wir haben dir eine Bestätigungs-E-Mail geschickt. Bitte bestätige dich jetzt mit dem Code."
                    showLogo
                    spacing="compact"
                  />
                  {emailConfirmed && (
                    <div className="space-y-4">
                      <OnboardingInlineFeedback tone="success">
                        E-Mail erfolgreich bestätigt! Du wirst weitergeleitet...
                      </OnboardingInlineFeedback>
                      <ButtonPrimary
                        onClick={() => checkSessionAfterEmailConfirm()}
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
                        <div className="space-y-2">
                          <ButtonSecondary
                            disabled
                            className="w-full h-12 border-white/10 text-white/35 line-through decoration-2 decoration-white/35"
                          >
                            Per Link bestätigen
                          </ButtonSecondary>
                          <p className="px-1 text-center text-[11px] leading-5 text-slate-500">
                            Link-Bestätigung ist vorübergehend nicht verfügbar. Bitte nutze den Code aus deiner E-Mail.
                          </p>
                        </div>

                        <form onSubmit={handleVerifyCode} className="space-y-3 rounded-[1.75rem] border border-white/12 bg-black/15 p-4">
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
                              pattern="[0-9]*"
                              maxLength={8}
                              className={`min-w-0 flex-1 rounded-2xl border ${codeError ? "border-rose-400/50 bg-rose-500/10 focus:ring-rose-500/25" : "border-white/15 bg-[#0F0F12] focus:border-cyan-300/40 focus:ring-cyan-300/20"} px-5 py-4 text-center text-xl font-semibold tracking-[0.34em] text-white placeholder:text-slate-700 transition-[background-color,border-color,box-shadow,color] duration-200 ease-out focus:outline-none focus:ring-2`}
                              placeholder="12345678"
                              value={code}
                              autoFocus
                            />
                            <ButtonPrimary
                              type="submit"
                              loading={loading}
                              className="h-14 w-full rounded-2xl px-6 sm:w-auto"
                              disabled={loading || code.length < 8}
                            >
                              Code prüfen
                            </ButtonPrimary>
                          </div>
                        </form>

                        <div className="space-y-2">
                          <ButtonSecondary
                            onClick={handleResendConfirmation}
                            disabled={resendCooldown > 0 || resendLoading}
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

                        <ButtonSecondary
                          onClick={prevStep}
                          disabled={loading}
                          className="w-full border-white/[0.07] bg-transparent text-slate-500 hover:bg-white/[0.03] hover:text-slate-300"
                        >
                          Zurück
                        </ButtonSecondary>
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={panelClass}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />

                <CardHeader
                  title="Welche Rolle passt zu dir?"
                />

                <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-2">
                  {[
                    {
                      value: "youth" as OnboardingRole,
                      title: "Jugendliche/r",
                      description: "Ich suche Taschengeldjobs",
                      icon: <Sparkles className="h-6 w-6 text-amber-300" />,
                    },
                    {
                      value: "adult" as OnboardingRole,
                      title: "Privatperson / Elternteil",
                      description: "Ich möchte Aufträge vergeben",
                      icon: <HandHeart className="h-6 w-6 text-cyan-300" />,
                    },
                    {
                      value: "company" as OnboardingRole,
                      title: "Organisation / Unternehmen",
                      description: "Ich vertrete ein Unternehmen",
                      icon: <Building2 className="h-6 w-6 text-indigo-300" />,
                    },
                  ].map((role, idx) => {
                    const active = profileData.role === role.value;
                    return (
                      <ChoiceTile
                        key={role.value}
                        onClick={() => {
                          setProfileData((prev) => ({ ...prev, role: role.value }));
                          setErrorMsg("");
                        }}
                        selected={active}
                        className={[
                          "onboarding-choice h-full !rounded-[1.65rem]",
                          active
                            ? "!border-cyan-300/50 !bg-[#151923] !shadow-[0_16px_48px_rgba(0,0,0,0.42)] !ring-0"
                            : "!border-white/[0.09] !bg-white/[0.045] hover:!border-white/[0.16] hover:!bg-white/[0.06]",
                          idx === 2 ? "sm:col-span-2" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#111318]">
                            {role.icon}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-base font-semibold text-white leading-tight break-words sm:text-lg">
                              {role.title}
                            </div>
                            <div className="text-sm text-slate-400 leading-snug">
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className={panelClass}>
                <div className={panelGlowClass} />
                <div className={panelTextureClass} />

                <CardHeader
                  title="Erzähl uns etwas über dich"
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    nextStep();
                  }}
                  className="space-y-6"
                >
                  <div>
                    <label className="mb-2 block text-lg font-medium text-white">
                      Name
                    </label>
                    <input
                      type="text"
                      value={profileData.fullName}
                      onChange={(e) => {
                        setProfileData((prev) => ({ ...prev, fullName: e.target.value }));
                        setErrorMsg(null);
                      }}
                      className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      placeholder="Max Mustermann"
                      required
                    />
                    <p className="mt-2 text-sm text-slate-400">
                      Damit wir dich korrekt ansprechen können.
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 block text-lg font-medium text-white">
                      Geburtsdatum
                    </label>
                    <CinematicDateInput
                      value={profileData.birthdate}
                      role={profileData.role}
                      onChange={(val) => {
                        setProfileData((prev) => ({ ...prev, birthdate: val }));
                        setErrorMsg(null);
                      }}
                      onErrorChange={(msg) => setErrorMsg(msg)}
                    />
                    <p className="mt-2 text-sm text-slate-400">
                      Erforderlich für Jugendschutz.
                    </p>
                  </div>
                  <div className="flex gap-4 pt-2">
                    <ButtonSecondary onClick={prevStep} className="flex-1">
                      Zurück
                    </ButtonSecondary>
                    <ButtonPrimary type="submit" className="flex-1">
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
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <div className={panelClass}>
                  <div className={panelGlowClass} />
                  <div className={panelTextureClass} />

                  <CardHeader
                    title="Kontaktiere uns"
                    subtitle="Für Unternehmen schalten wir Zugänge manuell frei."
                  />
                  {isSaving ? (
                    <Loader text="Wird gespeichert..." />
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleCompanyContact();
                      }}
                      className="space-y-6"
                    >
                      <div>
                        <label htmlFor="company-name" className="mb-2 block text-lg font-medium text-white">
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
                          className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          placeholder="Musterfirma GmbH"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="company-email" className="mb-2 block text-lg font-medium text-white">
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
                          className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          placeholder="kontakt@firma.de"
                          required
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-lg font-medium text-white">
                          Nachricht
                        </label>
                        <textarea
                          value={profileData.companyMessage}
                          onChange={(e) =>
                            setProfileData((prev) => ({ ...prev, companyMessage: e.target.value }))
                          }
                          rows={5}
                          className="w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-lg text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                      <div className="flex gap-4">
                        <ButtonSecondary onClick={prevStep} className="flex-1">
                          Zurück
                        </ButtonSecondary>
                        <ButtonPrimary type="submit" className="flex-1" loading={isSaving}>
                          Absenden
                        </ButtonPrimary>
                      </div>
                      <div className="text-center text-sm text-slate-400">
                        Oder schreibe uns direkt an:{" "}
                        <a
                          href={`mailto:${CONTACT_EMAIL}`}
                          className="text-blue-400 hover:text-blue-300 underline"
                        >
                          {CONTACT_EMAIL}
                        </a>
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
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <div className={panelClass}>
                  <div className={panelGlowClass} />
                  <div className={panelTextureClass} />

                  <CardHeader
                    title="Überblick vor dem Start"
                    subtitle="So sehen Auftraggeber dein Profil auf den ersten Blick."
                  />
                  {isSaving ? (
                    <Loader text="Wird gespeichert..." />
                  ) : (
                    <>
                      <div className="space-y-3 text-left">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Übersicht</p>
                        <div className="glass-card rounded-2xl border border-white/20 bg-white/5 p-7 space-y-5">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm text-slate-400">Rolle</div>
                              <div className="text-xl font-semibold text-white">
                                {profileData.role === "youth" && "Jobsuchende/r (unter 18)"}
                                {profileData.role === "adult" && "Jobanbieter (ab 18)"}
                                {profileData.role === "company" && "Unternehmen / Organisation"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setStep("profile")}
                              className="text-sm text-cyan-200 underline-offset-4 hover:underline"
                            >
                              Bearbeiten
                            </button>
                          </div>
                          <div>
                            <div className="text-sm text-slate-400">Name</div>
                            <div className="text-xl font-semibold text-white">{profileData.fullName}</div>
                          </div>
                          <div>
                            <div className="text-sm text-slate-400">Geburtsdatum</div>
                            <div className="text-xl font-semibold text-white">
                              {profileData.birthdate ? new Date(profileData.birthdate).toLocaleDateString("de-DE", { day: '2-digit', month: '2-digit', year: 'numeric' }) : "—"}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-slate-400">Region</div>
                            <div className="text-xl font-semibold text-white">{profileData.region}</div>
                          </div>
                        </div>
                      </div>
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
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-8">
                        <ButtonSecondary onClick={() => setStep("profile")}>Daten bearbeiten</ButtonSecondary>
                        <ButtonPrimary onClick={handleCompleteOnboarding} className="sm:w-40" loading={isSaving}>
                          Start
                        </ButtonPrimary>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )
          }
        </AnimatePresence >

      </div >
    </div >
  );
}
