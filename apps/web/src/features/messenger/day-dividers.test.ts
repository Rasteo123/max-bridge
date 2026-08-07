import { describe, expect, it } from "vitest";

import { conversationRows, dayLabel } from "./day-dividers.js";
import type { MessengerMessage } from "./types.js";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function message(id: string, sentAt: string): MessengerMessage {
  return {
    id,
    text: `Сообщение ${id}`,
    direction: "incoming",
    sentAt
  };
}

describe("conversationRows", () => {
  it("opens a section for each day rather than labelling all as today", () => {
    const rows = conversationRows([
      message("1", "2026-08-05T09:00:00.000Z"),
      message("2", "2026-08-05T18:00:00.000Z"),
      message("3", "2026-08-07T08:00:00.000Z")
    ], NOW);

    expect(rows.map((row) =>
      row.kind === "divider" ? `[${row.label}]` : row.message.id
    )).toEqual(["[5 августа]", "1", "2", "[Сегодня]", "3"]);
  });

  it("keeps messages whose timestamp cannot be read", () => {
    const rows = conversationRows([message("1", "не дата")], NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("message");
  });

  it("returns nothing for an empty conversation", () => {
    expect(conversationRows([], NOW)).toEqual([]);
  });
});

describe("dayLabel", () => {
  it.each([
    ["2026-08-07T05:00:00.000Z", "Сегодня"],
    ["2026-08-06T12:00:00.000Z", "Вчера"],
    ["2026-08-01T10:00:00.000Z", "1 августа"],
    ["2025-12-31T10:00:00.000Z", "31 декабря 2025 г."]
  ])("labels %s as %s", (value, expected) => {
    expect(dayLabel(new Date(value), NOW)).toBe(expected);
  });
});
