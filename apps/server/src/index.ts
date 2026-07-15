import { loadConfig } from "@en-play/core";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config);

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`En Play is running at ${address}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
