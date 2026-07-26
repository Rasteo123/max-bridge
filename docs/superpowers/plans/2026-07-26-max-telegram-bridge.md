# MAX ↔ Telegram Bridge Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to
> implement this plan task by task. Use TDD for every behavior change and run
> verification gates before touching production.

**Goal:** Replace the insecure proof of concept with a closed, multi-user
Telegram Mini App that safely exposes each approved user's own `web.max.ru`
session without persisting messages or media.

**Architecture:** An npm-workspaces TypeScript monorepo contains a Fastify and
Telegraf API service, a separate Playwright worker service connected over a
permission-restricted Unix socket, a React Mini App, shared domain/crypto
packages, and operational files. The API derives identity exclusively from
validated Telegram `initData`; the worker receives opaque session handles, not
Telegram IDs. Three Chromium processes host at most four isolated contexts each.

**Tech stack:** Node.js 24 LTS, npm workspaces, TypeScript, Fastify, Telegraf,
React, Vite, Playwright, libsodium, SQLite, Vitest, Testing Library, Playwright
Test, systemd, Cloudflare Tunnel.

**Constraints:**

- Do not modify or restart sing-box, VLESS Reality, Hysteria2, WireGuard, Docker
  or Qdrant.
- Do not publish the new app until cross-user isolation tests pass.
- Do not persist message bodies, contact names, media or one-time codes.
- Do not log Telegram `initData`, phone numbers, MAX cookies or response bodies.
- Do not retry an ambiguous outgoing MAX operation automatically.
- CAPTCHA is surfaced to the user, never bypassed.
- Any real MAX traffic used during discovery must be reduced to schemas and
  synthetic fixtures before it is written to disk.

---

## Task 1: Preserve the baseline and scaffold the monorepo

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `eslint.config.js`
- Create: `apps/api/package.json`
- Create: `apps/worker/package.json`
- Create: `apps/web/package.json`
- Create: `packages/core/package.json`
- Create: `packages/max-adapter/package.json`
- Create: `packages/protocol/package.json`
- Create: `tests/security/.gitkeep`
- Modify: `.gitignore`

**Step 1: Record the server baseline**

Run read-only checks and save redacted output under
`work/deployment-baseline/`:

```bash
ssh ... 'systemctl --failed; ss -lntup; free -m; df -h; pm2 status'
```

The record must contain no environment values or process environment.

**Step 2: Create workspace manifests**

The root scripts must include:

```json
{
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint .",
    "test:e2e": "playwright test",
    "verify": "npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

Use exact dependency versions in `package-lock.json`; remove `localtunnel`,
`cors`, Express and Socket.IO from the new implementation.

**Step 3: Add a smoke test**

Create `packages/core/src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("runs tests", () => expect(true).toBe(true));
});
```

**Step 4: Verify the scaffold**

Run:

```bash
npm ci
npm run typecheck
npm test
```

Expected: all commands exit 0.

**Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts \
  eslint.config.js apps packages tests .gitignore
git commit -m "build: scaffold secure MAX bridge workspace"
```

---

## Task 2: Define shared domain types and validation

**Files:**

- Create: `packages/core/src/domain/user.ts`
- Create: `packages/core/src/domain/chat.ts`
- Create: `packages/core/src/domain/message.ts`
- Create: `packages/core/src/domain/events.ts`
- Create: `packages/core/src/domain/errors.ts`
- Create: `packages/core/src/domain/index.ts`
- Create: `packages/core/src/domain/domain.test.ts`

**Step 1: Write failing validation tests**

Cover:

- all approved user states;
- chat rows with avatar, title, preview, time and unread count;
- message kinds `text`, `image`, `video`, `voice`, `file`, `system`;
- rejection of unknown fields, negative unread counts and oversized strings;
- opaque IDs that cannot be empty.

Example:

```ts
it("rejects a negative unread count", () => {
  expect(() => ChatSummarySchema.parse({
    id: "chat-1",
    title: "Synthetic",
    preview: "Synthetic preview",
    unreadCount: -1
  })).toThrow();
});
```

**Step 2: Run the test and confirm failure**

```bash
npm test -- packages/core/src/domain/domain.test.ts
```

**Step 3: Implement strict schemas**

Use TypeBox or Zod consistently. Keep the internal MAX model independent of
unofficial wire field names.

**Step 4: Run tests and typecheck**

```bash
npm test -- packages/core/src/domain/domain.test.ts
npm run typecheck
```

**Step 5: Commit**

```bash
git add packages/core/src/domain
git commit -m "feat(core): define validated bridge domain model"
```

---

## Task 3: Implement cryptography and secret handling

