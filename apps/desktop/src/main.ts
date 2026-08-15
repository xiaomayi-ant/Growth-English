import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import type { AppConfig } from "@enpet/core";
import { app, BrowserWindow, dialog } from "electron";

interface EnPetServer {
  listen(options: { host: string; port: number }): Promise<string>;
  close(): Promise<void>;
}

interface ServerBundle {
  buildApp: (config: AppConfig) => Promise<EnPetServer>;
  loadConfig: (env: NodeJS.ProcessEnv) => AppConfig;
  ensureVaultDirectories: (config: AppConfig) => Promise<void>;
  migrateLegacyDataDir: (env?: NodeJS.ProcessEnv) => Promise<void>;
  readDataDirPointer: (pointerDir: string) => string | null;
  databasePathForDataDir: (dataDir: string) => string;
}

const WINDOW_WIDTH = 1080;
const WINDOW_HEIGHT = 760;

// package.json 的 name 是 @enpet/desktop（含斜杠），不能用作 userData 目录名
app.setName("EnPet");

let server: EnPetServer | null = null;
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
    vocabDir: "ENPET_VOCAB_DIR",
    reportsDir: "ENPET_REPORTS_DIR",
    reviewQueuePath: "ENPET_REVIEW_QUEUE_PATH",
    timeZone: "ENPET_TIMEZONE",
    newWordsPerDay: "ENPET_NEW_WORDS_PER_DAY",
    reviewLimit: "ENPET_REVIEW_LIMIT",
    reminderTime: "ENPET_REMINDER_TIME",
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
  const {
    buildApp,
    loadConfig,
    ensureVaultDirectories,
    migrateLegacyDataDir,
    readDataDirPointer,
    databasePathForDataDir,
  } = loadServerBundle();
  // ENPET_DATA_DIR 把整个数据目录挪到别处，用来在不碰真实数据的前提下重跑引导。
  // 它生效时两处迁移都必须跳过：任何一处把旧数据搬进隔离目录，那个目录就变成了
  // 「老用户」，引导又不会出现，隔离等于白做。
  const isolatedDataDir = process.env.ENPET_DATA_DIR;

  // 改名前的 "En Play" 数据目录必须在读取配置和设置文件之前搬过来
  await migrateLegacyDataDir(process.env);

  const userDataDir = isolatedDataDir ? path.resolve(isolatedDataDir) : app.getPath("userData");
  const settingsEnv = await loadSettingsEnv(userDataDir);

  // 用户在引导里选过数据目录就用它，否则用推荐目录（= userData）
  const pointedDataDir = readDataDirPointer(userDataDir);
  const databasePath = pointedDataDir
    ? databasePathForDataDir(pointedDataDir)
    : path.join(userDataDir, "enpet.sqlite3");

  if (!isolatedDataDir) {
    // loadConfig({}) 刻意不带环境变量：要的是改名前那个固定的默认位置
    await migrateLegacyDatabase(databasePath, loadConfig({}).databasePath);
  }

  // Electron 会自己建 userData，隔离目录则是全新的，数据库落地前得先有父目录
  await mkdir(path.dirname(databasePath), { recursive: true });

  // databasePath 要先定下来，loadConfig 才知道去哪个目录读 settings.json
  const base = loadConfig({ ...process.env, ENPET_DATABASE_PATH: databasePath, ...settingsEnv });

  // 只有 Electron 知道打包后的真实版本号，注入给服务端，界面上就能看出跑的是哪一版
  process.env.ENPET_APP_VERSION = app.getVersion();

  process.env.ENPET_WEB_DIST = app.isPackaged
    ? path.join(process.resourcesPath, "web-dist")
    : path.resolve(__dirname, "../../web/dist");

  const port = await findFreePort();
  const config: AppConfig = { ...base, port, databasePath };
  await ensureVaultDirectories(config);
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
    title: "EnPet",
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
        "EnPet 启动失败",
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
