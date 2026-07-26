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

export const registerPublicErrors = fastifyPlugin(
  publicErrorsImplementation,
  { name: "maxbridge-public-errors" }
);
