"use client";

import { motion } from "framer-motion";
import clsx from "clsx";
import { BRAND_NAME } from "@/lib/constants";
import { ThemedLogoImage } from "@/components/ui/ThemedLogoImage";

type LogoAnimatedProps = {
  size?: number;
  withGlow?: boolean;
  className?: string;
  variant?: "large" | "small";
};

export function LogoAnimated({
  size = 100,
  withGlow = false,
  className,
  variant = "large",
}: LogoAnimatedProps) {
  const logoSize = variant === "large" ? size : size * 0.8;

  return (
    <div className={clsx("relative inline-flex items-center justify-center", className)}>
      {withGlow && (
        <motion.div
          className="absolute inset-[-20%] rounded-full bg-cyan-300/25 blur-3xl"
          animate={{ opacity: [0.25, 0.5, 0.25], scale: [0.95, 1.05, 0.95] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {/* Soft glow edge */}
      <motion.div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-white/20 via-white/5 to-transparent blur-xl"
        animate={{ opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      
      {/* Badge container with shadow breathing */}
      <motion.div
        className={clsx(
          "relative rounded-full overflow-hidden bg-white/10 backdrop-blur-xl border border-white/10 p-3",
          variant === "small" && "p-2"
        )}
        style={{
          boxShadow:
            "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
        }}
        animate={{
          boxShadow: [
            "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
            "0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15) inset",
            "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
          ],
        }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Light reflection sweep */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          style={{ transform: "skewX(-20deg)" }}
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
        />
        
        {/* Logo image */}
        <div className="relative z-10">
          <ThemedLogoImage
            alt={BRAND_NAME}
            width={logoSize}
            height={logoSize}
            priority={variant === "large"}
            className="drop-shadow-lg"
          />
        </div>
      </motion.div>
    </div>
  );
}
