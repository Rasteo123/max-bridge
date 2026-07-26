import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { classifyWirePayload } from "./wire-classifier.js";

type ClassifierFixture = Readonly<{
  classifiers: Readonly<Record<string, unknown>>;
  maxFrames: Readonly<Record<string, Readonly<{
    command: number;
    opcode: number;
    payload: unknown;
  }>>>;
}>;

describe("MAX wire classifier", () => {
  it("classifies structural chat, history, event and acknowledgement shapes", async () => {
    const fixture = await loadFixture();

    expect(classifyWirePayload(fixture.classifiers["chatList"]))
      .toBe("chat_list");
    expect(classifyWirePayload(fixture.classifiers["history"]))
      .toBe("history");
    expect(classifyWirePayload(fixture.classifiers["liveEvent"]))
      .toBe("live_event");
    expect(classifyWirePayload(fixture.classifiers["sendAck"]))
      .toBe("send_ack");
    expect(classifyWirePayload(fixture.classifiers["unknown"]))
      .toBe("unknown");
  });

  it("never throws on malformed or hostile values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(classifyWirePayload(cyclic)).toBe("unknown");
    expect(classifyWirePayload(null)).toBe("unknown");
    expect(classifyWirePayload("PRIVATE_MESSAGE_CANARY")).toBe("unknown");
  });

  it("uses MAX command and opcode metadata before ambiguous nested keys", async () => {
    const fixture = await loadFixture();

    expect(classifyFrame(fixture, "sessionSyncRequest")).toBe("chat_list");
    expect(classifyFrame(fixture, "historyResponse")).toBe("history");
    expect(classifyFrame(fixture, "incomingMessage")).toBe("live_event");
    expect(classifyFrame(fixture, "sendResponse")).toBe("send_ack");
  });
});

async function loadFixture(): Promise<ClassifierFixture> {
  const source = await readFile(
    new URL("../../tests/fixtures/synthetic-wire-events.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(source) as ClassifierFixture;
}

function classifyFrame(
  fixture: ClassifierFixture,
  name: string
) {
  const frame = fixture.maxFrames[name];
  if (frame === undefined) {
    throw new Error("Missing synthetic frame");
  }
  return classifyWirePayload(frame.payload, {
    command: frame.command,
    opcode: frame.opcode
  });
}
