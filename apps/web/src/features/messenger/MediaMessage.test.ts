// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import {
  MediaMessage,
  mediaPath,
  safeMaxMediaUrl
} from "./MediaMessage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("opens image and video thumbnails without starting message swipes", async () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      createElement(MediaMessage, {
        kind: "image",
        media: {
          handle: "image-1",
          mimeType: "image/jpeg",
          size: 128,
          sourceUrl: "https://i.oneme.ru/image.jpg"
        },
        onOpen
      })
    );
    const imageButton = await screen.findByRole("button", {
      name: "Открыть изображение"
    });
    expect(imageButton).toHaveAttribute("data-no-swipe");
    fireEvent.click(imageButton);
    expect(onOpen).toHaveBeenCalledWith({
      kind: "image",
      url: "https://i.oneme.ru/image.jpg",
      alt: "Изображение"
    });

    rerender(
      createElement(MediaMessage, {
        kind: "video",
        media: {
          handle: "video-1",
          mimeType: "video/mp4",
          size: 128,
          sourceUrl: "https://i.oneme.ru/video.mp4"
        },
        onOpen
      })
    );
    expect(await screen.findByRole("button", { name: "Открыть видео" }))
      .toHaveAttribute("data-no-swipe");
    expect(document.querySelector("video")).toBeInTheDocument();
    expect(document.querySelector("video")).not.toHaveAttribute("controls");
  });

  it("validates MIME and size when resolving a handle thumbnail", async () => {
    const createObjectURL = vi.fn(() => "blob:thumbnail");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      new Blob(["image"], { type: "image/jpeg" }),
      { status: 200, headers: { "content-type": "image/jpeg" } }
    ))));
    const view = render(
      createElement(MediaMessage, {
        kind: "image",
        media: {
          handle: "image_handle",
          mimeType: "image/jpeg",
          size: 64
        }
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "blob:thumbnail"
      );
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/media/image_handle",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        headers: { accept: "image/jpeg" }
      })
    );
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail");
  });

  it("rejects a handle response with a mismatched MIME type", async () => {
    const createObjectURL = vi.fn(() => "blob:wrong");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      new Blob(["image"], { type: "image/png" }),
      { status: 200, headers: { "content-type": "image/png" } }
    ))));

    render(
      createElement(MediaMessage, {
        kind: "image",
        media: {
          handle: "image_handle",
          mimeType: "image/jpeg",
          size: 64
        }
      })
    );

    expect(await screen.findByText("Медиа недоступно")).toBeVisible();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