**Files:**

- Create: `packages/core/src/crypto/envelope.ts`
- Create: `packages/core/src/crypto/keys.ts`
- Create: `packages/core/src/crypto/lookup.ts`
- Create: `packages/core/src/crypto/secret-buffer.ts`
- Create: `packages/core/src/crypto/envelope.test.ts`
- Create: `packages/core/src/crypto/lookup.test.ts`
- Create: `apps/api/src/config/credentials.ts`
- Create: `apps/api/src/config/credentials.test.ts`

**Step 1: Write failing crypto tests**

Cover:

- XChaCha20-Poly1305 round trip;
- random nonce differs for identical plaintext;
- tampered ciphertext, nonce and AAD fail closed;
- record cannot be moved to another user's AAD;
- per-user DEK wrap/unwrap;
- master-key rotation rewraps the DEK without changing data ciphertext;
- HMAC lookup is stable but does not equal the Telegram ID;
- secret buffers are zeroed after use;
- credential loader rejects absent, short or world-readable fallback files.

Never use real IDs or tokens in fixtures.

**Step 2: Confirm failure**

```bash
npm test -- packages/core/src/crypto apps/api/src/config/credentials.test.ts
```

**Step 3: Implement the envelope format**

Use a versioned binary or canonical JSON envelope:

```ts
type CipherEnvelopeV1 = {
  version: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
};
```

AAD must be canonical and include:

```text
maxbridge|v1|<record-type>|<user-lookup>
```

Reject unknown versions. Never reuse a nonce. Load the 32-byte master key from
`CREDENTIALS_DIRECTORY/master-key`.

**Step 4: Verify**

```bash
npm test -- packages/core/src/crypto apps/api/src/config/credentials.test.ts
npm run typecheck
```

**Step 5: Commit**

```bash
git add packages/core/src/crypto apps/api/src/config
git commit -m "feat(security): add per-user XChaCha envelope encryption"
```

---

## Task 4: Create the encrypted persistence layer

**Files:**

- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/migrations/001_initial.sql`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/db/users-repository.ts`
- Create: `apps/api/src/db/audit-repository.ts`
- Create: `apps/api/src/db/users-repository.test.ts`
- Create: `apps/api/src/db/audit-repository.test.ts`

**Step 1: Write failing repository tests**

Use a temporary SQLite database and test:

- pending → approved → authenticating → active transitions;
- invalid transitions are rejected;
- original Telegram ID and MAX storage state are not visible in raw SQLite;
- deleting a user removes wrapped DEK, ciphertext and preferences;
- audit accepts event codes and durations but rejects free-form content;
- audit records older than 30 days are purged;
- WAL and backups contain no plaintext test secrets.

**Step 2: Confirm failure**

```bash
npm test -- apps/api/src/db
```

**Step 3: Implement schema and repositories**

Tables:

```text
schema_migrations
users
audit_events
```

`users` contains HMAC lookup, encrypted identity, wrapped DEK, encrypted MAX
state, encrypted preferences, status, crypto version and timestamps. It contains
no message table.

Set:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;
```

Keep the database and WAL in a mode-0700 directory.

**Step 4: Verify raw storage**

Run the repository tests, then scan the temporary database for planted secrets.
The scan must find zero occurrences.

**Step 5: Commit**

```bash
git add apps/api/src/db
git commit -m "feat(storage): add encrypted user repository without messages"
```

---

## Task 5: Validate Telegram identity and issue short sessions

**Files:**

- Create: `apps/api/src/auth/telegram-init-data.ts`
- Create: `apps/api/src/auth/session-store.ts`
- Create: `apps/api/src/auth/auth-routes.ts`
- Create: `apps/api/src/auth/origin-policy.ts`
- Create: `apps/api/src/auth/telegram-init-data.test.ts`
- Create: `apps/api/src/auth/session-store.test.ts`
- Create: `apps/api/src/auth/auth-routes.test.ts`

**Step 1: Write failing tests**

Cover:

- correct Telegram HMAC validation;
- changed user data and hash rejection;
- `auth_date` older than five minutes rejection;
- unknown/pending/disabled user rejection;
- session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, short lived;
- session is random, opaque and kept only in memory;
- logout destroys it;
- wrong `Origin` and WebSocket upgrade without the cookie fail;
- client-supplied `userId` is ignored/rejected.

**Step 2: Confirm failure**

```bash
npm test -- apps/api/src/auth
```

**Step 3: Implement authentication**

Expose:

```text
POST /api/auth/telegram
POST /api/auth/logout
GET  /api/me
```

Redact the entire request body for the auth route. Do not echo `initData` in
errors. Use an in-memory session map with a ten-minute idle timeout; Mini App can
re-authenticate from current Telegram `initData`.

**Step 4: Run security tests**

```bash
npm test -- apps/api/src/auth tests/security
```

**Step 5: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(auth): derive Mini App identity from signed Telegram data"
```

