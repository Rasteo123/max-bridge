import { describe, expect, it } from "vitest";

import {
  MaxClientBindingError,
  discoverMaxClientBindings
} from "./client-bindings.js";

describe("discoverMaxClientBindings", () => {
  it("finds the session accessor and router without fixed minified names", () => {
    const source = [
      'import{mn as Ab,Sn as Cd,zz as Ef}from"../chunks/domain.X.js";',
      "function list(){let{viewer:x}=Ab();return x.folders.all.chats}",
      "function open(id){return Cd.openChat(id)}"
    ].join("");

    expect(discoverMaxClientBindings(
      source,
      "https://web.max.ru/_app/immutable/nodes/0.A.js"
    )).toEqual({
      moduleUrl: "https://web.max.ru/_app/immutable/chunks/domain.X.js",
      sessionExport: "mn",
      routerExport: "Sn"
    });
  });

  it("fails closed when the public client structure changes", () => {
    expect(() => discoverMaxClientBindings(
      "export const unrelated = true;",
      "https://web.max.ru/_app/immutable/nodes/0.A.js"
    )).toThrow(MaxClientBindingError);
  });
});
