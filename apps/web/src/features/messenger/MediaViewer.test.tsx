// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { StrictMode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import "../../test-setup.js";
import { mediaGalleryForConversation } from "./Conversation.js";
import {
  MediaViewer,
  type MediaViewerItem
} from "./MediaViewer.js";
import type { MessengerMedia } from "./types.js";

const items: readonly MediaViewerItem[] = [
  {
    id: "image-1",
    kind: "image",
    alt: "Первое изображение",
    media: media("https://i.oneme.ru/first.jpg", "image/jpeg")
  },
  {
    id: "video-1",
    kind: "video",
    alt: "Видео",
    media: media("https://i.oneme.ru/video.mp4", "video/mp4")
  },
  {
    id: "image-2",
    kind: "image",
    alt: "Второе изображение",
    media: media("https://i.oneme.ru/second.jpg", "image/jpeg")
  }
];

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })));
});

describe("MediaViewer", () => {
  it("derives an ordered gallery only from the current in-memory chat", () => {
    const gallery = mediaGalleryForConversation({
      id: "chat-1",
      title: "Чат",
      preview: "",
      timestamp: "",
      unreadCount: 0,
      muted: false,
      kind: "direct"
    }, [
      message("other", "chat-2", "image", {
        handle: "other",
        mimeType: "image/jpeg",
        size: 10
      }),
      message("first", "chat-1", "image", {
        handle: "first",
        mimeType: "image/jpeg",
        size: 10,
        sourceUrl: "https://i.oneme.ru/first.jpg"
      }),
      message("voice", "chat-1", "voice", {
        handle: "voice",
        mimeType: "audio/ogg",
        size: 10
      }),
      message("second", "chat-1", "video", {
        handle: "secure_video",
        mimeType: "video/mp4",
        size: 10
      })
    ]);

    expect(gallery.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("opens an accessible image dialog, zooms, closes, and restores focus", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    render(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={vi.fn()}
        onClose={onClose}
      />
    );

    expect(
      screen.getByRole("dialog", { name: "Просмотр изображения" })
    ).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Увеличить" }));
    expect(screen.getByTestId("media-viewer-image")).toHaveStyle({
      "--media-scale": "1.25"
    });

    const close = screen.getByRole("button", { name: "Закрыть просмотр" });
    const zoomIn = screen.getByRole("button", { name: "Увеличить" });
    zoomIn.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(zoomIn).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    opener.remove();
  });

  it("supports control-wheel, double click, pinch, pan, and reset", () => {
    render(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const image = screen.getByTestId("media-viewer-image");
    fireEvent.wheel(image, {
      deltaY: -100,
      ctrlKey: true
    });
    expect(Number(image.style.getPropertyValue("--media-scale")))
      .toBeGreaterThan(1);

    fireEvent.doubleClick(image);
    expect(image).toHaveStyle({ "--media-scale": "1" });
    fireEvent.doubleClick(image);
    expect(image).toHaveStyle({ "--media-scale": "2" });

    fireEvent.pointerDown(image, pointer(1, 100, 100));
    fireEvent.pointerDown(image, pointer(2, 200, 100, false));
    fireEvent.pointerMove(image, pointer(2, 250, 100, false));
    expect(Number(image.style.getPropertyValue("--media-scale"))).toBe(3);
    fireEvent.pointerUp(image, pointer(2, 250, 100, false));

    fireEvent.pointerMove(image, pointer(1, 130, 100));
    expect(image.style.getPropertyValue("--media-x")).not.toBe("0px");

    fireEvent.click(screen.getByRole("button", { name: "Сбросить масштаб" }));
    expect(image).toHaveStyle({
      "--media-scale": "1",
      "--media-x": "0px",
      "--media-y": "0px"
    });
  });

  it("renders native video controls without the image zoom toolbar", () => {
    render(
      <MediaViewer
        items={items}
        index={1}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const video = screen.getByTestId("media-viewer-video");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    expect(
      screen.queryByRole("button", { name: "Увеличить" })
    ).not.toBeInTheDocument();
  });

  it("keeps Tab and Shift+Tab trapped when native video is focused", () => {
    render(
      <MediaViewer
        items={[items[1] as MediaViewerItem]}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const dialog = screen.getByRole("dialog", { name: "Просмотр видео" });
    const video = screen.getByTestId("media-viewer-video");
    const close = screen.getByRole("button", { name: "Закрыть просмотр" });

    video.focus();
    fireEvent.keyDown(video, { key: "Tab" });
    expect(close).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    video.focus();
    fireEvent.keyDown(video, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("exits Telegram fullscreen only when the opening click owns it", async () => {
    const requestFullscreen = vi.fn();
    const exitFullscreen = vi.fn(() =>
      Promise.reject(new Error("already closed"))
    );
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "",
        themeParams: {},
        ready: vi.fn(),
        expand: vi.fn(),
        isVersionAtLeast: vi.fn(() => true),
        requestFullscreen,
        exitFullscreen
      }
    });
    const view = render(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        telegramFullscreenRequested
      />
    );

    expect(
      screen.getByRole("dialog", { name: "Просмотр изображения" })
    ).toBeVisible();
    expect(requestFullscreen).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => {
      expect(exitFullscreen).toHaveBeenCalledOnce();
    });

    render(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    ).unmount();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("navigates by swipe, arrows, and buttons and announces the position", () => {
    const onIndexChange = vi.fn();
    const { rerender } = render(
      <MediaViewer
        items={items}
        index={1}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />
    );
    const stage = screen.getByTestId("media-viewer-stage");
    mockRect(stage, { width: 320, height: 500 });

    fireEvent.pointerDown(stage, pointer(1, 200, 100));
    fireEvent.pointerMove(stage, pointer(1, 272, 102));
    expect(stage).toHaveStyle({ "--carousel-offset": "72px" });
    fireEvent.pointerUp(stage, pointer(1, 272, 102));
    expect(onIndexChange).toHaveBeenLastCalledWith(0);

    rerender(
      <MediaViewer
        items={items}
        index={1}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />
    );
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Предыдущее медиа" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole("status")).toHaveTextContent("2 из 3");
  });

  it("reserves the lower 64 pixels of video for native controls", () => {
    const onIndexChange = vi.fn();
    render(
      <MediaViewer
        items={items}
        index={1}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />
    );
    const video = screen.getByTestId("media-viewer-video");
    mockRect(video, { top: 50, left: 20, width: 280, height: 300 });

    fireEvent.pointerDown(video, pointer(1, 200, 330));
    fireEvent.pointerMove(video, pointer(1, 100, 330));
    fireEvent.pointerUp(video, pointer(1, 100, 330));
    expect(onIndexChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(video, pointer(2, 200, 100));
    fireEvent.pointerMove(video, pointer(2, 100, 100));
    fireEvent.pointerUp(video, pointer(2, 100, 100));
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("gives horizontal movement to a zoomed image and restores the gallery at 1x", () => {
    const onIndexChange = vi.fn();
    render(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />
    );
    const stage = screen.getByTestId("media-viewer-stage");
    fireEvent.click(screen.getByRole("button", { name: "Увеличить" }));
    fireEvent.pointerDown(stage, pointer(1, 200, 100));
    fireEvent.pointerMove(stage, pointer(1, 100, 100));
    fireEvent.pointerUp(stage, pointer(1, 100, 100));
    expect(onIndexChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Сбросить масштаб" }));
    fireEvent.pointerDown(stage, pointer(2, 200, 100));
    fireEvent.pointerMove(stage, pointer(2, 100, 100));
    fireEvent.pointerUp(stage, pointer(2, 100, 100));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("pauses the old video, resets transforms, and preloads images only", () => {
    const imageSources: string[] = [];
    class TestImage {
      set src(value: string) {
        imageSources.push(value);
      }
    }
    vi.stubGlobal("Image", TestImage);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const { rerender } = render(
      <MediaViewer
        items={items}
        index={1}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(imageSources).toContain("https://i.oneme.ru/first.jpg");
    expect(imageSources).toContain("https://i.oneme.ru/second.jpg");
    expect(imageSources).not.toContain("https://i.oneme.ru/video.mp4");

    rerender(
      <MediaViewer
        items={items}
        index={2}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(pause).toHaveBeenCalled();
    const image = screen.getByTestId("media-viewer-image");
    expect(image).toHaveStyle({ "--media-scale": "1" });
    fireEvent.click(screen.getByRole("button", { name: "Увеличить" }));
    expect(image).toHaveStyle({ "--media-scale": "1.25" });
    rerender(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId("media-viewer-image")).toHaveStyle({
      "--media-scale": "1"
    });
  });

  it("keeps handle-only adjacent images authenticated until close", async () => {
    const createObjectURL = vi.fn(() => "blob:adjacent");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      new Blob(["image"], { type: "image/jpeg" }),
      { status: 200, headers: { "content-type": "image/jpeg" } }
    )));
    vi.stubGlobal("fetch", fetchMock);

    const withHandle: readonly MediaViewerItem[] = [
      {
        id: "image-1",
        kind: "image",
        alt: "Первое изображение",
        media: media("https://i.oneme.ru/first.jpg", "image/jpeg")
      },
      {
        id: "handle-image",
        kind: "image",
        alt: "Изображение по handle",
        media: {
          handle: "secure_handle",
          mimeType: "image/jpeg",
          size: 64
        }
      }
    ];
    const view = render(
      <MediaViewer
        items={withHandle}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/media/secure_handle",
        expect.objectContaining({
          credentials: "include",
          cache: "no-store"
        })
      );
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:adjacent");
  });

  it("survives StrictMode effect replay for handle-only current media", async () => {
    let objectUrlNumber = 0;
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => {
        objectUrlNumber += 1;
        const url = `blob:strict-${String(objectUrlNumber)}`;
        createdUrls.push(url);
        return url;
      })
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn((url: string) => {
        revokedUrls.push(url);
      })
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      new Blob(["image"], { type: "image/jpeg" }),
      { status: 200, headers: { "content-type": "image/jpeg" } }
    )));
    vi.stubGlobal("fetch", fetchMock);
    const strictItems: readonly MediaViewerItem[] = [{
      id: "strict-image",
      kind: "image",
      alt: "StrictMode изображение",
      media: {
        handle: "strict_handle",
        mimeType: "image/jpeg",
        size: 64
      }
    }];

    const view = render(
      <StrictMode>
        <MediaViewer
          items={strictItems}
          index={0}
          onIndexChange={vi.fn()}
          onClose={vi.fn()}
        />
      </StrictMode>
    );

    expect(await screen.findByTestId("media-viewer-image")).toHaveAttribute(
      "src",
      expect.stringMatching(/^blob:strict-/u)
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Загрузка…")).not.toBeInTheDocument();

    view.unmount();
    await waitFor(() => {
      expect(revokedUrls).toEqual(expect.arrayContaining(createdUrls));
    });
  });

  it("removes carousel motion when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })));
    render(
      <MediaViewer
        items={items}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId("media-viewer-stage"))
      .toHaveAttribute("data-reduced-motion", "true");
  });
});

function media(sourceUrl: string, mimeType: string) {
  return {
    handle: "unused",
    mimeType,
    size: 1_024,
    sourceUrl
  };
}

function message(
  id: string,
  chatId: string,
  kind: "image" | "video" | "voice",
  messageMedia: MessengerMedia
) {
  return {
    id,
    chatId,
    kind,
    text: "",
    direction: "incoming" as const,
    sentAt: "2026-07-27T00:00:00.000Z",
    media: messageMedia
  };
}

function pointer(
  pointerId: number,
  clientX: number,
  clientY: number,
  isPrimary = true
) {
  return {
    pointerId,
    clientX,
    clientY,
    button: 0,
    isPrimary,
    pointerType: "touch"
  };
}

function mockRect(
  element: Element,
  rect: Partial<DOMRect> & Pick<DOMRect, "width" | "height">
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: (rect.left ?? 0) + rect.width,
    bottom: (rect.top ?? 0) + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({})
  });
}

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "touch";
    this.isPrimary = init.isPrimary ?? true;
  }
}
