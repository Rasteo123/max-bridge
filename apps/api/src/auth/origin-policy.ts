export class OriginPolicyError extends Error {
  readonly code = "origin_not_allowed";

  constructor() {
    super("Request origin is not allowed");
    this.name = "OriginPolicyError";
  }
}

export function assertAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>
): void {
  if (origin === undefined || !allowedOrigins.has(origin)) {
    throw new OriginPolicyError();
  }
}
