import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewQueue, StudySession } from "@en-play/core";

async function atomicWrite(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, targetPath);
}

export function renderReviewQueue(queue: ReviewQueue): string {
  const renderSection = (title: string, items: ReviewQueue["dueToday"]): string => {
    const rows = items.map(
      (item) =>
        `| ${item.sourceEntry.word} | ${item.sourceEntry.meaning} | D${item.roundNumber} | ${item.dueOn} | ${path.basename(item.sourceEntry.sourcePath)} |`,
    );
    return [
      `## ${title}`,
      "",
      "| Word | 中文 | 轮次 | 日期 | 来源 |",
      "| --- | --- | --- | --- | --- |",
      ...(rows.length ? rows : ["| - | - | - | - | - |"]),
    ].join("\n");
  };

  return [
    "# 英语待复习队列",
    "",
    `更新时间：${queue.today}`,
    "",
    "> 此页面由 En Play 从 SQLite 自动生成。修改本文件不会改变复习状态。",
    "",
    renderSection("逾期", queue.overdue),
    "",
    renderSection("今日到期", queue.dueToday),
    "",
    renderSection("即将到期", queue.upcoming),
    "",
  ].join("\n");
}

export async function writeReviewQueue(targetPath: string, queue: ReviewQueue): Promise<void> {
  await atomicWrite(targetPath, renderReviewQueue(queue));
}

export function renderDailyReport(date: string, sessions: StudySession[]): string {
  const sections = sessions.map((session) => {
    const title = session.type === "new_learning" ? "新词学习" : "到期复习";
    const rows = session.items.map(
      (item) =>
        `| ${item.sourceEntry.word} | ${item.sourceEntry.meaning} | ${item.rating ?? "未完成"} | ${item.feedback ?? ""} |`,
    );
    return [
      `## ${title}`,
      "",
      `状态：${session.status}`,
      "",
      "| Word | 中文 | 评分 | 反馈 |",
      "| --- | --- | --- | --- |",
      ...(rows.length ? rows : ["| - | - | - | - |"]),
      session.passage ? `\n### 情景短文\n\n${session.passage}` : "",
    ].join("\n");
  });
  return ["# 英语学习记录", "", `日期：${date}`, "", ...sections, ""].join("\n");
}

export async function writeDailyReport(
  reportsDirectory: string,
  date: string,
  sessions: StudySession[],
): Promise<void> {
  await atomicWrite(path.join(reportsDirectory, `${date}.md`), renderDailyReport(date, sessions));
}
