import { REVIEW_OFFSETS, type ReviewOffset } from "./types.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateOnly(value: string): void {
  if (!DATE_PATTERN.test(value) || Number.isNaN(toUtcDate(value).getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
}

export function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, amount: number): string {
  assertDateOnly(value);
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

export function isWeekend(value: string): boolean {
  assertDateOnly(value);
  const day = toUtcDate(value).getUTCDay();
  return day === 0 || day === 6;
}

export function nextWorkday(value: string): string {
  let current = value;
  while (isWeekend(current)) {
    current = addCalendarDays(current, 1);
  }
  return current;
}

export function differenceInCalendarDays(later: string, earlier: string): number {
  assertDateOnly(later);
  assertDateOnly(earlier);
  return Math.floor((toUtcDate(later).getTime() - toUtcDate(earlier).getTime()) / 86_400_000);
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export interface ReviewDate {
  roundNumber: number;
  offsetDays: ReviewOffset;
  scheduledOn: string;
  effectiveDueOn: string;
}

export function buildReviewDates(introducedOn: string): ReviewDate[] {
  return REVIEW_OFFSETS.map((offsetDays, index) => {
    const scheduledOn = addCalendarDays(introducedOn, offsetDays);
    return {
      roundNumber: index + 1,
      offsetDays,
      scheduledOn,
      effectiveDueOn: nextWorkday(scheduledOn),
    };
  });
}
