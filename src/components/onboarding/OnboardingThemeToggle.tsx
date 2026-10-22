"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { normalizeThemePreference, type ThemePreference } from "@/lib/theme-preference";

const STORAGE_KEY = "workfare:onboarding-theme:v1";
const CHANGE_EVENT = "workfare:onboarding-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const bootstrap = `(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem("${STORAGE_KEY}");
    if (stored === "light" || stored === "dark") preference = stored;
  } catch {}
  document.documentElement.setAttribute("data-onboarding-theme", preference);
})();`;

/** Render once in the root <head>, before onboarding content can paint. */
export function OnboardingThemeBootstrap({ nonce }: { nonce?: string }) {
  return <script id="onboarding-theme-bootstrap" nonce={nonce} dangerouslySetInnerHTML={{ __html: bootstrap }} />;
}

function readPreference(): ThemePreference {
  const applied = document.documentElement.getAttribute("data-onboarding-theme");
  if (applied !== null) return normalizeThemePreference(applied);
  try {
    return normalizeThemePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function getSnapshot() {
  const preference = readPreference();
  const resolved = preference === "system"
    ? window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
    : preference;
  return `${preference}:${resolved}`;
}

function getServerSnapshot() {
  return "system:light";
}

function subscribe(onChange: () => void) {
  const mediaQuery = window.matchMedia(DARK_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    document.documentElement.setAttribute("data-onboarding-theme", normalizeThemePreference(event.newValue));
    onChange();
  };
  mediaQuery.addEventListener("change", onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    mediaQuery.removeEventListener("change", onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** This preference only changes onboarding colors; the account theme is untouched. */
export function setOnboardingThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") return;
  const normalized = normalizeThemePreference(preference);
  document.documentElement.setAttribute("data-onboarding-theme", normalized);
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Keep the current choice for this page when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function OnboardingThemeToggle({ className = "" }: { className?: string }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dark = snapshot.endsWith(":dark");

  return <button type="button" className={`onboarding-theme-toggle ${className}`}
    aria-label="Dunkles Farbschema" aria-pressed={dark}
    title={dark ? "Helles Farbschema aktivieren" : "Dunkles Farbschema aktivieren"}
    onClick={() => setOnboardingThemePreference(dark ? "light" : "dark")}>
    <Sun className="onboarding-theme-sun" size={20} strokeWidth={1.6} aria-hidden="true" />
    <Moon className="onboarding-theme-moon" size={20} strokeWidth={1.6} aria-hidden="true" />
  </button>;
}
