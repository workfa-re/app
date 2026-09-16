"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { OnboardingRole } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CinematicDateInputProps {
  value: string; // ISO format YYYY-MM-DD
  onChange: (value: string) => void;
  error?: string; // Error passed from parent explicitly
  role?: OnboardingRole | null;
  onErrorChange?: (msg: string | null) => void;
}

export function CinematicDateInput({ value, onChange, error, role, onErrorChange }: CinematicDateInputProps) {
  // Parse initial value
  const initialDate = value ? new Date(value) : null;
  const initialDay = initialDate ? initialDate.getDate().toString().padStart(2, '0') : "";
  const initialMonth = initialDate ? (initialDate.getMonth() + 1).toString().padStart(2, '0') : "";
  const initialYear = initialDate ? initialDate.getFullYear().toString() : "";

  const [day, setDay] = useState(initialDay);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [focused, setFocused] = useState<"day" | "month" | "year" | null>(null);

  // Local validation state specifically for live feedback
  const [localError, setLocalError] = useState<string | null>(null);

  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Validate the date strictly locally whenever digits complete
  useEffect(() => {
    let newIso = "";
    let validationError: string | null = null;

    if (day.length === 2 && month.length === 2 && year.length === 4) {
      const d = parseInt(day, 10);
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);

      if (!isNaN(d) && !isNaN(m) && !isNaN(y) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        // Basic valid date construction
        const newDate = new Date(y, m - 1, d);
        if (newDate.getDate() === d) {
          // Date is valid calendar-wise.
          newIso = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

          // Now validate age
          if (role) {
            const now = new Date();
            let age = now.getFullYear() - newDate.getFullYear();
            const monthDiff = now.getMonth() - newDate.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < newDate.getDate())) {
              age--;
            }

            if (role === "youth") {
              if (age < 14) validationError = "Du musst für Workfare mindestens 14 Jahre alt sein.";
              else if (age >= 21) validationError = "Als Jugendliche/r oder junge/r Erwachsene/r musst du unter 21 Jahre alt sein.";
            } else {
              if (age < 18) validationError = "Für diese Rolle musst du mindestens 18 Jahre alt sein.";
            }
          }
        } else {
          validationError = "Bitte gib ein gültiges Datum ein.";
        }
      } else {
        validationError = "Bitte überprüfe Tag, Monat oder Jahr.";
      }
    } else {
      // Not fully typed yet, we only show error if they leave it incomplete
      // or if there was a previous value and they wiped part of it.
      // Usually we wait until they finish typing before showing local errors.
      validationError = null;
    }

    setLocalError(validationError);
    if (validationError && onErrorChange) {
      onErrorChange(validationError);
    } else if (!validationError && onErrorChange && day.length === 2 && month.length === 2 && year.length === 4) {
      onErrorChange(null);
    }

    if (newIso !== value && newIso !== "") {
      onChange(newIso);
    } else if (day === "" && month === "" && year === "" && value !== "") {
      onChange("");
    }
  }, [day, month, year, onChange, value, role, onErrorChange]);

  // Sync state if value changes externally (e.g. initial load)
  useEffect(() => {
    if (!value) {
      if (day !== "") setDay("");
      if (month !== "") setMonth("");
      if (year !== "") setYear("");
    } else {
      const [y, m, d] = value.split("-");
      if (y && y !== year) setYear(y);
      if (m && m !== month) setMonth(m);
      if (d && d !== day) setDay(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 2) val = val.slice(0, 2);
    setDay(val);

    if (val.length === 2 && parseInt(val, 10) >= 1 && parseInt(val, 10) <= 31) {
      monthRef.current?.focus();
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 2) val = val.slice(0, 2);
    setMonth(val);

    if (val.length === 2 && parseInt(val, 10) >= 1 && parseInt(val, 10) <= 12) {
      yearRef.current?.focus();
    }
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 4) val = val.slice(0, 4);
    setYear(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, type: "day" | "month" | "year") => {
    if (e.key === "Backspace") {
      if (type === "year" && year === "") {
        monthRef.current?.focus();
        setMonth(prev => prev.slice(0, -1));
      } else if (type === "month" && month === "") {
        dayRef.current?.focus();
        setDay(prev => prev.slice(0, -1));
      }
    }
  };

  const activeError = localError || error;
  const hasError = !!activeError;

  return (
    <div className="space-y-3 w-full">
      <div
        ref={containerRef}
        className={cn(
          "relative flex items-stretch h-[72px] rounded-2xl overflow-hidden transition-all duration-300",
          "bg-white/5 cursor-text",
          !hasError && !focused ? "border border-white/10 hover:border-white/20 hover:bg-white/10" : "",
          !hasError && focused ? "border border-transparent bg-white/10" : "",
          hasError ? "border border-transparent bg-rose-500/5" : ""
        )}
        onClick={() => {
          if (!focused) {
            if (!day || day.length < 2) dayRef.current?.focus();
            else if (!month || month.length < 2) monthRef.current?.focus();
            else yearRef.current?.focus();
          }
        }}
      >
        {/* Glow focus backplate */}
        <AnimatePresence>
          {!hasError && focused && (
            <motion.div
              className="absolute inset-0 rounded-2xl border-2 border-cyan-400/40 pointer-events-none"
              layoutId="focus-ring"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>

        {/* Cinematic Error Animation tracing the border */}
        <AnimatePresence>
          {hasError && (
            <motion.svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.rect
                x="1"
                y="1"
                width="calc(100% - 2px)"
                height="calc(100% - 2px)"
                rx="15"
                ry="15"
                fill="none"
                stroke="#f43f5e"
                strokeWidth="2"
                initial={{ pathLength: 0, strokeOpacity: 0 }}
                animate={{ pathLength: 1, strokeOpacity: 1 }}
                transition={{ duration: 0.8, ease: "easeInOut" }}
                strokeLinecap="round"
              />
            </motion.svg>
          )}
        </AnimatePresence>

        {/* DAY Input */}
        <div className="flex-1 relative flex flex-col justify-center items-center group">
          <motion.div
            className="absolute top-1 text-[9px] sm:text-[10px] uppercase font-bold tracking-[0.15em] transition-colors"
            animate={{
              color: hasError ? "#fda4af" : focused === 'day' ? "#22d3ee" : "#94a3b8",
              y: day || focused === 'day' ? 0 : 8,
              opacity: day || focused === 'day' ? 1 : 0
            }}
            transition={{ duration: 0.2 }}
          >
            Tag
          </motion.div>
          <input
            ref={dayRef}
            type="text"
            inputMode="numeric"
            value={day}
            onChange={handleDayChange}
            onKeyDown={(e) => handleKeyDown(e, "day")}
            onFocus={() => setFocused("day")}
            onBlur={() => setFocused(null)}
            placeholder={focused === "day" || day ? "" : "Tag (TT)"}
            className={cn(
              "w-full h-full bg-transparent text-center text-base sm:text-lg md:text-xl font-medium focus:outline-none transition-all placeholder:text-slate-500",
              day || focused === 'day' ? "pt-5 sm:pt-6 text-white" : "text-slate-500",
              hasError ? "text-rose-100" : ""
            )}
          />
        </div>

        {/* Subtle Divider */}
        <div className="w-px h-8 my-auto bg-white/10" />

        {/* MONTH Input */}
        <div className="flex-1 relative flex flex-col justify-center items-center group">
          <motion.div
            className="absolute top-1 text-[9px] sm:text-[10px] uppercase font-bold tracking-[0.15em] transition-colors"
            animate={{
              color: hasError ? "#fda4af" : focused === 'month' ? "#22d3ee" : "#94a3b8",
              y: month || focused === 'month' ? 0 : 8,
              opacity: month || focused === 'month' ? 1 : 0
            }}
            transition={{ duration: 0.2 }}
          >
            Monat
          </motion.div>
          <input
            ref={monthRef}
            type="text"
            inputMode="numeric"
            value={month}
            onChange={handleMonthChange}
            onKeyDown={(e) => handleKeyDown(e, "month")}
            onFocus={() => setFocused("month")}
            onBlur={() => setFocused(null)}
            placeholder={focused === "month" || month ? "" : "Monat (MM)"}
            className={cn(
              "w-full h-full bg-transparent text-center text-base sm:text-lg md:text-xl font-medium focus:outline-none transition-all placeholder:text-slate-500",
              month || focused === 'month' ? "pt-5 sm:pt-6 text-white" : "text-slate-500",
              hasError ? "text-rose-100" : ""
            )}
          />
        </div>

        {/* Subtle Divider */}
        <div className="w-px h-8 my-auto bg-white/10" />

        {/* YEAR Input */}
        <div className="flex-1 relative flex flex-col justify-center items-center group">
          <motion.div
            className="absolute top-1 text-[9px] sm:text-[10px] uppercase font-bold tracking-[0.15em] transition-colors"
            animate={{
              color: hasError ? "#fda4af" : focused === 'year' ? "#22d3ee" : "#94a3b8",
              y: year || focused === 'year' ? 0 : 8,
              opacity: year || focused === 'year' ? 1 : 0
            }}
            transition={{ duration: 0.2 }}
          >
            Jahr
          </motion.div>
          <input
            ref={yearRef}
            type="text"
            inputMode="numeric"
            value={year}
            onChange={handleYearChange}
            onKeyDown={(e) => handleKeyDown(e, "year")}
            onFocus={() => setFocused("year")}
            onBlur={() => setFocused(null)}
            placeholder={focused === "year" || year ? "" : "Jahr (JJJJ)"}
            className={cn(
              "w-full h-full bg-transparent text-center text-base sm:text-lg md:text-xl font-medium focus:outline-none transition-all placeholder:text-slate-500",
              year || focused === 'year' ? "pt-5 sm:pt-6 text-white" : "text-slate-500",
              hasError ? "text-rose-100" : ""
            )}
          />
        </div>
      </div>

      {/* Error Message Animation */}
      <AnimatePresence mode="wait">
        {activeError && (
          <motion.div
            key={activeError}
            initial={{ opacity: 0, height: 0, scale: 0.95 }}
            animate={{ opacity: 1, height: "auto", scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.95 }}
            transition={{ duration: 0.4, type: "spring", bounce: 0.4 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-3 mt-1 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm md:text-base font-medium">
              <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
              <p className="leading-snug">{activeError}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
