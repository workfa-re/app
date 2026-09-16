"use client";

import { BRAND_NAME } from "@/lib/constants";
import clsx from "clsx";
import { BrandLogoImage } from "@/components/ui/BrandLogoImage";

type LogoBadgeProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeMap = {
  sm: { container: "w-16 h-16", image: 64 },
  md: { container: "w-20 h-20", image: 80 },
  lg: { container: "w-24 h-24", image: 96 },
};

export function LogoBadge({ size = "md", className }: LogoBadgeProps) {
  const sizes = sizeMap[size];

  return (
    <div
      className={clsx(
        sizes.container,
        "rounded-2xl",
        "overflow-hidden",
        "backdrop-blur-2xl",
        "bg-white",
        "border border-white/10",
        "shadow-[0_8px_30px_rgba(0,0,0,0.45)]",
        "flex items-center justify-center",
        "relative",
        "logo-badge",
        className
      )}
    >
      <BrandLogoImage
        alt={BRAND_NAME}
        width={sizes.image}
        height={sizes.image}
        className="relative z-10 object-contain"
        priority
      />
    </div>
  );
}
