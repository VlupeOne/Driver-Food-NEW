import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifests = [
  "package.json",
  "apps/web/package.json",
  "packages/planner/package.json",
];

test("scripts encadeados funcionam quando o pnpm e executado pelo Corepack", () => {
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
      assert.doesNotMatch(
        command,
        /(^|(?:&&|\|\||;)\s*)pnpm(?:\s|$)/,
        `${manifestPath}#${name} chama pnpm sem Corepack: ${command}`,
      );
    }
  }

  const playwrightConfig = readFileSync("playwright.config.ts", "utf8");
  assert.doesNotMatch(
    playwrightConfig,
    /command:\s*["']pnpm(?:\s|$)/,
    "playwright.config.ts chama pnpm sem Corepack",
  );
});
