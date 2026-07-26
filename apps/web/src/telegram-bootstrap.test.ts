import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const indexPage = new URL("../index.html", import.meta.url);

describe("Telegram Mini App bootstrap", () => {
  it("loads the official Telegram bridge before the application bundle", async () => {
    const html = await readFile(indexPage, "utf8");
    const telegramScript = html.indexOf(
      "https://telegram.org/js/telegram-web-app.js?63"
    );
    const applicationScript = html.indexOf("/src/main.tsx");

    expect(telegramScript).toBeGreaterThan(-1);
    expect(applicationScript).toBeGreaterThan(telegramScript);
  });
});
