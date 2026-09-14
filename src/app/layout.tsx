import type { Metadata, Viewport } from "next";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { DemoEmbedBridge, type DemoEmbedRole } from "@/components/demo/DemoEmbedBridge";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { cookies } from "next/headers";
import { DEMO_THEME_COOKIE, resolveDemoTheme } from "@/lib/demo/theme";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { getCurrentSessionAndProfile } from "@/lib/auth";
import { normalizeThemePreference, type ThemePreference } from "@/lib/theme-preference";
import "./globals.css";
import "./jobs-polish.css";
import "./activity-polish.css";

const fontSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobBridge",
  description:
    "JobBridge – Plattform für sichere Taschengeldjobs und Alltagshilfe.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/jobbridge-favicon-32.png?v=20260713",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/jobbridge-icon-192.png?v=20260713",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: "/jobbridge-favicon-32.png?v=20260713",
    apple: [
      {
        url: "/jobbridge-apple-touch-icon.png?v=20260713",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "JobBridge",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

function getThemeBootstrapScript(themePreference: ThemePreference) {
  const serializedThemePreference = JSON.stringify(themePreference);

  return `
(() => {
  try {
    const theme = ${serializedThemePreference};
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.dataset.themePreference = theme;
    root.dataset.themeResolved = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  } catch {}
})();
`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDemo = process.env.WORKFARE_DEMO_ENABLED === "true" || process.env.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED === "true";
  if (isDemo) requireDemoEnvironment(process.env);

  const { profile } = await getCurrentSessionAndProfile();
  const themePreference = isDemo
    ? resolveDemoTheme((await cookies()).get(DEMO_THEME_COOKIE)?.value)
    : normalizeThemePreference(profile?.theme_preference);
  const demoRole: DemoEmbedRole | null = profile?.account_type === "job_seeker"
    ? "seeker"
    : profile?.account_type === "job_provider" && profile.provider_kind === "company"
      ? "company"
      : profile?.account_type === "job_provider" && profile.provider_kind === "private"
        ? "private-provider"
        : null;

  return (
    <html lang="de" className={`${isDemo ? themePreference : "dark"} bg-background`} suppressHydrationWarning>
      <head>
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: getThemeBootstrapScript(themePreference) }}
        />
      </head>
      <body className={`${fontSans.variable} min-h-screen bg-background text-foreground antialiased selection:bg-blue-500/30`}>
        <ThemeProvider defaultTheme={themePreference} enableSystem={!isDemo}>
          {children}
          {isDemo && <DemoEmbedBridge role={demoRole} allowDevelopmentOrigins={process.env.NODE_ENV !== "production"} />}
        </ThemeProvider>
      </body>
    </html>
  );
}
