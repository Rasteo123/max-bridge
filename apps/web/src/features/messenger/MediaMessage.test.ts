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
  downloadUrl,
  formatBytes,
  MediaMessage,
  mediaPath,
  safeMaxMediaUrl,
  type MediaOpenInput
} from "./MediaMessage.js";
import { requestTelegramMediaFullscreen } from "../auth/telegram.js";

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
      alt: "Изображение",
      telegramFullscreenLease: null
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

  it("ignores and revokes a handle result that arrives after media changes", async () => {
    const response = deferred<Response>();
    const createObjectURL = vi.fn(() => "blob:stale-thumbnail");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const view = render(
      createElement(MediaMessage, {
        kind: "image",
        media: {
          handle: "old_handle",
          mimeType: "image/jpeg",
          size: 64
        }
      })
    );

    view.rerender(
      createElement(MediaMessage, {
        kind: "image",
        media: {
          handle: "new-direct",
          mimeType: "image/jpeg",
          size: 64,
          sourceUrl: "https://i.oneme.ru/new.jpg"
        }
      })
    );
    response.resolve(new Response(
      new Blob(["image"], { type: "image/jpeg" }),
      { status: 200, headers: { "content-type": "image/jpeg" } }
    ));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:stale-thumbnail"
      );
    });
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://i.oneme.ru/new.jpg"
    );
  });

  it("revokes a handle result that arrives after unmount exactly once", async () => {
    const response = deferred<Response>();
    const createObjectURL = vi.fn(() => "blob:unmounted-thumbnail");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    vi.stubGlobal("fetch", vi.fn(() => response.promise));
    const view = render(
      createElement(MediaMessage, {
        kind: "image",
        media: {
          handle: "unmounted_handle",
          mimeType: "image/jpeg",
          size: 64
        }
      })
    );

    view.unmount();
    response.resolve(new Response(
      new Blob(["image"], { type: "image/jpeg" }),
      { status: 200, headers: { "content-type": "image/jpeg" } }
    ));

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:unmounted-thumbnail"
      );
    });
  });

  it("rejects a handle response of an entirely different kind", async () => {
    const createObjectURL = vi.fn(() => "blob:wrong");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      new Blob(["<html>"], { type: "text/html" }),
      { status: 200, headers: { "content-type": "text/html" } }
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

  // MAX stores whichever subtype it likes and states no size for a video, so
  // neither can be demanded of the response.
  it("accepts another subtype of the same kind", async () => {
    const createObjectURL = vi.fn(() => "blob:ok");
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

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledOnce();
    });
  });

  it("accepts a video whose size MAX never stated", async () => {
    const createObjectURL = vi.fn(() => "blob:video");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      new Blob(["x".repeat(200_000)], { type: "video/mp4" }),
      { status: 200, headers: { "content-type": "video/mp4" } }
    ))));

    render(
      createElement(MediaMessage, {
        kind: "video",
        media: {
          handle: "video_handle",
          mimeType: "video/mp4",
          size: 0
        }
      })
    );

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledOnce();
    });
  });

  it("requests Telegram fullscreen synchronously only from a supported click", async () => {
    const requestFullscreen = vi.fn();
    const onOpen = vi.fn((input: MediaOpenInput) => {
      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(input.kind).toBe("image");
    });
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "",
        themeParams: {},
        ready: vi.fn(),
        expand: vi.fn(),
        isFullscreen: false,
        isVersionAtLeast: vi.fn(() => true),
        requestFullscreen
      }
    });
    render(
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

    fireEvent.click(await screen.findByRole("button", {
      name: "Открыть изображение"
    }));
    expect(onOpen).toHaveBeenCalledOnce();
    const input = onOpen.mock.calls[0]?.[0];
    expect(input?.telegramFullscreenLease).not.toBeNull();
    expect(typeof input?.telegramFullscreenLease?.release).toBe("function");
  });

  it("releases async Telegram fullscreen after a quick close", async () => {
    const request = deferred<undefined>();
    const exitFullscreen = vi.fn();
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "",
        themeParams: {},
        ready: vi.fn(),
        expand: vi.fn(),
        isFullscreen: false,
        isVersionAtLeast: vi.fn(() => true),
        requestFullscreen: vi.fn(() => request.promise),
        exitFullscreen
      }
    });

    const lease = requestTelegramMediaFullscreen();
    expect(lease).not.toBeNull();
    lease?.release();
    lease?.release();
    expect(exitFullscreen).not.toHaveBeenCalled();

    request.resolve(undefined);
    await waitFor(() => {
      expect(exitFullscreen).toHaveBeenCalledOnce();
    });
  });

  it("exits a synchronous fullscreen lease and ignores a rejected request", async () => {
    const exitFullscreen = vi.fn();
    const requestFullscreen = vi.fn<() => undefined | Promise<undefined>>(
      () => undefined
    );
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "",
        themeParams: {},
        ready: vi.fn(),
        expand: vi.fn(),
        isFullscreen: false,
        isVersionAtLeast: vi.fn(() => true),
        requestFullscreen,
        exitFullscreen
      }
    });

    const synchronousLease = requestTelegramMediaFullscreen();
    synchronousLease?.release();
    synchronousLease?.release();
    expect(exitFullscreen).toHaveBeenCalledOnce();

    const rejected = deferred<undefined>();
    requestFullscreen.mockImplementation(() => rejected.promise);
    const rejectedLease = requestTelegramMediaFullscreen();
    rejectedLease?.release();
    rejected.reject(new Error("denied"));
    await rejected.promise.catch(() => undefined);
    await Promise.resolve();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("does not request fullscreen without a positive version capability", async () => {
    const requestFullscreen = vi.fn();
    const onOpen = vi.fn();
    const renderButton = async (
      isVersionAtLeast?: (version: string) => boolean,
      isFullscreen = false
    ) => {
      vi.stubGlobal("Telegram", {
        WebApp: {
          initData: "",
          themeParams: {},
          ready: vi.fn(),
          expand: vi.fn(),
          requestFullscreen,
          isFullscreen,
          ...(isVersionAtLeast === undefined ? {} : { isVersionAtLeast })
        }
      });
      const view = render(
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
      fireEvent.click(await screen.findByRole("button", {
        name: "Открыть изображение"
      }));
      view.unmount();
    };

    await renderButton();
    await renderButton(() => false);
    await renderButton(() => true, true);
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenNthCalledWith(1, expect.objectContaining({
      telegramFullscreenLease: null
    }));
    expect(onOpen).toHaveBeenNthCalledWith(2, expect.objectContaining({
      telegramFullscreenLease: null
    }));
    expect(onOpen).toHaveBeenNthCalledWith(3, expect.objectContaining({
      telegramFullscreenLease: null
    }));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("file downloads", () => {
  it("addresses the route so the response saves rather than renders", () => {
    expect(downloadUrl({
      handle: "media_abc",
      mimeType: "application/zip",
      size: 500_160
    })).toBe("/api/media/media_abc?download=1");
  });

  it("keeps a direct MAX address when MAX gave one", () => {
    expect(downloadUrl({
      handle: "media_abc",
      mimeType: "image/jpeg",
      size: 1_024,
      sourceUrl: "https://i.oneme.ru/i?id=synthetic"
    })).toBe("https://i.oneme.ru/i?id=synthetic");
  });

  it("refuses a handle that is not a handle", () => {
    expect(downloadUrl({
      handle: "../../etc/passwd",
      mimeType: "application/zip",
      size: 1
    })).toBeNull();
  });

  it("ignores a source address outside the MAX hosts", () => {
    expect(downloadUrl({
      handle: "media_abc",
      mimeType: "image/jpeg",
      size: 1_024,
      sourceUrl: "https://attacker.invalid/payload"
    })).toBe("/api/media/media_abc?download=1");
  });

  it("states the size the way MAX does", () => {
    expect(formatBytes(35)).toBe("35 Б");
    expect(formatBytes(500_160)).toBe("488,4 КБ");
    expect(formatBytes(3_093_299)).toBe("2,9 МБ");
  });
});
