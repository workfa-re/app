"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleHelp, Headphones, Route, X } from "lucide-react";
import type { OnboardingStep } from "@/lib/onboardingFlow";
import { BRAND_SUPPORT_EMAIL } from "@/lib/constants";
import { OnboardingFilm } from "./OnboardingFilm";
import { OnboardingThemeToggle } from "./OnboardingThemeToggle";

type AuthMode = "signup" | "signin" | null;

export function OnboardingHeading({ title, subtitle }: {
  title: string;
  subtitle?: string;
  showLogo?: boolean;
  spacing?: "default" | "compact" | "tight";
}) {
  return <div className="onboarding-step-heading">
    <h1>{title}</h1>
    {subtitle && <p>{subtitle}</p>}
  </div>;
}

export function OnboardingChoice({ children, onClick, selected, className, disabled }: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled}
    aria-pressed={Boolean(selected)} className={`onboarding-choice ${className ?? ""}`}>
    <span className="onboarding-choice-body">{children}</span>
    <span className="onboarding-choice-check" aria-hidden="true">
      {selected && <Check size={14} />}
    </span>
  </button>;
}

export function OnboardingFrame({ step, mode, children, onBack }: {
  step: OnboardingStep;
  mode: AuthMode;
  children: ReactNode;
  onBack?: () => void;
}) {
  const helpRef = useRef<HTMLDivElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const helpId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const lastStepRef = useRef(step);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (lastStepRef.current !== step) {
      workspaceRef.current?.focus({ preventScroll: true });
      workspaceRef.current?.scrollIntoView({ block: "nearest" });
      lastStepRef.current = step;
    }
  }, [step]);

  const positionHelp = () => {
    const button = helpButtonRef.current;
    const panel = helpRef.current;
    if (!button || !panel) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    panel.style.setProperty("--help-left", `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`);
    panel.style.setProperty("--help-top", `${Math.max(16, rect.bottom + 12)}px`);
  };

  useEffect(() => {
    const panel = helpRef.current;
    if (!panel) return;
    const onToggle = (event: Event) => {
      const open = (event as ToggleEvent).newState === "open";
      setHelpOpen(open);
      if (open) panel.querySelector<HTMLElement>("[data-help-focus]")?.focus({ preventScroll: true });
      else if (panel.contains(document.activeElement) || document.activeElement === document.body) returnFocusRef.current?.focus({ preventScroll: true });
    };
    panel.addEventListener("toggle", onToggle);
    window.addEventListener("resize", positionHelp);
    window.addEventListener("scroll", positionHelp, true);
    return () => {
      panel.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", positionHelp);
      window.removeEventListener("scroll", positionHelp, true);
    };
  }, []);

  const highlightGlass = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const target = (event.target as Element).closest<HTMLElement>("button:not(:disabled), .onboarding-brand-symbol");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--glass-x", `${event.clientX - rect.left}px`);
    target.style.setProperty("--glass-y", `${event.clientY - rect.top}px`);
  };

  const entry = step === "welcome" || step === "mode";

  return <div className="onboarding-canvas"><div className="onboarding-experience" data-step={step} data-entry={entry} data-mode={mode ?? "welcome"} onPointerMove={highlightGlass}>
    <OnboardingFilm />
    <a className="onboarding-skip-link" href="#onboarding-content">Zum nächsten Schritt</a>
    <header className="onboarding-topbar">
      <a href="/" className="onboarding-brand" aria-label="Workfare Startseite">
        <span className="onboarding-brand-symbol"><Image className="onboarding-brand-mark" src="/brand/workfare-mark-compact.png" width={40} height={24} alt="" priority /></span>
        <span>Workfare</span>
      </a>
      <nav className="onboarding-top-actions" aria-label="Einstieg und Hilfe">
        {step !== "welcome" && step !== "mode" && onBack && <button className="onboarding-text-button onboarding-back-button" type="button" aria-label="Zurück" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /><span>Zurück</span></button>}
        <OnboardingThemeToggle />
        <button ref={helpButtonRef} className="onboarding-text-button onboarding-help-button" type="button" aria-label="Hilfe" aria-expanded={helpOpen} aria-controls={helpId} popoverTarget={helpId}
          onClick={() => { returnFocusRef.current = helpButtonRef.current; positionHelp(); }}><CircleHelp size={21} aria-hidden="true" /></button>
      </nav>
    </header>

    <main id="onboarding-content" className="onboarding-main">
      <section ref={workspaceRef} className="onboarding-workspace" tabIndex={-1} aria-label="Dein Einstieg bei Workfare">
        {children}
      </section>
    </main>

    <div className="onboarding-legal">
      <a className="onboarding-text-button" href="/legal">Rechtliches</a>
    </div>

    <div ref={helpRef} id={helpId} popover="auto" className="onboarding-help-popover" role="dialog" aria-modal="false" aria-labelledby={`${helpId}-title`}>
      <div className="onboarding-help-content">
        <header>
          <h2 id={`${helpId}-title`}>{step === "location" ? "Deine Stadt wählen" : "Hilfe & Support"}</h2>
          <button type="button" className="onboarding-icon-button" aria-label="Hilfe schließen" popoverTarget={helpId} popoverTargetAction="hide"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="onboarding-support-actions">
          {step === "location" && <p className="onboarding-context-help">Wähle deine Stadt aus den Suchvorschlägen. Bei Fragen hilft dir unser Support.</p>}
          <a className="onboarding-support-action" data-help-focus href={`mailto:${BRAND_SUPPORT_EMAIL}`}><Headphones size={20} aria-hidden="true" /><span>Support kontaktieren</span><ArrowRight size={17} aria-hidden="true" /></a>
          <button type="button" className="onboarding-support-action" disabled><BookOpen size={20} aria-hidden="true" /><span>FAQs lesen<small>Bald verfügbar</small></span></button>
          <button type="button" className="onboarding-support-action" disabled><Route size={20} aria-hidden="true" /><span>Begleitete Registrierung<small>Bald verfügbar</small></span></button>
        </div>
      </div>
    </div>

  </div></div>;
}
