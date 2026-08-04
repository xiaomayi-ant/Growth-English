import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import type { AppConfig } from "@en-play/core";
import { app, BrowserWindow, dialog } from "electron";

interface EnPlayServer {
  listen(options: { host: string; port: number }): Promise<string>;
  close(): Promise<void>;
}

interface ServerBundle {
  buildApp: (config: AppConfig) => Promise<EnPlayServer>;
  loadConfig: (env: NodeJS.ProcessEnv) => AppConfig;
}

const WINDOW_WIDTH = 1080;
const WINDOW_HEIGHT = 760;

// package.json 的 name 是 @en-play/desktop（含斜杠），不能用作 userData 目录名
app.setName("En Play");

let server: EnPlayServer | null = null;
let activePort: number | null = null;
let quitting = false;

function loadServerBundle(): ServerBundle {
  // server.cjs sits next to main.cjs (inside app.asar when packaged); resolved
  // at runtime on purpose so esbuild keeps it as a separate bundle.
  const require = createRequire(path.join(__dirname, "/"));
  return require("./server.cjs") as ServerBundle;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const { port } = address;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error("无法探测空闲端口")));
      }
    });
  });
}

async function loadSettingsEnv(userDataDir: string): Promise<Record<string, string>> {
  // Reserved extension point: userData/settings.json can override config values
  // until a proper settings page exists.
  const keyMap: Record<string, string> = {
    vocabDir: "EN_PLAY_VOCAB_DIR",
    reportsDir: "EN_PLAY_REPORTS_DIR",
    reviewQueuePath: "EN_PLAY_REVIEW_QUEUE_PATH",
    timeZone: "EN_PLAY_TIMEZONE",
    newWordsPerDay: "EN_PLAY_NEW_WORDS_PER_DAY",
    reviewLimit: "EN_PLAY_REVIEW_LIMIT",
  };
  try {
    const raw = await readFile(path.join(userDataDir, "settings.json"), "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env: Record<string, string> = {};
    for (const [key, envKey] of Object.entries(keyMap)) {
      const value = settings[key];
      if (value !== undefined && value !== null) {
        env[envKey] = String(value);
      }
    }
    return env;
  } catch {
    return {};
  }
}

async function migrateLegacyDatabase(databasePath: string, legacyPath: string): Promise<void> {
  if (databasePath === legacyPath) return;
  if (existsSync(databasePath) || !existsSync(legacyPath)) return;
  // WAL 模式下数据主要在 -wal 文件中，三个文件必须一起复制才完整
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${legacyPath}${suffix}`;
    if (existsSync(source)) {
      await copyFile(source, `${databasePath}${suffix}`);
    }
  }
}

async function startServer(): Promise<number> {
  const { buildApp, loadConfig } = loadServerBundle();
  const userDataDir = app.getPath("userData");
  const settingsEnv = await loadSettingsEnv(userDataDir);
  const legacyDatabasePath = loadConfig({}).databasePath;
  const base = loadConfig({ ...process.env, ...settingsEnv });

  const databasePath = path.join(userDataDir, "en-play.sqlite3");
  await migrateLegacyDatabase(databasePath, legacyDatabasePath);

  process.env.EN_PLAY_WEB_DIST = app.isPackaged
    ? path.join(process.resourcesPath, "web-dist")
    : path.resolve(__dirname, "../../web/dist");

  const port = await findFreePort();
  const config: AppConfig = { ...base, port, databasePath };
  server = await buildApp(config);
  await server.listen({ host: config.host, port });
  return port;
}

function createWindow(): void {
  if (activePort === null) return;
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 720,
    minHeight: 560,
    title: "En Play",
    backgroundColor: "#f4f6f3",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  void window.loadURL(`http://127.0.0.1:${activePort}`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  void app.whenReady().then(async () => {
    try {
      activePort = await startServer();
      createWindow();
    } catch (error) {
      dialog.showErrorBox(
        "En Play 启动失败",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && activePort !== null) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("will-quit", (event) => {
    if (server && !quitting) {
      quitting = true;
      event.preventDefault();
      void server
        .close()
        .catch(() => undefined)
        .finally(() => app.quit());
    }
  });
}
