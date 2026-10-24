import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

describe("repository ESLint coverage", () => {
    it("actually rejects a recommended TypeScript violation in source files", async () => {
        const [result] = await eslint.lintText("export type Empty = {};\n", { filePath: "src/eslint-coverage-probe.ts" });
        expect(result.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: "@typescript-eslint/no-empty-object-type", severity: 2 }),
        ]));
    });

    it("checks React hook correctness in TSX rather than silently ignoring the file", async () => {
        const [result] = await eslint.lintText('import { useState } from "react";\nexport function invalidFunction() { return useState(0); }\n', { filePath: "src/components/eslint-coverage-probe.tsx" });
        expect(result.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: "react-hooks/rules-of-hooks", severity: 2 }),
        ]));
    });

    it("keeps application and server TypeScript files inside lint coverage", async () => {
        for (const filePath of ["src/components/activity/ApplicationChat.tsx", "src/lib/auth.ts", "src/lib/dal/platform.ts"]) {
            expect(await eslint.isPathIgnored(filePath)).toBe(false);
        }
    });
});
