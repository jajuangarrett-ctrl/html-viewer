import { build } from "esbuild";
await build({
  entryPoints: ["tests/harness.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  alias: { obsidian: "./tests/obsidian.ts" },
  outfile: "tests/browser/harness.js",
});