---

## Task 6: Build the approval-only Telegram bot

**Files:**

- Create: `apps/api/src/bot/bot.ts`
- Create: `apps/api/src/bot/commands/start.ts`
- Create: `apps/api/src/bot/commands/admin-approval.ts`
- Create: `apps/api/src/bot/keyboards.ts`
- Create: `apps/api/src/bot/notifications.ts`
- Create: `apps/api/src/bot/bot.test.ts`
- Create: `apps/api/src/config/admin.ts`

**Step 1: Write failing bot tests**

Use a mocked Telegram transport:

- first `/start` creates one pending request;
- repeated `/start` is idempotent;
- only configured admin ID can approve or reject;
- callbacks contain a random request handle, not Telegram ID;
- approved user receives the Mini App button;
- disabled user cannot open it;
- notification default contains sender name/type but not body or media;
- logs never contain phone, message or bot token.

**Step 2: Confirm failure**

```bash
npm test -- apps/api/src/bot
```

**Step 3: Implement**

Load admin Telegram ID and bot token through systemd credentials. Use an inline
`web_app` button and chat menu button, not `Telegram.WebApp.sendData()` and not a
reply-keyboard flow that closes the Mini App.

**Step 4: Verify**

```bash
npm test -- apps/api/src/bot
npm run typecheck
```

**Step 5: Commit**

```bash
git add apps/api/src/bot apps/api/src/config/admin.ts
git commit -m "feat(bot): add manual friend approval and private notices"
```

---

## Task 7: Define the API ↔ Playwright worker protocol

**Files:**

- Create: `packages/protocol/src/commands.ts`
- Create: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/framing.ts`
- Create: `packages/protocol/src/framing.test.ts`
- Create: `apps/api/src/worker/worker-client.ts`
- Create: `apps/api/src/worker/worker-client.test.ts`
- Create: `apps/worker/src/server.ts`
- Create: `apps/worker/src/server.test.ts`

**Step 1: Write failing protocol tests**

Cover:

- length-delimited JSON frames handle split/coalesced Unix socket packets;
- every request has correlation ID and timeout;
- malformed/oversized frames close the connection;
- only opaque `sessionHandle` crosses the protocol;
- no Telegram ID, phone, key or message content appears in protocol errors;
- worker event cannot be routed to an unknown handle.

**Step 2: Confirm failure**

```bash
npm test -- packages/protocol apps/api/src/worker apps/worker/src/server.test.ts
```

**Step 3: Implement Unix socket transport**

Use `/run/maxbridge/worker.sock`, mode `0600`, owned by `maxbridge`. Cap control
frames. Use separate capped streaming messages for media; never serialize a
whole large file into an error or log.

**Step 4: Verify reconnect behavior**

Kill the fake worker during a request. The API must return a bounded
`worker_unavailable` error and reconnect without reusing an ambiguous send.

**Step 5: Commit**

```bash
git add packages/protocol apps/api/src/worker apps/worker/src/server*
git commit -m "feat(worker): add bounded Unix socket protocol"
```

---

## Task 8: Build the three-browser session pool

**Files:**

- Create: `apps/worker/src/pool/browser-pool.ts`
- Create: `apps/worker/src/pool/browser-slot.ts`
- Create: `apps/worker/src/pool/session-registry.ts`
- Create: `apps/worker/src/pool/health-monitor.ts`
- Create: `apps/worker/src/pool/browser-pool.test.ts`
- Create: `apps/worker/src/pool/health-monitor.test.ts`

**Step 1: Write failing pool tests**

Use fake browsers:

- exactly three slots;
- no more than four contexts per browser;
- least-loaded healthy slot chosen;
- each user has a unique context;
- close removes all references and zeroes received storage state;
- crash emits affected handles and recreates only that browser;
- health timeout does not silently discard the session;
- memory pressure triggers a controlled restart notice.

The production server has 3819 MiB RAM and no swap. The load gate must keep the
worker pool below 2200 MiB during steady state and below 2600 MiB at the enforced
hard limit. Do not add ordinary disk-backed swap because plaintext browser pages
could be paged to disk. If swap ever becomes necessary, it requires a separate
design for per-boot encrypted swap.

**Step 2: Confirm failure**

```bash
npm test -- apps/worker/src/pool
```

**Step 3: Implement with dependency injection**

Keep Playwright behind a `BrowserFactory` interface so unit tests never launch
real Chromium. Production launch must not pass `--no-sandbox`.

**Step 4: Run a real local smoke**

Launch three headless browsers, create ten empty contexts, close them, and assert
no Chromium child remains.

**Step 5: Commit**

```bash
git add apps/worker/src/pool
git commit -m "feat(worker): isolate ten sessions across three browsers"
```

---

## Task 9: Implement MAX login by phone and QR

**Files:**

- Create: `packages/max-adapter/src/login/login-controller.ts`
- Create: `packages/max-adapter/src/login/login-locators.ts`
- Create: `packages/max-adapter/src/login/login-state.ts`
- Create: `packages/max-adapter/src/login/login-controller.test.ts`
- Create: `packages/max-adapter/tests/fixtures/login-en.html`
- Create: `packages/max-adapter/tests/fixtures/login-ru.html`
- Create: `apps/api/src/routes/max-login.ts`
- Create: `apps/api/src/routes/max-login.test.ts`

**Step 1: Write failing fixture-based tests**

Cover English and Russian login UI:

- accessible-role locator for phone login;
- phone input can be `type=text` with `autocomplete=tel`;
- code step detection is semantic, not a guessed CSS class;
- QR image is streamed to the caller and not saved;
- success is detected by stable behavior/network state;
- timeout, invalid code, CAPTCHA and expired QR return separate states;
- phone/code buffers are zeroed and absent from logs.

**Step 2: Confirm failure**

```bash
npm test -- packages/max-adapter/src/login apps/api/src/routes/max-login.test.ts
```

**Step 3: Implement API routes**

Expose:

```text
POST /api/max/login/phone
POST /api/max/login/code
GET  /api/max/login/qr
GET  /api/max/login/status
POST /api/max/logout
```

All routes require the approved Telegram session and strict rate limits. Five
failed attempts in 15 minutes lock login for 30 minutes.

**Step 4: Live read-only login-page smoke**

Against `web.max.ru`, verify only the initial page and phone-login control. Do
not submit a real phone until the user is present for the code.

**Step 5: Commit**

```bash
git add packages/max-adapter/src/login packages/max-adapter/tests \
  apps/api/src/routes/max-login*
