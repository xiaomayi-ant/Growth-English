import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
};

await build({
  ...shared,
  entryPoints: ["src/server-entry.ts"],
  outfile: "dist/server.cjs",
});

await build({
  ...shared,
  entryPoints: ["src/main.ts"],
  external: ["electron"],
  outfile: "dist/main.cjs",
});
