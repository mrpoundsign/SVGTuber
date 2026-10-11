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

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching web/src for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("✓ Frontend TypeScript bundled successfully into web/overlay and web/studio");
}
