import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";

export class CredentialError extends Error {
  readonly code = "credential_unavailable";

  constructor(message = "Required credential is unavailable") {
    super(message);
    this.name = "CredentialError";
  }
}

export type CredentialOptions = Readonly<{
  directory?: string;
  enforcePrivateMode?: boolean;
}>;

const CREDENTIAL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export async function loadCredential32(
  name: string,
  options: CredentialOptions = {}
): Promise<Uint8Array> {
  if (!CREDENTIAL_NAME_PATTERN.test(name)) {
    throw new CredentialError();
  }

  const directory = options.directory ?? process.env["CREDENTIALS_DIRECTORY"];
  if (directory === undefined || directory.length === 0) {
    throw new CredentialError();
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new CredentialError();
    }
    if (
      options.enforcePrivateMode !== false
      && (stats.mode & 0o077) !== 0
    ) {
      throw new CredentialError(
        "Credential must use a private file mode"
      );
    }
    if (stats.size !== 32) {
      throw new CredentialError(
        "Credential must contain exactly 32 bytes"
      );
    }
    const value = await handle.readFile();
    if (value.byteLength !== 32) {
      value.fill(0);
      throw new CredentialError(
        "Credential must contain exactly 32 bytes"
      );
    }
    return new Uint8Array(value);
  } catch (error: unknown) {
    if (error instanceof CredentialError) {
      throw error;
    }
    throw new CredentialError();
  } finally {
    await handle?.close();
  }
}
