import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  SchemaObserver,
  extractStructuralSchema,
  sanitizeEndpoint
} from "./schema-observer.js";

type SyntheticFixture = Readonly<{
  secrets: readonly string[];
  httpRequest: Readonly<{
    url: string;
    method: string;
    contentType: string;
    body: unknown;
  }>;
  httpResponse: Readonly<{
    url: string;
    method: string;
    status: number;
    contentType: string;
    body: unknown;
  }>;
  webSocket: Readonly<{
    url: string;
    direction: "sent" | "received";
    payload: unknown;
  }>;
}>;

describe("privacy-preserving MAX schema observer", () => {
  it("keeps only endpoint shape, methods, status and structural types", async () => {
    const fixture = await loadFixture();
    const observations: unknown[] = [];
    const observer = new SchemaObserver((observation) => {
      observations.push(observation);
    });

    observer.observeHttpRequest(fixture.httpRequest);
    observer.observeHttpResponse(fixture.httpResponse);
    observer.observeWebSocketFrame(fixture.webSocket);

    const serialized = JSON.stringify(observations);
    for (const secret of fixture.secrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('"method":"POST"');
    expect(serialized).toContain('"status":200');
    expect(serialized).toContain('"type":"object"');
    expect(serialized).toContain('"direction":"received"');
  });

  it("redacts query values and generalizes identifying path segments", () => {
    expect(sanitizeEndpoint(
      "https://web.max.ru/api/chats/123456/messages/550e8400-e29b-41d4-a716-446655440000?token=secret&cursor=private"
    )).toEqual({
      origin: "https://web.max.ru",
      pathPattern: "/api/chats/:id/messages/:id",
      queryKeys: ["cursor", "token"]
    });
  });

  it("caps depth, keys, array lengths and oversized payloads", () => {
    const manyItems = Array.from({ length: 100 }, (_, index) => ({
      value: `secret-${String(index)}`
    }));
    const schema = extractStructuralSchema(manyItems, {
      maxBytes: 64,
      measuredBytes: 10_000
    });

    expect(schema).toEqual({
      type: "truncated",
      reason: "size_limit"
    });
    expect(JSON.stringify(schema)).not.toContain("secret-");
  });

  it("describes binary data without retaining bytes", () => {
    const schema = extractStructuralSchema(
      Buffer.from("BINARY_CANARY", "utf8")
    );

    expect(schema).toEqual({ type: "binary" });
    expect(JSON.stringify(schema)).not.toContain("BINARY_CANARY");
  });

  it("decodes MessagePack frames to structure without retaining values", () => {
    const observations: unknown[] = [];
    const observer = new SchemaObserver((observation) => {
      observations.push(observation);
    });
    const payload = Buffer.from(
      "82a66f70636f646501a77061796c6f616481a86d657373616765739181a474657874a6736563726574",
      "hex"
    );
    const frame = Buffer.alloc(10 + payload.byteLength);
    frame[0] = 10;
    frame[1] = 0;
    frame.writeInt16BE(7, 2);
    frame.writeInt16BE(128, 4);
    frame[6] = 0;
    frame[7] = payload.byteLength >>> 16 & 0xff;
    frame[8] = payload.byteLength >>> 8 & 0xff;
    frame[9] = payload.byteLength & 0xff;
    payload.copy(frame, 10);

    observer.observeWebSocketFrame({
      url: "wss://api.oneme.ru/websocket",
      direction: "received",
      payload: frame,
      measuredBytes: frame.byteLength
    });

    expect(observations).toHaveLength(1);
    expect(JSON.stringify(observations)).toContain('"opcode":128');
    expect(JSON.stringify(observations)).toContain('"opcode"');
    expect(JSON.stringify(observations)).toContain('"messages"');
    expect(JSON.stringify(observations)).not.toContain("secret");
  });
});

async function loadFixture(): Promise<SyntheticFixture> {
  const source = await readFile(
    new URL("../../tests/fixtures/synthetic-wire-events.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(source) as SyntheticFixture;
}
