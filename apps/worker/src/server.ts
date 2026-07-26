import { chmod, rm } from "node:fs/promises";
import {
  createServer,
  type Server,
  type Socket
} from "node:net";

import {
  FrameDecoder,
  encodeFrame,
  parseWorkerMessage,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerEvent
} from "@maxbridge/protocol";

export type WorkerRequestHandler = (
  request: WorkerRequest
) => Promise<WorkerResponse>;

export type WorkerProtocolServerOptions = Readonly<{
  socketPath: string;
  handler: WorkerRequestHandler;
  maxFrameBytes?: number;
}>;

export class WorkerProtocolServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: WorkerProtocolServerOptions) {}

  async start(): Promise<void> {
    if (this.server !== undefined) {
      return;
    }
    await rm(this.options.socketPath, { force: true });
    const server = createServer((socket) => {
      this.sockets.add(socket);
      const decoder = new FrameDecoder(this.options.maxFrameBytes);
      socket.on("data", (chunk) => {
        if (typeof chunk === "string") {
          socket.destroy();
          return;
        }
        void this.handleChunk(socket, decoder, chunk);
      });
      socket.once("close", () => {
        this.sockets.delete(socket);
      });
      socket.once("error", () => {
        socket.destroy();
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(this.options.socketPath, 0o600);
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
    await rm(this.options.socketPath, { force: true });
  }

  broadcast(event: WorkerEvent): void {
    const frame = encodeFrame(parseWorkerMessage(event));
    for (const socket of this.sockets) {
      if (!socket.destroyed) {
        socket.write(frame);
      }
    }
  }

  private async handleChunk(
    socket: Socket,
    decoder: FrameDecoder,
    chunk: Uint8Array
  ): Promise<void> {
    try {
      for (const value of decoder.push(chunk)) {
        const message = parseWorkerMessage(value);
        if (message.kind !== "request") {
          socket.destroy();
          return;
        }
        let response: WorkerResponse;
        try {
          response = await this.options.handler(message);
          if (response.requestId !== message.requestId) {
            throw new Error("correlation mismatch");
          }
        } catch {
          response = {
            kind: "response",
            requestId: message.requestId,
            ok: false,
            errorCode: "worker_failure"
          };
        }
        socket.write(encodeFrame(parseWorkerMessage(response)));
      }
    } catch {
      socket.destroy();
    }
  }
}
