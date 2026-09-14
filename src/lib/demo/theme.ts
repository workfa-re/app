/** A cosmetic preference, separate from all authentication cookies and profile data. */
export type DemoTheme = "dark" | "light";

export const DEMO_THEME_COOKIE = "wf-demo-theme";
export const DEMO_THEME_MAX_AGE = 60 * 60 * 24;

export function parseDemoTheme(value: unknown): DemoTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

export function resolveDemoTheme(value: unknown): DemoTheme {
  return parseDemoTheme(value) ?? "dark";
}
