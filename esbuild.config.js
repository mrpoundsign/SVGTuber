import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: {
    "overlay/overlay": "web/src/overlay/index.ts",
    "studio/tracker": "web/src/studio/index.ts",
  },
  bundle: true,
  outdir: "web",
  format: "esm",
  target: "es2022",
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

const sdPluginRoot = "internal/streamdeck/plugin/com.github.mrpoundsign.svgtuber.sdPlugin";

const sdNodeOptions = {
  entryPoints: ["integrations/streamdeck/src/plugin.ts"],
  bundle: true,
  outfile: `${sdPluginRoot}/bin/plugin.js`,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

const sdPiOptions = {
  entryPoints: ["integrations/streamdeck/src/pi.ts"],
  bundle: true,
  outfile: `${sdPluginRoot}/property-inspector/pi.js`,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching web/src for changes...");
} else {
  await esbuild.build(buildOptions);
  await esbuild.build(sdNodeOptions);
  await esbuild.build(sdPiOptions);
  console.log("✓ Frontend & Stream Deck plugin bundled successfully");
}
