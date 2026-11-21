import esbuild from "esbuild";
const prod = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "node:fs", "node:path"],
  platform: "browser",
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  outfile: "main.js",
  minify: prod,
});
if (prod) {
  await context.rebuild();
  await context.dispose();
} else await context.watch();
