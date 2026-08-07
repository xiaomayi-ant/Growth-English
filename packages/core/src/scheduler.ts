import type { AppConfig } from "./config.js";
import { todayInTimeZone } from "./dates.js";

export interface ScheduledTask {
  id: string;
  name: string;
  type: "new_learning" | "review";
  scheduleTime: string; // HH:MM format
  lastRun: string | null;
  nextRun: string | null;
  enabled: boolean;
}

export interface TaskRunResult {
  taskId: string;
  runAt: string;
  success: boolean;
  message: string;
  sessionId?: string;
}

export class TaskScheduler {
  private tasks: Map<string, NodeJS.Timeout> = new Map();
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async getDefaultTasks(): Promise<ScheduledTask[]> {
    const now = todayInTimeZone(this.config.timeZone);
    return [
      {
        id: "daily-new-learning",
        name: "每日新词学习",
        type: "new_learning",
        scheduleTime: this.config.reminderTime,
        lastRun: null,
        nextRun: this.calculateNextRun(this.config.reminderTime),
        enabled: true,
      },
      {
        id: "daily-review",
        name: "每日到期复习",
        type: "review",
        scheduleTime: this.config.reminderTime,
        lastRun: null,
        nextRun: this.calculateNextRun(this.config.reminderTime),
        enabled: true,
      },
    ];
  }

  private calculateNextRun(scheduleTime: string): string | null {
    const [hoursStr, minutesStr] = scheduleTime.split(":");
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);

    if (isNaN(hours) || isNaN(minutes)) {
      return null;
    }

    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(hours, minutes, 0, 0);

    // 如果今天的时间已过，检查是否为工作日
    if (scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }

    // 检查是否为工作日（周一至周五）
    const day = scheduled.getDay();
    if (day === 0 || day === 6) {
      // 周日(0)或周六(6)，跳过到下周一
      scheduled.setDate(scheduled.getDate() + (day === 0 ? 1 : 2));
    }

    return scheduled.toISOString().split("T")[0] || null;
  }

  private isWeekday(date: Date): boolean {
    const day = date.getDay();
    return day >= 1 && day <= 5; // 周一至周五
  }

  shouldRunToday(scheduleTime: string): boolean {
    const now = new Date();
    const [hoursStr, minutesStr] = scheduleTime.split(":");
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);

    if (isNaN(hours) || isNaN(minutes)) {
      return false;
    }

    const scheduled = new Date();
    scheduled.setHours(hours, minutes, 0, 0);

    // 检查是否已经过了今天的时间
    if (scheduled > now) {
      return false;
    }

    // 检查是否为工作日
    return this.isWeekday(now);
  }

  async runTaskManually(taskId: string, runFunction: () => Promise<TaskRunResult>): Promise<TaskRunResult> {
    try {
      const result = await runFunction();
      return result;
    } catch (error) {
      return {
        taskId,
        runAt: new Date().toISOString(),
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  stopAllTasks(): void {
    for (const [id, timeout] of this.tasks) {
      clearTimeout(timeout);
      console.log(`Stopped task: ${id}`);
    }
    this.tasks.clear();
  }

  getActiveTaskCount(): number {
    return this.tasks.size;
  }
}
