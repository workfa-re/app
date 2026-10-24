import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Familie · Workfare",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
};

export default function GuardianLayout({ children }: { children: React.ReactNode }) {
    return children;
}