git commit -m "feat(max): add resilient phone and QR authentication"
```

---

## Task 10: Discover MAX wire schemas without recording content

**Files:**

- Create: `packages/max-adapter/src/discovery/schema-observer.ts`
- Create: `packages/max-adapter/src/discovery/sanitizer.ts`
- Create: `packages/max-adapter/src/discovery/schema-observer.test.ts`
- Create: `packages/max-adapter/src/wire/wire-classifier.ts`
- Create: `packages/max-adapter/src/wire/wire-classifier.test.ts`
- Create: `packages/max-adapter/tests/fixtures/synthetic-wire-events.json`
- Create: `scripts/max-schema-probe.ts`

**Step 1: Write failing sanitizer tests**

Plant fake names, messages, phones, tokens, URLs and binary payloads. The
observer output may contain only:

- URL origin/path pattern with sensitive query values removed;
- method/status;
- object keys and primitive types;
- array lengths capped to a bucket;
- WebSocket direction and structural schema.

The planted values must not appear in output.

**Step 2: Confirm failure**

```bash
npm test -- packages/max-adapter/src/discovery
```

**Step 3: Implement observer and classifier**

Subscribe to Playwright request/response and WebSocket events. Never call a
generic `console.log(responseBody)`. Add allowlisted schema extraction with hard
size limits.

**Step 4: Run controlled discovery with the owner's MAX account**

This is an explicit interactive checkpoint:

1. user authorizes with phone/code or QR;
2. open chat list;
3. open a synthetic/test conversation;
4. send synthetic text and one test image;
5. stop capture;
6. inspect the schema-only output for leaked values;
7. manually create synthetic fixtures;
8. delete raw in-memory capture by ending the process.

Do not proceed to message implementation until this checkpoint succeeds.

**Step 5: Commit only code and synthetic fixtures**

```bash
git add packages/max-adapter/src/discovery packages/max-adapter/src/wire \
  packages/max-adapter/tests/fixtures scripts/max-schema-probe.ts
