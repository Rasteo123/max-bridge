// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import {
  backHandlerDepth,
  resetBackHandlers,
  runTopBackHandler
} from "./back-navigation.js";
import { CommentsPane } from "./CommentsPane.js";
import { MessageBubble } from "./MessageBubble.js";
import type { MessengerMessage } from "./types.js";

afterEach(() => {
  cleanup();
  resetBackHandlers();
  vi.restoreAllMocks();
});

const post: MessengerMessage = {
  id: "117054722712604690",
  kind: "text",
  text: "Девчонки призывают быть добрее!",
  direction: "incoming",
  sentAt: "2026-08-07T16:35:00.000Z",
  views: 2_014,
  commentCount: 5
};

function comment(
  id: string,
  text: string,
  senderName: string
): MessengerMessage {
  return {
    id,
    kind: "text",
    text,
    direction: "incoming",
    sentAt: "2026-08-07T16:40:00.000Z",
    senderName
  };
}

describe("channel post footer", () => {
  it("shows the view count and opens the comment thread", () => {
    const onOpenComments = vi.fn();
    render(
      <MessageBubble message={post} onOpenComments={onOpenComments} />
    );

    expect(screen.getByLabelText("Просмотров: 2014").textContent)
      .toContain("2,0К");

    fireEvent.click(screen.getByRole("button", {
      name: /5 комментариев/u
    }));
    expect(onOpenComments).toHaveBeenCalledWith(post);
  });

  it("invites a comment when a post has none", () => {
    render(
      <MessageBubble
        message={{ ...post, commentCount: 0 }}
        onOpenComments={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: /Комментировать/u })).toBeTruthy();
  });

  it("leaves the footer out when the post is not a channel post", () => {
    const { commentCount, views, ...plain } = post;
    expect([commentCount, views]).toEqual([5, 2_014]);
    render(<MessageBubble message={plain} onOpenComments={() => undefined} />);

    expect(screen.queryByRole("button", { name: /комментар/u })).toBeNull();
  });
});

describe("comments pane", () => {
  it("lists the comments under the post", () => {
    render(
      <CommentsPane
        post={post}
        comments={[
          comment("c1", "Молодцы!", "Вера Алфёрова"),
          comment("c2", "Красиво", "Татьяна")
        ]}
        loading={false}
        onClose={() => undefined}
      />
    );

    const pane = screen.getByTestId("comments-pane");
    expect(pane.textContent).toContain("Девчонки призывают быть добрее!");
    expect(pane.textContent).toContain("Молодцы!");
    expect(pane.textContent).toContain("Красиво");
  });

  it("closes on the back gesture", async () => {
    const onClose = vi.fn();
    render(
      <CommentsPane
        post={post}
        comments={[]}
        loading={false}
        onClose={onClose}
      />
    );

    expect(backHandlerDepth()).toBe(1);
    await act(async () => {
      runTopBackHandler();
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the profile of whoever wrote a comment", () => {
    const onOpenSender = vi.fn();
    const written = comment("c1", "Молодцы!", "Вера Алфёрова");
    render(
      <CommentsPane
        post={post}
        comments={[written]}
        loading={false}
        onClose={() => undefined}
        onOpenSender={onOpenSender}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Вера Алфёрова" }));
    expect(onOpenSender).toHaveBeenCalledWith(written);
  });

  it("reports an empty thread apart from a failed one", () => {
    const { rerender } = render(
      <CommentsPane
        post={post}
        comments={[]}
        loading={false}
        onClose={() => undefined}
      />
    );
    expect(screen.getByText("Комментариев пока нет")).toBeTruthy();

    rerender(
      <CommentsPane
        post={post}
        comments={[]}
        loading={false}
        failed
        onClose={() => undefined}
      />
    );
    expect(screen.getByText("Не удалось загрузить комментарии")).toBeTruthy();
  });
});
