// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../../test-setup.js";
import { RichMessageText } from "./RichMessageText.js";

afterEach(() => {
  cleanup();
});

describe("RichMessageText", () => {
  it("uses code-point ranges so emoji before a link does not shift it", () => {
    render(
      <p>
        <RichMessageText
          text="Доброе утро 🌻 открыть"
          links={[{
            offset: 14,
            length: 7,
            url: "https://max.ru/channel/synthetic"
          }]}
        />
      </p>
    );

    const link = screen.getByRole("link", { name: "открыть" });
    expect(link).toHaveAttribute(
      "href",
      "https://max.ru/channel/synthetic"
    );
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(screen.getByText("Доброе утро 🌻", { exact: false })).toBeVisible();
  });

  it.each([
    {
      offset: 100,
      length: 2,
      url: "https://max.ru/channel/synthetic"
    },
    {
      offset: 0,
      length: 6,
      url: "javascript:alert(1)"
    },
    {
      offset: 0,
      length: 6,
      url: "https://user:password@example.test/private"
    }
  ])("falls back to plain text for malformed links", (link) => {
    render(
      <p>
        <RichMessageText text="Ссылка" links={[link]} />
      </p>
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Ссылка")).toBeVisible();
  });
});
