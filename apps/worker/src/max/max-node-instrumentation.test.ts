import { describe, expect, it } from "vitest";

import {
  instrumentMaxNodeModule,
  MAX_SESSION_ACCESSOR_KEY
} from "./max-node-instrumentation.js";

describe("MAX node instrumentation", () => {
  it("captures a session inside its valid component context", () => {
    const source = [
      "function optionalDialog(){",
      "let{viewer:x}=Ni(),value=x.id;",
      "return value",
      "}",
      "function root(){",
      "let{viewer:r,calls:c}=Ni(),title=r.id;",
      "return title",
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
      "let{viewer:r,calls:c}=__maxbridgeCapturedSession"
    );
    expect(instrumented).toContain("let{viewer:x}=Ni()");
  });

  it("is idempotent and fails closed on an incompatible module", () => {
    const source = [
      "function root(){",
      "let{viewer:x,calls:y}=Ab();",
      "return x",
      "}"
    ].join("");
    const once = instrumentMaxNodeModule(source);

    expect(instrumentMaxNodeModule(once)).toBe(once);
    expect(() => instrumentMaxNodeModule(
      "export const unrelated=true"
    )).toThrow("MAX session initialization is unavailable");
  });
});
