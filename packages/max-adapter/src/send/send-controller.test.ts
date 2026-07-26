import { describe, expect, it } from "vitest";

import {
  MaxSendTransportError,
  SendController,
  type MaxSendCommand,
  type MaxSendTransport
} from "./send-controller.js";

describe("MAX send controller", () => {
  it("confirms a text send exactly once for the same client request", async () => {
    const transport = new FakeSendTransport();
    const ids = idFactory("op-1");
    const controller = new SendController({ transport, operationId: ids });
    const input = {
      clientRequestId: "client-1",
      chatId: "1001",
      text: "Синтетическое сообщение"
    };

    const first = await controller.sendText(input);
    const duplicate = await controller.sendText(input);

    expect(first).toEqual({
      state: "confirmed",
      operationId: "op-1",
      messageId: "server-message-1"
    });
    expect(duplicate).toEqual(first);
    expect(transport.commands).toHaveLength(1);
    expect(transport.commands[0]).toMatchObject({
      opcode: 64,
      payload: {
        chatId: "1001",
        message: {
          text: "Синтетическое сообщение",
          cid: "op-1"
        }
      }
    });
  });

  it("retries once only when the request was not written", async () => {
    const transport = new FakeSendTransport();
    transport.failures.push("before_write");
    const controller = new SendController({
      transport,
      operationId: idFactory("op-safe")
    });

    const result = await controller.sendText({
      clientRequestId: "client-safe",
      chatId: "1001",
      text: "Безопасный повтор"
    });

    expect(result.state).toBe("confirmed");
    expect(transport.commands).toHaveLength(2);
    expect(transport.commands[0]).toEqual(transport.commands[1]);
  });

  it.each([
    "after_write",
    "before_confirmation"
  ] as const)("marks %s failure ambiguous and does not retry", async (phase) => {
    const transport = new FakeSendTransport();
    transport.failures.push(phase);
    const controller = new SendController({
      transport,
      operationId: idFactory("op-ambiguous")
    });

    const result = await controller.sendText({
      clientRequestId: "client-ambiguous",
      chatId: "1001",
      text: "Не повторять автоматически"
    });

    expect(result).toEqual({
      state: "ambiguous",
      operationId: "op-ambiguous"
    });
    expect(transport.commands).toHaveLength(1);
  });

  it("creates a new operation only after explicit retry confirmation", async () => {
    const transport = new FakeSendTransport();
    transport.failures.push("after_write");
    const controller = new SendController({
      transport,
      operationId: idFactory("op-old", "op-new")
    });
    await controller.sendText({
      clientRequestId: "client-old",
      chatId: "1001",
      text: "Первый текст"
    });

    await expect(controller.retryText({
      retryOf: "client-old",
      clientRequestId: "client-new",
      chatId: "1001",
      text: "Повторный текст",
      confirmedByUser: false
    })).rejects.toMatchObject({ code: "retry_confirmation_required" });
    const result = await controller.retryText({
      retryOf: "client-old",
      clientRequestId: "client-new",
      chatId: "1001",
      text: "Повторный текст",
      confirmedByUser: true
    });

    expect(result).toMatchObject({
      state: "confirmed",
      operationId: "op-new"
    });
    expect(transport.commands).toHaveLength(2);
  });

  it("uses public bounded errors without message text", async () => {
    const controller = new SendController({
      transport: new FakeSendTransport(),
      operationId: idFactory("unused")
    });
    const secret = "PRIVATE_MESSAGE_CANARY";

    await expect(controller.sendText({
      clientRequestId: "bad",
      chatId: "1001",
      text: ""
    })).rejects.toMatchObject({
      code: "invalid_message",
      message: "Message could not be sent"
    });
    try {
      await controller.sendText({
        clientRequestId: "bad-2",
        chatId: "1001",
        text: secret.repeat(70_000)
      });
    } catch (error: unknown) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("sends only bounded prepared media with MIME matching its kind", async () => {
    const transport = new FakeSendTransport();
    const controller = new SendController({
      transport,
      operationId: idFactory("op-media", "op-invalid")
    });

    const result = await controller.sendMedia({
      clientRequestId: "client-media",
      chatId: "1001",
      text: "Синтетическая подпись",
      media: {
        kind: "image",
        token: "SYNTHETIC_UPLOAD_TOKEN",
        mimeType: "image/png",
        size: 1024
      }
    });

    expect(result.state).toBe("confirmed");
    expect(transport.commands[0]).toMatchObject({
      payload: {
        message: {
          attaches: [{
            _type: "PHOTO",
            photoToken: "SYNTHETIC_UPLOAD_TOKEN"
          }]
        }
      }
    });
    await expect(controller.sendMedia({
      clientRequestId: "client-invalid-media",
      chatId: "1001",
      media: {
        kind: "image",
        token: "TOKEN",
        mimeType: "video/mp4",
        size: 1024
      }
    })).rejects.toMatchObject({ code: "invalid_message" });
  });
});

class FakeSendTransport implements MaxSendTransport {
  readonly commands: MaxSendCommand[] = [];
  readonly failures: MaxSendTransportError["phase"][] = [];

  send(command: MaxSendCommand): Promise<Readonly<{ messageId: string }>> {
    this.commands.push(command);
    const failure = this.failures.shift();
    if (failure !== undefined) {
      return Promise.reject(new MaxSendTransportError(failure));
    }
    return Promise.resolve({ messageId: "server-message-1" });
  }
}

function idFactory(...ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = ids[index];
    index += 1;
    if (value === undefined) {
      throw new Error("Synthetic operation ID exhausted");
    }
    return value;
  };
}
