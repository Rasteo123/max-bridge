export const MAX_SESSION_ACCESSOR_KEY =
  "maxbridge.max-session-accessor.v1";

const CAPTURE_VARIABLE = "__maxbridgeCapturedSession";
const SESSION_PATTERN =
  /let\{viewer:([A-Za-z_$][\w$]*)\}=([A-Za-z_$][\w$]*)\(\)/u;

export function instrumentMaxNodeModule(source: string): string {
  if (source.length < 1 || source.length > 4 * 1024 * 1024) {
    throw new Error("MAX node module has an invalid size");
  }
  if (
    source.includes(CAPTURE_VARIABLE)
    || source.includes(MAX_SESSION_ACCESSOR_KEY)
  ) {
    return source;
  }
  const match = SESSION_PATTERN.exec(source);
  const viewerLocal = match?.[1];
  const sessionLocal = match?.[2];
  if (viewerLocal === undefined || sessionLocal === undefined) {
    throw new Error("MAX session initialization is unavailable");
  }
  const replacement = [
    `let ${CAPTURE_VARIABLE}=${sessionLocal}();`,
    `globalThis[Symbol.for("${MAX_SESSION_ACCESSOR_KEY}")]=`,
    `()=>${CAPTURE_VARIABLE};`,
    `let{viewer:${viewerLocal}}=${CAPTURE_VARIABLE}`
  ].join("");
  return source.replace(SESSION_PATTERN, replacement);
}
