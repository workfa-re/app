import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "dist/**",
  ]),
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      // Existing RPC boundary types are improved separately from runtime lint.
      "@typescript-eslint/no-explicit-any": "off",
      // React Compiler is not enabled. Keep effect synchronization visible as
      // an optimization warning while correctness and Hooks rules stay errors.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);
