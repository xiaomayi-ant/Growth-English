// Bundled entry for the desktop app: re-exports everything the Electron main
// process needs from the server and core packages so esbuild can produce a
// single self-contained dist/server.cjs.

export { ensureVaultDirectories, loadConfig, migrateLegacyDataDir } from "@enpet/core";
export { buildApp } from "../../server/src/app.js";
