import helmet from "@fastify/helmet";
import type { FastifyPluginAsync } from "fastify";
import fastifyPlugin from "fastify-plugin";

export type SecurityPluginOptions = Readonly<{
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
}>;

const securityImplementation: FastifyPluginAsync<
  SecurityPluginOptions
> = async (app, options) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: [
          "'self'",
          "https://web.telegram.org",
          "https://*.telegram.org"
        ],
        scriptSrc: [
          "'self'",
          "https://telegram.org",
          "https://*.telegram.org"
        ],
        connectSrc: ["'self'", "wss:"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        formAction: ["'self'"]
      }
    },
    referrerPolicy: {
      policy: "no-referrer"
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!options.allowedHosts.has(request.hostname)) {
      await reply.code(421).send({ code: "host_not_allowed" });
      return;
    }
    const origin = request.headers.origin;
    if (
      origin !== undefined
      && !options.allowedOrigins.has(origin)
    ) {
      await reply.code(403).send({ code: "origin_not_allowed" });
    }
  });
};

export const registerSecurity = fastifyPlugin(
  securityImplementation,
  { name: "maxbridge-security" }
);
