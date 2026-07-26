import { describe, expect, it } from "vitest";

import {
  mediaPath,
  safeMaxMediaUrl
} from "./MediaMessage.js";

describe("message media URLs", () => {
  it("accepts only HTTPS media from the MAX CDN", () => {
    expect(safeMaxMediaUrl(
      "https://i.oneme.ru/i?r=signed&expires=1785192900426"
    )).toBe("https://i.oneme.ru/i?r=signed&expires=1785192900426");
    expect(safeMaxMediaUrl("https://example.com/image.png")).toBeNull();
    expect(safeMaxMediaUrl("http://i.oneme.ru/image.png")).toBeNull();
    expect(safeMaxMediaUrl("https://user@i.oneme.ru/image.png")).toBeNull();
  });

  it("keeps fallback media handles route-safe", () => {
    expect(mediaPath("media_1")).toBe("/api/media/media_1");
    expect(mediaPath("media:unsafe")).toBeNull();
  });
});