git commit -m "test(max): add privacy-preserving wire schema discovery"
```

---

## Task 11: Implement chat list, history and live incoming events

**Files:**

- Create: `packages/max-adapter/src/adapters/chat-list-adapter.ts`
- Create: `packages/max-adapter/src/adapters/history-adapter.ts`
- Create: `packages/max-adapter/src/adapters/live-event-adapter.ts`
- Create: `packages/max-adapter/src/adapters/media-adapter.ts`
- Create: `packages/max-adapter/src/adapters/adapters.test.ts`
- Create: `packages/max-adapter/src/max-session.ts`
- Create: `packages/max-adapter/src/max-session.test.ts`

**Step 1: Write failing tests from synthetic fixtures**

Cover:

- personal and group chats;
- avatar, title, preview, time and unread count;
- pagination of history;
- text/image/video/voice/file/system messages;
- edits/deletions if exposed by web MAX;
- duplicate live event suppression;
- reconnect cursor;
- unknown event shape trips a typed compatibility error, not a crash;
- no message body is included in logs or persisted cache.

**Step 2: Confirm failure**

```bash
npm test -- packages/max-adapter/src/adapters \
  packages/max-adapter/src/max-session.test.ts
```

**Step 3: Implement pure wire-to-domain adapters**

Keep parsing pure and fixture-driven. `MaxSession` owns only a bounded in-memory
view sufficient for the current list and open chat. History is fetched again
from MAX after restart.

**Step 4: Add contract smoke**

With the user's authenticated test session, compare synthetic adapter output
shape with current live web MAX. Do not snapshot real values.

**Step 5: Commit**

```bash
git add packages/max-adapter/src/adapters packages/max-adapter/src/max-session*
git commit -m "feat(max): adapt chat history and live events"
```

---

## Task 12: Implement outgoing text and media safely

**Files:**

- Create: `packages/max-adapter/src/send/send-controller.ts`
- Create: `packages/max-adapter/src/send/send-controller.test.ts`
- Create: `apps/worker/src/media/runtime-media-store.ts`
- Create: `apps/worker/src/media/runtime-media-store.test.ts`
- Create: `apps/api/src/routes/messages.ts`
- Create: `apps/api/src/routes/messages.test.ts`

**Step 1: Write failing tests**

Cover:

- text send with client-generated operation ID when supported;
- confirmed send succeeds once;
- timeout after request is `ambiguous`, not automatically retried;
- explicit user retry creates a new operation only after confirmation;
- image/video/voice/file limits;
- MIME sniffing rather than trusting extension;
- filenames normalized;
- media stored only under `/run/maxbridge/media`;
- TTL and disconnect remove temporary data;
- no media bytes or message text in logs/errors.

**Step 2: Confirm failure**

```bash
npm test -- packages/max-adapter/src/send apps/worker/src/media \
  apps/api/src/routes/messages.test.ts
```

**Step 3: Implement**

Use streaming and backpressure. Limit each file to the smaller of the MAX limit
discovered in Task 10 and the configured safety cap. Allow at most two concurrent
media operations per user and globally bounded memory/tmpfs.

**Step 4: Fault injection**

Drop the worker connection:

- before request;
- after request write;
- before confirmation.

Only the first case may be safely retried automatically.

**Step 5: Commit**

```bash
git add packages/max-adapter/src/send apps/worker/src/media \
  apps/api/src/routes/messages*
git commit -m "feat(max): send text and media without durable queues"
```

---

## Task 13: Build the Fastify API and authenticated WebSocket

**Files:**

- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/plugins/security.ts`
- Create: `apps/api/src/plugins/errors.ts`
- Create: `apps/api/src/plugins/logging.ts`
- Create: `apps/api/src/routes/chats.ts`
- Create: `apps/api/src/routes/websocket.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.test.ts`
- Create: `tests/security/cross-user.test.ts`

**Step 1: Write failing API/security tests**

Cover:

- listen address defaults to `127.0.0.1`;
- strict host/origin allowlist for `max-users.online` and staging;
- Helmet/CSP headers compatible with Telegram SDK;
- body and upload limits;
- authenticated chat list/history/send;
- WebSocket requires valid short session cookie;
- user A cannot name, enumerate, subscribe or send through user B;
- forged `sessionHandle`, chat ID and correlation ID fail;
- health route returns no secrets;
- errors use public codes and correlation IDs only.

**Step 2: Confirm failure**

```bash
npm test -- apps/api/src/app.test.ts tests/security/cross-user.test.ts
```

**Step 3: Implement**

Expose only:

```text
/api/auth/*
/api/me
/api/max/login/*
/api/chats
/api/chats/:id/messages
/api/messages
/api/ws
/health/live
/health/ready
```

Serve the built Mini App from the same origin. Do not enable wildcard CORS.

**Step 4: Verify headers and sockets**

Use Fastify inject tests and a real loopback WebSocket smoke.

**Step 5: Commit**

```bash
git add apps/api/src tests/security/cross-user.test.ts
git commit -m "feat(api): expose authenticated same-origin bridge API"
```

