import sodium from "libsodium-wrappers-sumo";

import {
  CryptoConfigurationError,
  CryptoIntegrityError
} from "./errors.js";

const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const encoder = new TextEncoder();

export type CipherEnvelopeV1 = Readonly<{
  version: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
}>;

export type EncryptRecordOptions = Readonly<{
  key: Uint8Array;
  keyId: string;
  recordType: string;
  userLookup: string;
  plaintext: Uint8Array;
}>;

export type DecryptRecordOptions = Readonly<{
  key: Uint8Array;
  envelope: CipherEnvelopeV1;
  recordType: string;
  userLookup: string;
}>;

export async function generateKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(KEY_BYTES);
}

export async function encryptRecord(
  options: EncryptRecordOptions
): Promise<CipherEnvelopeV1> {
  await sodium.ready;
  assertKey(options.key);
  assertContextPart("keyId", options.keyId);
  const aad = createAad(options.recordType, options.userLookup);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    options.plaintext,
    aad,
    null,
    nonce,
    options.key
  );

  return {
    version: 1,
    keyId: options.keyId,
    nonce: sodium.to_base64(
      nonce,
      sodium.base64_variants.URLSAFE_NO_PADDING
    ),
    ciphertext: sodium.to_base64(
      ciphertext,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
  };
}

export async function decryptRecord(
  options: DecryptRecordOptions
): Promise<Uint8Array> {
  await sodium.ready;
  assertKey(options.key);
  assertEnvelope(options.envelope);
  const aad = createAad(options.recordType, options.userLookup);

  try {
    const nonce = sodium.from_base64(
      options.envelope.nonce,
      sodium.base64_variants.URLSAFE_NO_PADDING
    );
    if (nonce.byteLength !== NONCE_BYTES) {
      throw new CryptoIntegrityError();
    }
    const ciphertext = sodium.from_base64(
      options.envelope.ciphertext,
      sodium.base64_variants.URLSAFE_NO_PADDING
    );
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      options.key
    );
  } catch (error: unknown) {
    if (error instanceof CryptoConfigurationError) {
      throw error;
    }
    throw new CryptoIntegrityError();
  }
}

function createAad(recordType: string, userLookup: string): Uint8Array {
  assertContextPart("recordType", recordType);
  assertContextPart("userLookup", userLookup);
  return encoder.encode(`maxbridge|v1|${recordType}|${userLookup}`);
}

function assertEnvelope(
  envelope: unknown
): asserts envelope is CipherEnvelopeV1 {
  if (
    typeof envelope !== "object"
    || envelope === null
    || !("version" in envelope)
    || !("keyId" in envelope)
    || !("nonce" in envelope)
    || !("ciphertext" in envelope)
    ||
    envelope.version !== 1
    || typeof envelope.keyId !== "string"
    || envelope.keyId.length === 0
    || typeof envelope.nonce !== "string"
    || envelope.nonce.length === 0
    || typeof envelope.ciphertext !== "string"
    || envelope.ciphertext.length === 0
  ) {
    throw new CryptoIntegrityError();
  }
}

export function assertKey(key: Uint8Array): void {
  if (key.byteLength !== KEY_BYTES) {
    throw new CryptoConfigurationError("Encryption key must contain 32 bytes");
  }
}

function assertContextPart(name: string, value: string): void {
  if (
    value.length === 0
    || value.length > 512
    || value.includes("|")
    || containsControlCharacter(value)
  ) {
    throw new CryptoConfigurationError(`Invalid ${name}`);
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}
