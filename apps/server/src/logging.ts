import { createWriteStream, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

const LOG_PREFIX = "enpet-";
const LOG_SUFFIX = ".log";
const KEEP_DAYS = 7;

function logFileName(date: string): string {
  return `${LOG_PREFIX}${date}${LOG_SUFFIX}`;
}

/** 从 enpet-2026-08-15.log 取回日期；不是日志文件就返回 null，避免误删别的东西 */
function dateFromLogFile(name: string): string | null {
  if (!name.startsWith(LOG_PREFIX) || !name.endsWith(LOG_SUFFIX)) return null;
  const date = name.slice(LOG_PREFIX.length, -LOG_SUFFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function dropStaleLogs(logDir: string, today: string): void {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
  for (const name of readdirSync(logDir)) {
    const date = dateFromLogFile(name);
    if (date && new Date(`${date}T00:00:00Z`) < cutoff) {
      rmSync(path.join(logDir, name), { force: true });
    }
  }
}

/**
 * 双击启动的应用没有终端，stdout 直接被系统丢掉——出错时用户手上什么线索都没有。
 * 日志同时写进数据目录，事后还能翻。从终端启动时 stdout 照常输出，两边都不耽误。
 *
 * 内存数据库（测试和临时场景）没有数据目录可言，此时只走 stdout，
 * 免得在项目目录里散落日志文件。
 */
export function createLogStream(databasePath: string, today: string): Writable | undefined {
  if (databasePath === ":memory:") return undefined;

  const logDir = path.join(path.dirname(databasePath), "logs");
  try {
    mkdirSync(logDir, { recursive: true });
    dropStaleLogs(logDir, today);
  } catch {
    // 日志写不了不该拖垮应用本身
    return undefined;
  }

  const file = createWriteStream(path.join(logDir, logFileName(today)), { flags: "a" });
  return new Writable({
    write(chunk, _encoding, callback) {
      process.stdout.write(chunk);
      file.write(chunk);
      callback();
    },
  });
}