---

## Task 14: Build Mini App authentication and onboarding

**Files:**

- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/socket.ts`
- Create: `apps/web/src/features/auth/AuthGate.tsx`
- Create: `apps/web/src/features/auth/PendingScreen.tsx`
- Create: `apps/web/src/features/login/MaxLogin.tsx`
- Create: `apps/web/src/features/login/PhoneLogin.tsx`
- Create: `apps/web/src/features/login/QrLogin.tsx`
- Create: `apps/web/src/features/login/login.test.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`

**Step 1: Write failing component tests**

Cover:

- calls `Telegram.WebApp.ready()` and expands;
- sends raw `initData` only to auth endpoint;
- pending/disabled/reauth states;
- phone and code inputs are never sent through `sendData`;
- QR refresh/expiry;
- sensitive fields clear on completion/unmount;
- reconnect re-authenticates without localStorage tokens;
- Russian UI and Telegram theme colors.

**Step 2: Confirm failure**

```bash
npm test -- apps/web/src/features/auth apps/web/src/features/login
```

**Step 3: Implement**

Use same-origin fetch with credentials. Add clear privacy text explaining that
MAX and Telegram retain their own copies and the bridge does not.

**Step 4: Accessibility check**

Run Testing Library checks for labels, focus order, error announcements and
keyboard operation.

**Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add signed Telegram onboarding and MAX login"
```

---

## Task 15: Implement the adaptive messenger and swipe behavior

**Files:**

- Create: `apps/web/src/features/messenger/MessengerShell.tsx`
- Create: `apps/web/src/features/messenger/ChatList.tsx`
- Create: `apps/web/src/features/messenger/ChatRow.tsx`
- Create: `apps/web/src/features/messenger/Conversation.tsx`
- Create: `apps/web/src/features/messenger/Composer.tsx`
- Create: `apps/web/src/features/messenger/useResponsivePane.ts`
- Create: `apps/web/src/features/messenger/useSwipeNavigation.ts`
- Create: `apps/web/src/features/messenger/messenger.css`
- Create: `apps/web/src/features/messenger/ChatRow.test.tsx`
- Create: `apps/web/src/features/messenger/swipe.test.tsx`
- Create: `apps/web/e2e/responsive-messenger.spec.ts`

**Step 1: Write failing row/layout tests**

Cover:

- contact name is above preview;
- time and unread badge remain on the right;
- long text truncates without overlap;
- at 820 px and above, list and chat are visible;
- below 820 px, only one full-width page is active;
- resizing switches mode without reload;
- composer buttons do not overlap at 320, 375, 768 and 820 px.

**Step 2: Write failing gesture tests**

Cover:

- left-edge swipe right opens list;
- swipe left hides it;
- insufficient distance snaps back;
- fast swipe passes velocity threshold;
- vertical scroll is not intercepted;
- gesture cancels correctly;
- buttons remain usable;
- horizontal wheel/trackpad maps to the same state machine.

**Step 3: Confirm failure**

```bash
npm test -- apps/web/src/features/messenger
npm run test:e2e -- apps/web/e2e/responsive-messenger.spec.ts
```

**Step 4: Implement the approved UI**

Use CSS grid with `minmax(0, 1fr)` and a fluid 320–400 px sidebar. Narrow mode
uses a transformable two-page track. Gesture logic uses Pointer Events,
direction lock, distance/velocity thresholds and `prefers-reduced-motion`.

**Step 5: Visual verification**

Capture screenshots at:

```text
1440×900
1024×768
820×1180
768×1024
430×932
390×844
320×568
```

Verify both narrow pages and mid-gesture state.

**Step 6: Commit**

```bash
git add apps/web/src/features/messenger apps/web/e2e
git commit -m "feat(web): add adaptive messenger with bidirectional swipes"
```

---

## Task 16: Connect live chats, media and private notifications

**Files:**

- Create: `apps/web/src/features/messenger/messenger-store.ts`
- Create: `apps/web/src/features/messenger/useLiveEvents.ts`
- Create: `apps/web/src/features/messenger/MessageBubble.tsx`
- Create: `apps/web/src/features/messenger/MediaMessage.tsx`
- Create: `apps/web/src/features/settings/NotificationSettings.tsx`
- Create: `apps/web/src/features/messenger/live-events.test.tsx`
- Create: `apps/api/src/notifications/router.ts`
- Create: `apps/api/src/notifications/deduplicator.ts`
- Create: `apps/api/src/notifications/router.test.ts`

**Step 1: Write failing tests**

Cover:

