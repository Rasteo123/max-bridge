import { describe, expect, it } from "vitest";

import {
  CryptoIntegrityError,
  decryptRecord,
  encryptRecord,
  generateKey,
  rewrapDataKey,
  unwrapDataKey,
  wrapDataKey
} from "./index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("XChaCha20-Poly1305 record envelopes", () => {
  it("round-trips a record", async () => {
    const key = await generateKey();
    const envelope = await encryptRecord({
      key,
      keyId: "dek-v1",
      recordType: "max-session",
      userLookup: "u_synthetic_a",
      plaintext: encoder.encode("synthetic-session")
    });

    const plaintext = await decryptRecord({
      key,
      envelope,
      recordType: "max-session",
      userLookup: "u_synthetic_a"
    });

    expect(decoder.decode(plaintext)).toBe("synthetic-session");
  });

  it("uses a new nonce for the same plaintext", async () => {
    const key = await generateKey();
    const options = {
      key,
      keyId: "dek-v1",
      recordType: "settings",
      userLookup: "u_synthetic_a",
      plaintext: encoder.encode("same")
    } as const;

    const first = await encryptRecord(options);
    const second = await encryptRecord(options);

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it.each(["ciphertext", "nonce"] as const)(
    "fails closed when %s is changed",
    async (field) => {
      const key = await generateKey();
      const envelope = await encryptRecord({
        key,
        keyId: "dek-v1",
        recordType: "identity",
        userLookup: "u_synthetic_a",
        plaintext: encoder.encode("synthetic")
      });
      const changed = {
        ...envelope,
        [field]: mutateBase64Url(envelope[field])
      };

      await expect(decryptRecord({
        key,
        envelope: changed,
        recordType: "identity",
        userLookup: "u_synthetic_a"
      })).rejects.toThrow(CryptoIntegrityError);
    }
  );

  it("cannot move a record to another user or record type", async () => {
    const key = await generateKey();
    const envelope = await encryptRecord({
      key,
      keyId: "dek-v1",
      recordType: "identity",
      userLookup: "u_synthetic_a",
      plaintext: encoder.encode("synthetic")
    });

    await expect(decryptRecord({
      key,
      envelope,
      recordType: "identity",
      userLookup: "u_synthetic_b"
    })).rejects.toThrow(CryptoIntegrityError);

    await expect(decryptRecord({
      key,
      envelope,
      recordType: "max-session",
      userLookup: "u_synthetic_a"
    })).rejects.toThrow(CryptoIntegrityError);
  });
});

describe("per-user data keys", () => {
  it("wraps and unwraps a data key", async () => {
    const masterKey = await generateKey();
    const dataKey = await generateKey();
    const wrapped = await wrapDataKey({
      masterKey,
      masterKeyId: "master-v1",
      userLookup: "u_synthetic_a",
      dataKey
    });

    await expect(unwrapDataKey({
      masterKey,
      userLookup: "u_synthetic_a",
      wrappedDataKey: wrapped
    })).resolves.toEqual(dataKey);
  });

  it("rewraps the DEK without changing data ciphertext", async () => {
    const oldMasterKey = await generateKey();
    const newMasterKey = await generateKey();
    const dataKey = await generateKey();
    const dataEnvelope = await encryptRecord({
      key: dataKey,
      keyId: "dek-v1",
      recordType: "max-session",
      userLookup: "u_synthetic_a",
      plaintext: encoder.encode("synthetic-session")
    });
    const oldWrapped = await wrapDataKey({
      masterKey: oldMasterKey,
      masterKeyId: "master-v1",
      userLookup: "u_synthetic_a",
      dataKey
    });

    const rewrapped = await rewrapDataKey({
      oldMasterKey,
      newMasterKey,
      newMasterKeyId: "master-v2",
      userLookup: "u_synthetic_a",
      wrappedDataKey: oldWrapped
    });
    const recoveredDataKey = await unwrapDataKey({
      masterKey: newMasterKey,
      userLookup: "u_synthetic_a",
      wrappedDataKey: rewrapped
    });
    const plaintext = await decryptRecord({
      key: recoveredDataKey,
      envelope: dataEnvelope,
      recordType: "max-session",
      userLookup: "u_synthetic_a"
    });

    expect(rewrapped.keyId).toBe("master-v2");
    expect(dataEnvelope.keyId).toBe("dek-v1");
    expect(decoder.decode(plaintext)).toBe("synthetic-session");
  });
});

function mutateBase64Url(value: string): string {
  const first = value[0];
  return `${first === "A" ? "B" : "A"}${value.slice(1)}`;
}
