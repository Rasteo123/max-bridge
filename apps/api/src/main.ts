import type { FastifyInstance } from "fastify";

import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT
} from "./app.js";

export async function listenApi(
  app: FastifyInstance,
  options: Readonly<{
    host?: string;
    port?: number;
  }> = {}
): Promise<string> {
  const host = options.host ?? DEFAULT_API_HOST;
  if (host !== DEFAULT_API_HOST) {
    throw new Error("API must bind to loopback");
  }
  const port = options.port ?? DEFAULT_API_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API port is invalid");
  }
  return app.listen({ host, port });
}