- paginated history and live events merge without duplicates;
- unread count moves correctly;
- reconnect status is visible;
- media URLs are short-lived and same-origin;
- object URLs are revoked;
- default Telegram notice omits body/media;
- per-chat preview opt-in is encrypted;
- muted chat produces no Telegram push but still updates Mini App;
- restart cursor prevents obvious duplicate notices without storing content.

**Step 2: Confirm failure**

```bash
npm test -- apps/web/src/features/messenger/live-events.test.tsx \
  apps/api/src/notifications
```

**Step 3: Implement**

Keep only bounded current UI state in browser memory. On reload fetch fresh data
from MAX. Persist no chat store in IndexedDB or LocalStorage.

**Step 4: Integration smoke**

Use two synthetic sessions to prove that events and media never cross users.

**Step 5: Commit**

```bash
git add apps/web/src/features/messenger apps/web/src/features/settings \
  apps/api/src/notifications
git commit -m "feat: connect live MAX conversations and private notices"
```

---

## Task 17: Add resilience, redaction and full verification gates

**Files:**

- Create: `apps/api/src/resilience/circuit-breaker.ts`
- Create: `apps/api/src/resilience/recovery.ts`
- Create: `apps/api/src/resilience/recovery.test.ts`
- Create: `apps/worker/src/resilience/session-recovery.test.ts`
- Create: `tests/security/log-redaction.test.ts`
- Create: `tests/security/no-durable-content.test.ts`
- Create: `tests/load/ten-sessions.test.ts`
- Create: `scripts/scan-runtime-content.sh`

**Step 1: Write failing fault tests**

Cover:

- worker process crash;
- individual Chromium crash;
- browser context crash;
- MAX WebSocket disconnect;
- API restart;
- expired MAX auth;
- incompatible wire schema;
- database tampering;
- ten concurrent active sessions;
- ambiguous send never auto-retries.

**Step 2: Write no-content tests**

Plant unique canaries as:

- message;
- contact name;
- filename;
- phone;
- OTP;
- cookie.

After all flows, scan SQLite, WAL, logs, crash reports and runtime directories.
Only the runtime media canary may exist during its active request; it must
disappear after completion/TTL.

**Step 3: Implement bounded recovery**

Add typed states, circuit breaker, exponential reconnect for safe read
operations, and explicit user-facing `reauth_required`/`retry_required`.

**Step 4: Run the complete local gate**

```bash
npm run verify
npm run test:e2e
npm audit --audit-level=high
```

Expected: zero failing tests, zero high/critical audit findings, no leaked
canaries.

**Step 5: Commit**

```bash
git add apps packages tests scripts/scan-runtime-content.sh
git commit -m "test: enforce isolation recovery and no-content guarantees"
```

---

## Task 18: Create hardened deployment artifacts

**Files:**

- Create: `ops/systemd/maxbridge-api.service`
- Create: `ops/systemd/maxbridge-workers.service`
- Create: `ops/systemd/maxbridge.target`
- Create: `ops/tmpfiles/maxbridge.conf`
- Create: `ops/cloudflared/README.md`
- Create: `ops/firewall/ufw-rules.md`
- Create: `ops/scripts/install.sh`
- Create: `ops/scripts/health-check.sh`
- Create: `ops/scripts/rollback.sh`
- Create: `ops/scripts/backup-encrypted-db.sh`
- Create: `ops/deploy.test.ts`

**Step 1: Write artifact tests**

Parse unit files and assert:

- `User=maxbridge`;
- API binds loopback;
- `NoNewPrivileges=true`;
- restricted address families and capabilities;
- read-only system paths;
- `PrivateTmp=true`;
- writable paths limited to database/runtime directories;
- memory and task limits;
- credentials are referenced from `CREDENTIALS_DIRECTORY`;
- worker has Chromium-compatible sandbox settings;
- runtime media lives under `/run`, not `/var`;
- restart policies are bounded.

Set the worker service to `MemoryHigh=2200M` and `MemoryMax=2600M`; set a
separate conservative limit for the API. Verify these limits with ten synthetic
contexts before using ten real accounts.

**Step 2: Implement units and scripts**

Use `/opt/maxbridge/releases/<release-id>` with an atomic
`/opt/maxbridge/current` symlink. Database lives in `/var/lib/maxbridge`, mode
0700. Runtime socket/media lives in `/run/maxbridge`.

Do not put secrets in unit files, deployment archives or shell history.

**Step 3: Add Cloudflare instructions**

Use a remotely managed tunnel named `max-users-production`:

```text
staging.max-users.online → http://127.0.0.1:3100
max-users.online         → http://127.0.0.1:3100
```

