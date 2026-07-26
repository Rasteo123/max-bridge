import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  SchemaObserver,
  attachSchemaObserver,
  type SchemaObservation
} from "@maxbridge/max-adapter";
import { chromium } from "playwright";

const MAX_OBSERVATIONS = 500;
const outputPath = resolve(readOutputArgument(process.argv.slice(2)));
const headless = process.argv.includes("--headless");
const unique = new Map<string, SchemaObservation>();
const observer = new SchemaObserver((observation) => {
  if (unique.size >= MAX_OBSERVATIONS) {
    return;
  }
  unique.set(JSON.stringify(observation), observation);
});

const browser = await chromium.launch({ headless });
try {
  const context = await browser.newContext({
    acceptDownloads: false,
    locale: "ru-RU"
  });
  try {
    const page = await context.newPage();
    const attachment = attachSchemaObserver(page, observer);
    await page.goto("https://web.max.ru", {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });

    stdout.write(
      [
        "Окно MAX открыто.",
        "Войдите по QR или телефону, откройте тестовый чат,",
        "отправьте синтетический текст и одно тестовое изображение.",
        "Затем вернитесь сюда и нажмите Enter.",
        ""
      ].join("\n")
    );
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      await terminal.question("");
    } finally {
      terminal.close();
    }

    await attachment.stop();
    await writeSanitizedOutput(outputPath, [...unique.values()]);
    stdout.write(
      `Сохранены только обезличенные схемы: ${outputPath}\n`
    );
  } finally {
    await context.close();
  }
} catch {
  process.stderr.write(
    "Проверка остановлена без сохранения необработанных данных.\n"
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}

function readOutputArgument(args: readonly string[]): string {
  const index = args.indexOf("--output");
  if (index === -1) {
    return "work/max-schema-observations.json";
  }
  const candidate = args[index + 1];
  if (candidate === undefined || candidate.startsWith("-")) {
    throw new Error("Missing output path");
  }
  return candidate;
}

async function writeSanitizedOutput(
  path: string,
  observations: readonly SchemaObservation[]
): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true,
    mode: 0o700
  });
  await writeFile(
    path,
    `${JSON.stringify({ observations }, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
}
