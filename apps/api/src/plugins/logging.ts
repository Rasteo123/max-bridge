import type { FastifyServerOptions } from "fastify";

export function secureLoggerOptions(): FastifyServerOptions["logger"] {
  return {
    level: "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "req.body",
        "response.body",
        "*.botToken",
        "*.masterKey"
      ],
      censor: "[REDACTED]"
    },
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          ...(request.headers.host === undefined
            ? {}
            : { host: request.headers.host }),
          remoteAddress: request.ip
        };
      }
    }
  };
}
