import type { CipherEnvelopeV1 } from "./envelope.js";
import {
  decryptRecord,
  encryptRecord,
  assertKey
} from "./envelope.js";
import { CryptoIntegrityError } from "./errors.js";
import { zeroBuffer } from "./secret-buffer.js";

export type WrapDataKeyOptions = Readonly<{
  masterKey: Uint8Array;
  masterKeyId: string;
  userLookup: string;
  dataKey: Uint8Array;
}>;

export type UnwrapDataKeyOptions = Readonly<{
  masterKey: Uint8Array;
  userLookup: string;
  wrappedDataKey: CipherEnvelopeV1;
}>;

export type RewrapDataKeyOptions = Readonly<{
  oldMasterKey: Uint8Array;
  newMasterKey: Uint8Array;
  newMasterKeyId: string;
  userLookup: string;
  wrappedDataKey: CipherEnvelopeV1;
}>;

export async function wrapDataKey(
  options: WrapDataKeyOptions
): Promise<CipherEnvelopeV1> {
  assertKey(options.dataKey);
  return encryptRecord({
    key: options.masterKey,
    keyId: options.masterKeyId,
    recordType: "user-data-key",
    userLookup: options.userLookup,
    plaintext: options.dataKey
  });
}

export async function unwrapDataKey(
  options: UnwrapDataKeyOptions
): Promise<Uint8Array> {
  const dataKey = await decryptRecord({
    key: options.masterKey,
    envelope: options.wrappedDataKey,
    recordType: "user-data-key",
    userLookup: options.userLookup
  });
  try {
    assertKey(dataKey);
    return dataKey;
  } catch {
    zeroBuffer(dataKey);
    throw new CryptoIntegrityError();
  }
}

export async function rewrapDataKey(
  options: RewrapDataKeyOptions
): Promise<CipherEnvelopeV1> {
  const dataKey = await unwrapDataKey({
    masterKey: options.oldMasterKey,
    userLookup: options.userLookup,
    wrappedDataKey: options.wrappedDataKey
  });
  try {
    return await wrapDataKey({
      masterKey: options.newMasterKey,
      masterKeyId: options.newMasterKeyId,
      userLookup: options.userLookup,
      dataKey
    });
  } finally {
    zeroBuffer(dataKey);
  }
}
