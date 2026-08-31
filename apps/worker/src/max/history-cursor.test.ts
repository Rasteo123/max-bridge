import { describe, expect, it } from "vitest";

import { historyWindowStart } from "./history-cursor.js";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");

describe("historyWindowStart", () => {
  it("starts an older page at the moment the cursor names", () => {
    expect(historyWindowStart("2026-08-04T08:01:25.766Z", NOW))
      .toBe(Date.parse("2026-08-04T08:01:25.766Z"));
  });

  it("starts at the newest message when no cursor is given", () => {
    expect(historyWindowStart(undefined, NOW)).toBe(NOW);
  });

  it("ignores a cursor that is not a moment", () => {
    // NaN would travel into the wire request as `from` and blank the chat.
    expect(historyWindowStart("not-a-time", NOW)).toBe(NOW);
  });
});
