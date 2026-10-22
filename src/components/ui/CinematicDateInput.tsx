"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { OnboardingRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { validateOnboardingBirthdate } from "@/lib/onboarding-validation";

interface CinematicDateInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  role?: OnboardingRole | null;
  onErrorChange?: (message: string | null) => void;
}

type DateParts = { day: string; month: string; year: string };

function splitDateValue(value: string): DateParts {
  const [year = "", month = "", day = ""] = value.split("-");
  return { day, month, year };
}

function validateDateParts(parts: DateParts, role?: OnboardingRole | null) {
  if (parts.day.length !== 2 || parts.month.length !== 2 || parts.year.length !== 4) {
    return { value: "", error: null };
  }

  return validateOnboardingBirthdate(`${parts.year}-${parts.month}-${parts.day}`, role);
}

export function CinematicDateInput({ value, onChange, error, role, onErrorChange }: CinematicDateInputProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [parts, setParts] = useState(() => splitDateValue(value));
  const [hasBlurred, setHasBlurred] = useState(false);
  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const lastAppliedValue = useRef(value);
  const errorCallback = useRef(onErrorChange);
  const validation = validateDateParts(parts, role);
  const hasPartialValue = Boolean(parts.day || parts.month || parts.year) && !validation.value && !validation.error;
  const localError = validation.error || (hasBlurred && hasPartialValue ? "Bitte gib dein Geburtsdatum vollständig ein." : null);
  const activeError = localError || error;

  useEffect(() => {
    errorCallback.current = onErrorChange;
  }, [onErrorChange]);

  useEffect(() => {
    errorCallback.current?.(localError);
  }, [localError]);

  useEffect(() => {
    // A locally emitted empty value must preserve the remaining typed segments.
    // Only a genuinely external value (for example, a restored draft) replaces them.
    if (value === lastAppliedValue.current) return;
    lastAppliedValue.current = value;
    setParts(splitDateValue(value));
  }, [value]);

  const updateParts = (nextParts: DateParts) => {
    setParts(nextParts);
    const nextValue = validateDateParts(nextParts, role).value;
    lastAppliedValue.current = nextValue;
    // Incomplete or impossible dates clear a previously valid parent value immediately.
    if (nextValue !== value) onChange(nextValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, field: keyof DateParts) => {
    if (event.key !== "Backspace" || parts[field]) return;
    if (field === "year") {
      monthRef.current?.focus();
      updateParts({ ...parts, month: parts.month.slice(0, -1) });
    } else if (field === "month") {
      dayRef.current?.focus();
      updateParts({ ...parts, day: parts.day.slice(0, -1) });
    }
  };

  return (
    <div
      className="onboarding-date-input w-full space-y-2"
      role="group"
      aria-label="Geburtsdatum"
      aria-describedby={activeError ? errorId : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHasBlurred(true);
      }}
    >
      <div className={cn("onboarding-date-control flex min-h-14 overflow-hidden rounded-[10px] border bg-white/[0.03]", activeError ? "border-rose-400/50" : "border-white/15")}>
        {([
          { key: "day", label: "Tag", placeholder: "TT", length: 2, autoComplete: "bday-day", ref: dayRef },
          { key: "month", label: "Monat", placeholder: "MM", length: 2, autoComplete: "bday-month", ref: monthRef },
          { key: "year", label: "Jahr", placeholder: "JJJJ", length: 4, autoComplete: "bday-year", ref: yearRef },
        ] as const).map((field) => (
          <div className="onboarding-date-segment min-w-0 flex-1" key={field.key}>
            <label htmlFor={`${inputId}-${field.key}`} className="onboarding-date-label block px-3 pt-2 text-xs text-slate-400">
              {field.label}
            </label>
            <input
              id={`${inputId}-${field.key}`}
              ref={field.ref}
              type="text"
              inputMode="numeric"
              autoComplete={field.autoComplete}
              maxLength={field.length}
              value={parts[field.key]}
              placeholder={field.placeholder}
              aria-invalid={Boolean(activeError)}
              aria-describedby={activeError ? errorId : undefined}
              onFocus={() => setHasBlurred(false)}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, field.length);
                updateParts({ ...parts, [field.key]: digits });
                const number = Number(digits);
                if (field.key === "day" && digits.length === 2 && number >= 1 && number <= 31) monthRef.current?.focus();
                if (field.key === "month" && digits.length === 2 && number >= 1 && number <= 12) yearRef.current?.focus();
              }}
              onKeyDown={(event) => handleKeyDown(event, field.key)}
              className="onboarding-date-field w-full bg-transparent px-3 pb-2 pt-1 text-base text-white placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/60"
            />
          </div>
        ))}
      </div>
      {activeError && <p id={errorId} className="onboarding-date-error text-sm text-rose-300" role="alert">{activeError}</p>}
    </div>
  );
}
