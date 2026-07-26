import {
  USER_STATES,
  createUserLookup,
  decryptRecord,
  encryptRecord,
  generateKey,
  parseCipherEnvelope,
  unwrapDataKey,
  wrapDataKey,
  zeroBuffer,
  type CipherEnvelopeV1,
  type UserRecord,
  type UserState
} from "@maxbridge/core";

import type { MaxbridgeDatabase } from "./client.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type TelegramIdentity = Readonly<{
  telegramId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}>;

export type RepositoryKeys = Readonly<{
  masterKey: Uint8Array;
  masterKeyId: string;
  lookupKey: Uint8Array;
}>;

type UserRow = Readonly<{
  lookup_id: string;
  state: string;
  wrapped_dek: string;
  identity_cipher: string;
  max_session_cipher: string | null;
  created_at: string;
  updated_at: string;
}>;

const allowedTransitions: Readonly<Record<UserState, readonly UserState[]>> = {
  pending: ["approved_unbound", "disabled"],
  approved_unbound: ["authenticating", "disabled"],
  authenticating: [
    "approved_unbound",
    "active",
    "reauth_required",
    "disabled"
  ],
  active: ["reauth_required", "disabled"],
  reauth_required: ["authenticating", "disabled"],
  disabled: ["approved_unbound", "deleted"],
  deleted: []
};

export class InvalidUserTransitionError extends Error {
  readonly code = "invalid_user_transition";

  constructor() {
    super("User state transition is not allowed");
    this.name = "InvalidUserTransitionError";
  }
}

export class UserNotFoundError extends Error {
  readonly code = "user_not_found";

  constructor() {
    super("User was not found");
    this.name = "UserNotFoundError";
  }
}

export class UsersRepository {
  constructor(
    private readonly database: MaxbridgeDatabase,
    private readonly keys: RepositoryKeys,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createPending(identity: TelegramIdentity): Promise<UserRecord> {
    const validatedIdentity = parseTelegramIdentity(identity);
    const lookupId = createUserLookup(
      this.keys.lookupKey,
      validatedIdentity.telegramId
    );
    const existing = this.findRow(lookupId);
    if (existing !== undefined) {
      return rowToUserRecord(existing);
    }

    const dataKey = await generateKey();
    try {
      const [wrappedDataKey, identityCipher] = await Promise.all([
        wrapDataKey({
          masterKey: this.keys.masterKey,
          masterKeyId: this.keys.masterKeyId,
          userLookup: lookupId,
          dataKey
        }),
        encryptRecord({
          key: dataKey,
          keyId: "dek-v1",
          recordType: "telegram-identity",
          userLookup: lookupId,
          plaintext: encoder.encode(JSON.stringify(validatedIdentity))
        })
      ]);
      const timestamp = this.now().toISOString();
      this.database.prepare(`
        INSERT OR IGNORE INTO users (
          lookup_id,
          state,
          wrapped_dek,
          identity_cipher,
          created_at,
          updated_at
        ) VALUES (?, 'pending', ?, ?, ?, ?)
      `).run(
        lookupId,
        serializeEnvelope(wrappedDataKey),
        serializeEnvelope(identityCipher),
        timestamp,
        timestamp
      );
    } finally {
      zeroBuffer(dataKey);
    }

    return rowToUserRecord(this.requireRow(lookupId));
  }

  async findIdentity(
    telegramId: string
  ): Promise<TelegramIdentity | null> {
    const lookupId = createUserLookup(this.keys.lookupKey, telegramId);
    const row = this.findRow(lookupId);
    if (row === undefined) {
      return null;
    }

    const dataKey = await this.loadDataKey(row);
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = await decryptRecord({
        key: dataKey,
        envelope: deserializeEnvelope(row.identity_cipher),
        recordType: "telegram-identity",
        userLookup: lookupId
      });
      return parseTelegramIdentity(
        JSON.parse(decoder.decode(plaintext)) as unknown
      );
    } finally {
      zeroBuffer(dataKey);
      if (plaintext !== undefined) {
        zeroBuffer(plaintext);
      }
    }
  }

  transition(
    telegramId: string,
    nextState: UserState
  ): UserRecord {
    if (!USER_STATES.includes(nextState)) {
      throw new InvalidUserTransitionError();
    }
    const lookupId = createUserLookup(this.keys.lookupKey, telegramId);
    const row = this.requireRow(lookupId);
    const currentState = parseUserState(row.state);
    if (!allowedTransitions[currentState].includes(nextState)) {
      throw new InvalidUserTransitionError();
    }
    const timestamp = this.now().toISOString();
    this.database.prepare(`
      UPDATE users
      SET state = ?, updated_at = ?
      WHERE lookup_id = ?
    `).run(nextState, timestamp, lookupId);
    return rowToUserRecord(this.requireRow(lookupId));
  }

