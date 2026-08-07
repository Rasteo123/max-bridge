import type { Readable } from "node:stream";

import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type { SessionPrincipal } from "../auth/session-store.js";

export type MediaDownload = Readonly<{
  stream: Readable;
  mimeType: string;
  fileName: string;
  size: number;
  expiresAt: number;
}>;

export interface MediaGateway {
  open(
    userLookup: string,
    handle: string
  ): Promise<MediaDownload | null>;
}

export type MediaRouteOptions = Readonly<{
  gateway: MediaGateway;
  resolvePrincipal(request: FastifyRequest): SessionPrincipal | null;
  now?: () => number;
}>;

export const registerMediaRoutes: FastifyPluginCallback<
  MediaRouteOptions
> = (app, options, done) => {
  app.get<{
    Params: { handle: string };
    Querystring: { download?: "1" };
  }>("/api/media/:handle", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["handle"],
        properties: {
          handle: {
            type: "string",
            minLength: 1,
            maxLength: 512,
            pattern: "^[A-Za-z0-9_-]+$"
          }
        }
      },
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { download: { type: "string", enum: ["1"] } }
      }
    }
  }, async (request, reply) => {
    const principal = options.resolvePrincipal(request);
    if (principal === null) {
      await reply.code(401).send({ code: "authentication_required" });
      return;
    }
    const media = await options.gateway.open(
      principal.userLookup,
      request.params.handle
    );
    const now = options.now?.() ?? Date.now();
    if (media === null || media.expiresAt <= now) {
      media?.stream.destroy();
      await reply.code(404).send({ code: "media_not_found" });
      return;
    }
    await sendMedia(reply, media, request.query.download === "1");
  });
  done();
};

async function sendMedia(
  reply: FastifyReply,
  media: MediaDownload,
  forceDownload = false
): Promise<void> {
  // A photo is shown in place, but the viewer can still ask to keep it, and
  // then the browser needs to be told to save rather than render.
  const disposition = !forceDownload && isInlineMime(media.mimeType)
    ? "inline"
    : "attachment";
  await reply
    .header("cache-control", "private, no-store, max-age=0")
    .header("content-security-policy", "sandbox")
    .header("x-content-type-options", "nosniff")
    .header("content-length", String(media.size))
    .header(
      "content-disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(
        normalizedFileName(media.fileName)
      )}`
    )
    .type(media.mimeType)
    .send(media.stream);
}

function isInlineMime(mimeType: string): boolean {
  return mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/");
}

function normalizedFileName(value: string): string {
  const normalized = value.normalize("NFKC");
  let safe = "";
  for (let index = 0; index < normalized.length && safe.length < 180; index += 1) {
    const character = normalized[index] ?? "";
    const code = normalized.charCodeAt(index);
    safe += code < 32 || code === 127 ||
      character === "/" || character === "\\" ? "_" : character;
  }
  return safe.length === 0 ? "media" : safe;
}
