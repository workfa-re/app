"use client";

import { motion } from "framer-motion";
import clsx from "clsx";
import { BRAND_NAME } from "@/lib/constants";
import { ThemedLogoImage } from "@/components/ui/ThemedLogoImage";

type LogoProps = {
  withGlow?: boolean;
  size?: number;
  className?: string;
};

export function Logo({ withGlow = false, size = 80, className }: LogoProps) {
  return (
    <div className={clsx("relative inline-flex items-center justify-center", className)}>
      {withGlow && (
        <motion.div
          className="absolute inset-[-26px] rounded-full bg-cyan-400/30 blur-3xl"
          animate={{ opacity: [0.3, 0.6, 0.3], scale: [0.9, 1.05, 0.9] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <motion.div
        animate={withGlow ? { scale: [1, 1.04, 1] } : undefined}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <ThemedLogoImage
          alt={BRAND_NAME}
          width={size}
          height={size}
          priority={withGlow}
        />
      </motion.div>
    </div>
  );
}