  async saveMaxSession(
    telegramId: string,
    storageState: Uint8Array
  ): Promise<void> {
    const lookupId = createUserLookup(this.keys.lookupKey, telegramId);
    const row = this.requireRow(lookupId);
    const dataKey = await this.loadDataKey(row);
    try {
      const encrypted = await encryptRecord({
        key: dataKey,
        keyId: "dek-v1",
        recordType: "max-session",
        userLookup: lookupId,
        plaintext: storageState
      });
      this.database.prepare(`
        UPDATE users
        SET max_session_cipher = ?, updated_at = ?
        WHERE lookup_id = ?
      `).run(
        serializeEnvelope(encrypted),
        this.now().toISOString(),
        lookupId
      );
    } finally {
      zeroBuffer(dataKey);
    }
  }

  async loadMaxSession(
    telegramId: string
  ): Promise<Uint8Array | null> {
    const lookupId = createUserLookup(this.keys.lookupKey, telegramId);
    const row = this.requireRow(lookupId);
    if (row.max_session_cipher === null) {
      return null;
    }
    const dataKey = await this.loadDataKey(row);
    try {
      return await decryptRecord({
        key: dataKey,
        envelope: deserializeEnvelope(row.max_session_cipher),
        recordType: "max-session",
        userLookup: lookupId
      });
    } finally {
      zeroBuffer(dataKey);
    }
  }

  deleteUser(telegramId: string): void {
    const lookupId = createUserLookup(this.keys.lookupKey, telegramId);
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE users
        SET
          wrapped_dek = hex(randomblob(length(wrapped_dek))),
          identity_cipher = hex(randomblob(length(identity_cipher))),
          max_session_cipher = CASE
            WHEN max_session_cipher IS NULL THEN NULL
            ELSE hex(randomblob(length(max_session_cipher)))
          END,
          preferences_cipher = CASE
            WHEN preferences_cipher IS NULL THEN NULL
            ELSE hex(randomblob(length(preferences_cipher)))
          END
        WHERE lookup_id = ?
      `).run(lookupId);
      this.database.prepare(
        "DELETE FROM users WHERE lookup_id = ?"
      ).run(lookupId);
    });
    transaction();
  }

  private async loadDataKey(row: UserRow): Promise<Uint8Array> {
    return unwrapDataKey({
      masterKey: this.keys.masterKey,
      userLookup: row.lookup_id,
      wrappedDataKey: deserializeEnvelope(row.wrapped_dek)
    });
  }

  private requireRow(lookupId: string): UserRow {
    const row = this.findRow(lookupId);
    if (row === undefined) {
      throw new UserNotFoundError();
    }
    return row;
  }

  private findRow(lookupId: string): UserRow | undefined {
    const value = this.database.prepare(`
      SELECT
        lookup_id,
        state,
        wrapped_dek,
        identity_cipher,
        max_session_cipher,
        created_at,
        updated_at
      FROM users
      WHERE lookup_id = ?
    `).get(lookupId);
    return parseUserRow(value);
  }
}

function rowToUserRecord(row: UserRow): UserRecord {
  return {
    lookupId: row.lookup_id,
    state: parseUserState(row.state),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseUserState(value: string): UserState {
  const state = USER_STATES.find((candidate) => candidate === value);
  if (state === undefined) {
    throw new InvalidUserTransitionError();
  }
  return state;
}

function parseTelegramIdentity(value: unknown): TelegramIdentity {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid Telegram identity");
  }
  const keys = Object.keys(value);
  const allowedKeys = ["telegramId", "firstName", "lastName", "username"];
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw new TypeError("Invalid Telegram identity");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["telegramId"] !== "string"
    || !/^[1-9]\d{0,19}$/u.test(record["telegramId"])
  ) {
    throw new TypeError("Invalid Telegram identity");
  }
  for (const key of ["firstName", "lastName", "username"] as const) {
    const field = record[key];
    if (
      field !== undefined
      && (
        typeof field !== "string"
        || field.length === 0
        || field.length > 256
      )
    ) {
      throw new TypeError("Invalid Telegram identity");
    }
  }
  return {
    telegramId: record["telegramId"],
    ...(typeof record["firstName"] === "string"
      ? { firstName: record["firstName"] }
      : {}),
    ...(typeof record["lastName"] === "string"
      ? { lastName: record["lastName"] }
      : {}),
    ...(typeof record["username"] === "string"
      ? { username: record["username"] }
      : {})
  };
}

function parseUserRow(value: unknown): UserRow | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid user row");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row["lookup_id"] !== "string"
    || typeof row["state"] !== "string"
    || typeof row["wrapped_dek"] !== "string"
    || typeof row["identity_cipher"] !== "string"
    || (
      typeof row["max_session_cipher"] !== "string"
      && row["max_session_cipher"] !== null
    )
    || typeof row["created_at"] !== "string"
    || typeof row["updated_at"] !== "string"
  ) {
    throw new TypeError("Invalid user row");
  }
  return {
    lookup_id: row["lookup_id"],
    state: row["state"],
    wrapped_dek: row["wrapped_dek"],
    identity_cipher: row["identity_cipher"],
    max_session_cipher: row["max_session_cipher"],
    created_at: row["created_at"],
    updated_at: row["updated_at"]
  };
}

function serializeEnvelope(envelope: CipherEnvelopeV1): string {
  return JSON.stringify(envelope);
}

function deserializeEnvelope(value: string): CipherEnvelopeV1 {
  return parseCipherEnvelope(JSON.parse(value) as unknown);
}
