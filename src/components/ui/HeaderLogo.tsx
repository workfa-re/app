"use client";

import { motion } from "framer-motion";
import { BRAND_NAME } from "@/lib/constants";
import { ThemedLogoImage } from "@/components/ui/ThemedLogoImage";

export function HeaderLogo() {
  return (
    <div className="flex items-center">
      <motion.div
        className="relative h-14 w-14 overflow-hidden rounded-full bg-white/8 backdrop-blur-xl border border-white/10"
        style={{
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
        }}
        animate={{
          boxShadow: [
            "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
            "0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15) inset",
            "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
          ],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {/* Light reflection sweep */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          style={{
            transform: "skewX(-20deg)",
          }}
          animate={{
            x: ["-100%", "200%"],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "linear",
            repeatDelay: 2,
          }}
        />
        <ThemedLogoImage
          alt={BRAND_NAME}
          width={56}
          height={56}
          className="relative z-10 object-contain p-2"
          priority
        />
      </motion.div>
    </div>
  );
}
