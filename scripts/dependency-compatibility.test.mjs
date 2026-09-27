import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Linter } from "eslint";

const requireFromNext = createRequire(import.meta.resolve("eslint-config-next"));
const importPlugin = requireFromNext("eslint-plugin-import");

function lintImports(source) {
  return new Linter().verify(source, [{
    plugins: { import: importPlugin },
    rules: {
      "import/order": ["error", {
        groups: ["builtin", "external", "internal"],
        pathGroups: [{ pattern: "@/**", group: "internal" }],
      }],
    },
  }]);
}

// Cross-major minimatch overrides previously made this real plugin call throw.
test("Next's import plugin accepts correctly ordered alias imports", () => {
  assert.deepEqual(lintImports('import fs from "node:fs";\nimport value from "@/value";'), []);
});

test("Next's import plugin still reports incorrectly ordered alias imports", () => {
  const messages = lintImports('import value from "@/value";\nimport fs from "node:fs";');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, "import/order");
  assert.equal(messages[0].severity, 2);
});
