import type { FastifyPluginCallback } from "fastify";
import fastifyPlugin from "fastify-plugin";

const publicErrorsImplementation: FastifyPluginCallback = (
  app,
  _options,
  done
) => {
  app.setErrorHandler(async (error, request, reply) => {
    const record = error !== null && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
    const tooLarge =
      record["code"] === "FST_ERR_CTP_BODY_TOO_LARGE";
    const validation = record["validation"] !== undefined;
    const errorStatus = typeof record["statusCode"] === "number"
      ? record["statusCode"]
      : undefined;
    const statusCode = tooLarge
      ? 413
      : validation
        ? 400
        : errorStatus !== undefined
          && errorStatus >= 400
          && errorStatus < 500
          ? errorStatus
          : 500;
    if (statusCode >= 500) {
      // The reply stays opaque, but a fault the operator cannot see is a
      // fault nobody can fix. Only the error itself is recorded — never the
      // request body, which carries user content.
      request.log.error({
        correlationId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        name: text(record["name"]),
        message: text(record["message"]),
        stack: text(record["stack"])?.split("\n").slice(0, 8).join(" | ")
      }, "request failed");
    }
    await reply.code(statusCode).send({
      code: tooLarge
        ? "request_too_large"
        : validation
          ? "invalid_request"
          : statusCode === 404
            ? "not_found"
            : "request_failed",
      correlationId: request.id
    });
  });

  app.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send({
      code: "not_found",
      correlationId: request.id
    });
  });
  done();
};

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const registerPublicErrors = fastifyPlugin(
  publicErrorsImplementation,
  { name: "maxbridge-public-errors" }
);
