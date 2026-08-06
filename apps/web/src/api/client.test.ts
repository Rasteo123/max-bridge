import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "./client.js";

describe("ApiClient messenger actions", () => {
  it("sends a reply through the text message route", async () => {
    const { client, fetcher } = apiClient();

    await client.sendText(
      "chat/with space",
      "Ответ",
      "message/?source",
      "request-reply"
    );

    expectJsonRequest(
      fetcher,
      "/api/messages",
      "POST",
      {
        kind: "text",
        chatId: "chat/with space",
        clientRequestId: "request-reply",
        text: "Ответ",
        replyToId: "message/?source"
      }
    );
  });

  it("edits a message through its encoded resource route", async () => {
    const { client, fetcher } = apiClient();

    await client.editMessage(
      "chat/with space",
      "message/?target",
      "Исправлено",
      "request-edit"
    );

    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/messages/message%2F%3Ftarget",
      "PATCH",
      {
        text: "Исправлено",
        clientRequestId: "request-edit"
      }
    );
  });

  it("confirms deletion through the message delete route", async () => {
    const { client, fetcher } = apiClient();

    await client.deleteMessage(
      "chat/with space",
      "message/?target",
      true,
      "request-delete"
    );

    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/messages/" +
        "message%2F%3Ftarget/delete",
      "POST",
      {
        clientRequestId: "request-delete",
        confirmedByUser: true,
        forEveryone: true
      }
    );
  });

  it("forwards only source identifiers and selected destination ids", async () => {
    const { client, fetcher } = apiClient();

    await client.forwardMessage(
      "chat/with space",
      "message/?target",
      ["chat-2", "channel-3"],
      "request-forward"
    );

    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/messages/" +
        "message%2F%3Ftarget/forward",
      "POST",
      {
        destinationIds: ["chat-2", "channel-3"],
        clientRequestId: "request-forward"
      }
    );
  });

  it("sets and removes a reaction through the message reaction route", async () => {
    const { client, fetcher } = apiClient();

    await client.setReaction(
      "chat/with space",
      "message/?target",
      "heart",
      "request-reaction-add"
    );
    await client.setReaction(
      "chat/with space",
      "message/?target",
      null,
      "request-reaction-remove"
    );

    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/messages/" +
        "message%2F%3Ftarget/reaction",
      "PUT",
      {
        reaction: "heart",
        clientRequestId: "request-reaction-add"
      },
      1
    );
    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/messages/" +
        "message%2F%3Ftarget/reaction",
      "PUT",
      {
        reaction: null,
        clientRequestId: "request-reaction-remove"
      },
      2
    );
  });

  it("adds confirmation only to destructive chat actions", async () => {
    const { client, fetcher } = apiClient();

    await client.chatAction("chat/with space", "pin", "request-pin");
    await client.chatAction("chat/with space", "clear", "request-clear");

    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/actions",
      "POST",
      {
        action: "pin",
        clientRequestId: "request-pin"
      },
      1
    );
    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/actions",
      "POST",
      {
        action: "clear",
        clientRequestId: "request-clear",
        confirmedByUser: true
      },
      2
    );
  });

  it("lists and sends stickers through encoded sticker routes", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        stickers: [{
          id: "sticker/#wave",
          previewDataUrl: "data:image/png;base64,AA=="
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(sendResult()));
    const client = new ApiClient(fetcher);

    await expect(client.listStickers("chat/with space")).resolves.toEqual({
      stickers: [{
        id: "sticker/#wave",
        previewDataUrl: "data:image/png;base64,AA=="
      }]
    });
    await client.sendSticker(
      "chat/with space",
      "sticker/#wave",
      "request-sticker"
    );

    expectGetRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/stickers",
      1
    );
    expectJsonRequest(
      fetcher,
      "/api/chats/chat%2Fwith%20space/stickers/sticker%2F%23wave",
      "POST",
      { clientRequestId: "request-sticker" },
      2
    );
  });
});

function apiClient() {
  const fetcher = vi.fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(jsonResponse(sendResult())));
  return {
    client: new ApiClient(fetcher),
    fetcher
  };
}

function expectJsonRequest(
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
  path: string,
  method: string,
  body: Readonly<Record<string, unknown>>,
  call = 1
) {
  const request = fetcher.mock.calls[call - 1];
  expect(request?.[0]).toBe(path);
  expect(request?.[1]).toMatchObject({
    method,
    body: JSON.stringify(body),
    credentials: "include",
    cache: "no-store"
  });
  const init = request?.[1];
  expect(init?.headers).toBeInstanceOf(Headers);
  const headers = new Headers(init?.headers);
  expect(headers.get("accept")).toBe("application/json");
  expect(headers.get("content-type")).toBe("application/json");
}

function expectGetRequest(
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
  path: string,
  call = 1
) {
  const request = fetcher.mock.calls[call - 1];
  expect(request?.[0]).toBe(path);
  expect(request?.[1]).toMatchObject({
    credentials: "include",
    cache: "no-store"
  });
  const init = request?.[1];
  expect(init?.headers).toBeInstanceOf(Headers);
  const headers = new Headers(init?.headers);
  expect(headers.get("accept")).toBe("application/json");
  expect(headers.has("content-type")).toBe(false);
}

function sendResult() {
  return {
    state: "confirmed",
    operationId: "operation-1"
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}
