import { describe, expect, it } from "vitest";

import {
  instrumentMaxNodeModule,
  MAX_SESSION_ACCESSOR_KEY
} from "./max-node-instrumentation.js";

describe("MAX node instrumentation", () => {
  it("captures a session inside its valid component context", () => {
    const source = [
      "function mount(){",
      "let{viewer:r}=Ni(),value=r.id;",
      "return value",
      "}"
    ].join("");

    const instrumented = instrumentMaxNodeModule(source);

    expect(instrumented).toContain(
      "let __maxbridgeCapturedSession=Ni();"
    );
    expect(instrumented).toContain(
      `globalThis[Symbol.for("${MAX_SESSION_ACCESSOR_KEY}")]=`
    );
    expect(instrumented).toContain(
      "let{viewer:r}=__maxbridgeCapturedSession"
    );
  });

  it("is idempotent and fails closed on an incompatible module", () => {
    const source = "function mount(){let{viewer:x}=Ab();return x}";
    const once = instrumentMaxNodeModule(source);

    expect(instrumentMaxNodeModule(once)).toBe(once);
    expect(() => instrumentMaxNodeModule(
      "export const unrelated=true"
    )).toThrow("MAX session initialization is unavailable");
  });
});
