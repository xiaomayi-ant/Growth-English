import { ensureVaultDirectories, loadConfig, migrateLegacyDataDir } from "@enpet/core";
import { buildApp } from "./app.js";

await migrateLegacyDataDir();
const config = loadConfig();
await ensureVaultDirectories(config);
const app = await buildApp(config);

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`EnPet is running at ${address}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
