"use client";

import { useEffect } from "react";
import { useTheme } from "@/components/providers/ThemeProvider";
import { DEMO_THEME_COOKIE, DEMO_THEME_MAX_AGE, parseDemoTheme } from "@/lib/demo/theme";

export type DemoEmbedRole = "seeker" | "private-provider" | "company";

type DemoEmbedBridgeProps = {
  role: DemoEmbedRole | null;
  allowDevelopmentOrigins: boolean;
};

/** The website controls appearance; the normal app still owns its profile, navigation and actions. */
export function DemoEmbedBridge({ role, allowDevelopmentOrigins }: DemoEmbedBridgeProps) {
  const { setTheme } = useTheme();

  useEffect(() => {
    if (!role || window.parent === window) return;

    let parentOrigin: string;
    try {
      parentOrigin = new URL(document.referrer).origin;
    } catch {
      return;
    }

    const allowed = parentOrigin === "https://workfa.re"
      || parentOrigin === "https://www.workfa.re"
      || (allowDevelopmentOrigins && (
        parentOrigin === "http://localhost:3000"
        || parentOrigin === "http://127.0.0.1:3000"
      ));
    if (!allowed) return;

    const syncTheme = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const data = event.data;
      if (typeof data !== "object" || data === null || !("type" in data)) return;
      if (data.type === "workfare:demo-ready-request") {
        // The iframe can finish before its parent hydrates. Answer its later handshake.
        window.parent.postMessage({ type: "workfare:demo-ready", role }, parentOrigin);
        return;
      }
      if (data.type !== "workfare:demo-theme" || !("theme" in data)) return;
      const theme = parseDemoTheme(data.theme);
      if (!theme) return;
      setTheme(theme);
      // Cosmetic only: never update the signed-in profile or its database preference.
      document.cookie = `${DEMO_THEME_COOKIE}=${theme}; Path=/; Max-Age=${DEMO_THEME_MAX_AGE}; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    };

    // Install before readiness so the parent's first response cannot be missed.
    window.addEventListener("message", syncTheme);
    window.parent.postMessage({ type: "workfare:demo-ready", role }, parentOrigin);
    return () => window.removeEventListener("message", syncTheme);
  }, [role, allowDevelopmentOrigins, setTheme]);

  return null;
}
