"use client";

import { BRAND_NAME } from "@/lib/constants";
import clsx from "clsx";
import { ThemedLogoImage } from "@/components/ui/ThemedLogoImage";

type LogoBadgeProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeMap = {
  sm: { container: "w-16 h-16", image: 48 },
  md: { container: "w-20 h-20", image: 64 },
  lg: { container: "w-24 h-24", image: 72 },
};

export function LogoBadge({ size = "md", className }: LogoBadgeProps) {
  const sizes = sizeMap[size];

  return (
    <div
      className={clsx(
        sizes.container,
        "rounded-full",
        "overflow-hidden",
        "backdrop-blur-2xl",
        "bg-white/10",
        "border border-white/10",
        "shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
        "flex items-center justify-center",
        "relative",
        "logo-badge",
        className
      )}
    >
      {/* Highlight-Layer */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/25 to-transparent opacity-60 pointer-events-none mix-blend-screen" />
      <ThemedLogoImage
        alt={BRAND_NAME}
        width={sizes.image}
        height={sizes.image}
        className="relative z-10 scale-125 object-contain"
        priority
      />
    </div>
  );
}
