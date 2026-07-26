import type { FastifyPluginCallback } from "fastify";

export type HealthRouteOptions = Readonly<{
  ready: () => boolean;
}>;

export const registerHealthRoutes: FastifyPluginCallback<
  HealthRouteOptions
> = (app, options, done) => {
  app.get("/health/live", async (_request, reply) => {
    await reply.send({ status: "ok" });
  });
  app.get("/health/ready", async (_request, reply) => {
    if (!options.ready()) {
      await reply.code(503).send({ status: "unavailable" });
      return;
    }
    await reply.send({ status: "ready" });
  });
  done();
};
