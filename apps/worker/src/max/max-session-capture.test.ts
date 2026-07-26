import { describe, expect, it } from "vitest";

import {
  captureMaxSessionContext
} from "./max-session-capture.js";

describe("MAX session capture", () => {
  it("captures a live MAX-shaped context and restores Map.set", () => {
    const accessorKey = `maxbridge.test.${String(Date.now())}`;
    const originalSet = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "set"
    )?.value as unknown;
    captureMaxSessionContext(accessorKey);
    const context = new Map<unknown, unknown>();
    const session = {
      viewer: { id: "viewer-1" },
      sessionConfig: {},
      serverConfig: {}
    };
    context.set({}, () => ({
      viewer: session.viewer,
      sessionConfig: session.sessionConfig,
      serverConfig: session.serverConfig
    }));
    session.viewer.id = "viewer-2";

    const accessor = (
      globalThis as Record<PropertyKey, unknown>
    )[Symbol.for(accessorKey)];
    const captured = (accessor as () => {
      viewer?: { id?: unknown };
    } | undefined)();

    expect(captured?.viewer?.id).toBe("viewer-2");
    const currentSet = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "set"
    )?.value as unknown;
    expect(currentSet).toBe(originalSet);
  });
});