The production hostname is added only at cutover. Tunnel token remains root-only
on the server and is never committed or pasted into logs.

**Step 4: Document firewall change**

Before enabling UFW, preserve:

```text
22/tcp
443/tcp
443/udp
51820/udp
```

Open a second verified SSH session, schedule an automatic rollback, enable UFW,
verify VPN listeners and SSH, then cancel rollback. New app port 3100 must not be
public.

**Step 5: Commit**

```bash
git add ops
git commit -m "ops: add hardened atomic deployment and rollback"
```

---

## Task 19: Deploy staging beside the old service

**Files:**

- Server create: `/opt/maxbridge/releases/<release-id>/`
- Server create: `/var/lib/maxbridge/`
- Server create: systemd credentials
- Server create: systemd units from `ops/systemd/`

**Step 1: Build an immutable release**

```bash
npm ci
npm run verify
npm run test:e2e
npm run build
```

Create an archive only from the verified Git commit and record its SHA-256.

**Step 2: Create the restricted account**

Create `maxbridge` with no interactive shell. Create database/runtime directories
with exact ownership and permissions. Generate the master key on the server;
never copy it back to the workspace.

**Step 3: Install without touching port 3000**

Start the new API on `127.0.0.1:3100`. Keep old PM2 and LocalTunnel running
during this stage.

**Step 4: Install Cloudflare Tunnel**

This is an interactive credential checkpoint. The user logs into Cloudflare or
authorizes browser control. Create `max-users-production`, install
`cloudflared`, and publish only `staging.max-users.online` first.

**Step 5: Verify staging**

Check:

- Cloudflare HTTPS;
- invalid Telegram request denied;
- admin Telegram login;
- MAX login;
- chat list/history;
- text and synthetic media;
- live private notification;
- narrow/wide UI;
- process restart recovery;
- no content on disk;
- VLESS/Hysteria2/WireGuard unchanged.

**Step 6: Commit deployment record**

Commit only redacted version/hash/verification results. Never commit server
credentials.

---

## Task 20: Pilot, production cutover and cleanup

**Files:**

- Create: `docs/runbooks/operations.md`
- Create: `docs/runbooks/reauthentication.md`
- Create: `docs/runbooks/max-compatibility-break.md`
- Create: `docs/runbooks/incident-response.md`
- Create: `docs/releases/<release-id>.md`

**Step 1: Owner pilot**

Run the owner's Telegram/MAX account for a full test cycle. Confirm messages and
media manually and inspect redacted logs.

**Step 2: One-friend pilot**

Approve one trusted friend. Verify simultaneously:

- no cross-user chat IDs or events;
- separate notification settings;
- independent reauthentication;
- stable memory.

**Step 3: Production route**

Add `max-users.online` to the tunnel and update the Telegram Mini App button.
Verify the root domain from Telegram, not only a normal browser.

**Step 4: Observe**

During the pilot period monitor:

- API/worker health;
- Chromium count and memory;
- reconnect/circuit-breaker counts;
- notification delivery;
- disk and runtime directory;
- VPN listeners.

No content-level telemetry is introduced.

**Step 5: Retire insecure components**

Only after all gates pass:

- stop and disable the old PM2 app;
- remove LocalTunnel from the deployed old project;
- confirm port 3000 is no longer listening publicly;
- enable the reviewed firewall rules;
- retain one recoverable old release without its plaintext `.env`;
- rotate the Telegram bot token if audit evidence shows it may have been
  exposed.

**Step 6: Final verification**

Run:

```text
HTTPS domain and Cloudflare tunnel healthy
invalid Telegram initData rejected
approved users isolated
10-session load gate passed
no content in durable storage
automatic recovery passed
TCP 443 VLESS healthy
UDP 443 Hysteria2 healthy
UDP 51820 WireGuard healthy
SSH healthy
port 3000 closed
```

**Step 7: Commit**

```bash
git add docs/runbooks docs/releases
git commit -m "docs: record production rollout and recovery runbooks"
```

---

## Execution checkpoints requiring the user

Implementation may proceed autonomously except for:

1. entering or approving a real MAX phone code/QR;
2. CAPTCHA, if MAX presents one;
3. authenticating to Cloudflare or authorizing browser control for tunnel
   creation;
4. the one-friend pilot;
5. final production cutover after staging evidence is shown.

No password, OTP or Cloudflare tunnel token should be sent in ordinary Telegram
messages or committed to the repository.

## Final acceptance gate

Do not report completion unless all criteria from the approved design and Task
20 pass with fresh command output. If a MAX feature cannot be implemented
because web MAX does not expose it, report the exact verified limitation instead
of substituting a placeholder or simulated success.
