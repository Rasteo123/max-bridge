import type { MessengerMessage } from "./types.js";

export type ConversationRow =
  | Readonly<{ kind: "divider"; key: string; label: string }>
  | Readonly<{ kind: "message"; key: string; message: MessengerMessage }>;

const DAY_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long"
});

const DAY_WITH_YEAR_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric"
});

/**
 * Splits a conversation into day sections. The divider used to be a single
 * hardcoded "Сегодня" above the whole list, which labelled every message,
 * however old, as today's.
 */
export function conversationRows(
  messages: readonly MessengerMessage[],
  now: Date = new Date()
): readonly ConversationRow[] {
  const rows: ConversationRow[] = [];
  let currentDay: string | undefined;
  for (const message of messages) {
    const sentAt = new Date(message.sentAt);
    const day = Number.isNaN(sentAt.getTime())
      ? undefined
      : startOfDayKey(sentAt);
    if (day !== undefined && day !== currentDay) {
      currentDay = day;
      rows.push({
        kind: "divider",
        key: `divider-${day}`,
        label: dayLabel(sentAt, now)
      });
    }
    rows.push({ kind: "message", key: message.id, message });
  }
  return rows;
}

export function dayLabel(value: Date, now: Date): string {
  const days = dayDistance(value, now);
  if (days === 0) {
    return "Сегодня";
  }
  if (days === 1) {
    return "Вчера";
  }
  return value.getFullYear() === now.getFullYear()
    ? DAY_FORMAT.format(value)
    : DAY_WITH_YEAR_FORMAT.format(value);
}

function dayDistance(value: Date, now: Date): number {
  const from = Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  );
  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((to - from) / 86_400_000);
}

function startOfDayKey(value: Date): string {
  return [
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate()
  ].join("-");
}
