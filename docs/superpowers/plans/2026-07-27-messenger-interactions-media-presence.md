# Messenger Interactions, Media, Presence, and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add swipe-to-reply, a full-screen image/video gallery, direct-contact presence and last-seen time, outgoing delivery receipts, header avatars, and reliable desktop/mobile attachment sending.

**Architecture:** Keep MAX as the source of truth. The worker extracts presence, direction, acknowledgement state, and performs attachment UI automation; core schemas and adapters normalize that data; the React client renders it and owns only transient interaction state. New gesture and media-transform logic live in focused hooks so message navigation, context menus, and media controls remain isolated and testable. MAX Bridge is not called because this Mini App runs inside Telegram, and MAX Bot API is not treated as personal-account access. MAX UI components and design tokens may be reused in presentation tasks when they preserve the approved messenger behavior.

**Tech Stack:** TypeScript, React 19, Fastify, Playwright, TypeBox, Vitest, Testing Library, CSS, systemd release deployment.

---

## Official platform compatibility checkpoint

Before Tasks 3, 4, 6, 7, and 8, compare the implementation surface with the
current official documentation:

- use Telegram WebApp host APIs for signed initialization, lifecycle events,
  stable viewport, safe areas, back navigation, themes, and haptics;
- use MAX UI selectively for compatible visual primitives and theme tokens,
  with regression tests proving that gestures and the responsive layout remain
  unchanged;
- use MAX Bot API only for bot-owned operations; never use it as a substitute
  for the requesting user's personal MAX session;
- do not use MAX Bridge `shareMaxContent` as the attachment path because the
  Mini App is not hosted inside MAX and the operation shares bot messages.

If an official component or method does not cover the approved personal-chat
behavior, keep the isolated worker implementation and document the unsupported
boundary instead of silently changing product semantics.

## File structure

**Create**

- `apps/web/src/features/auth/telegram.test.ts` — Telegram theme and host-capability coverage.
- `apps/web/src/features/messenger/useSwipeToReply.ts` — message-local horizontal gesture state and reply threshold.
- `apps/web/src/features/messenger/swipe-to-reply.test.tsx` — gesture conflict and threshold coverage.
- `apps/web/src/features/messenger/useMediaTransform.ts` — image scale/translation math and pointer tracking.
- `apps/web/src/features/messenger/MediaViewer.tsx` — accessible image/video modal.
- `apps/web/src/features/messenger/MediaViewer.test.tsx` — viewer interaction coverage.
- `apps/web/src/features/messenger/RichMessageText.tsx` — safe caption text and link rendering.
- `apps/web/src/features/messenger/RichMessageText.test.tsx` — caption/link/emoji coverage.
- `apps/web/src/features/messenger/ForwardMessagePicker.tsx` — searchable forward destination picker.
- `apps/web/src/features/messenger/ForwardMessagePicker.test.tsx` — selection and confirmation coverage.

**Modify**

- `packages/core/src/domain/chat.ts` — strict presence and last-message direction fields.
- `packages/core/src/domain/message.ts` — strict forwarded source and rich-caption fields.
- `packages/core/src/domain/domain.test.ts` — schema acceptance/rejection.
- `packages/max-adapter/src/adapters/chat-list-adapter.ts` — normalized presence, direction, and last-message status.
- `packages/max-adapter/src/adapters/history-adapter.ts` — normalize additional MAX acknowledgement variants.
- `packages/max-adapter/src/adapters/adapters.test.ts` — adapter fixtures for presence and receipts.
- `apps/worker/src/max/max-web-page-session.ts` — extract MAX state and target the correct attachment input.
- `apps/worker/src/max/max-web-page-session.test.ts` — attachment stage and snapshot behavior.
- `apps/web/src/features/auth/telegram.ts` — Telegram host capabilities and theme application.
- `apps/web/src/features/auth/AuthGate.tsx` — bootstrap and live theme subscription.
- `apps/web/src/api/socket.ts` — resumable authenticated live socket.
- `apps/web/src/api/socket.test.ts` — pause/resume and reauthentication coverage.
- `apps/web/src/features/messenger/useLiveEvents.ts` — activated/deactivated socket lifecycle.
- `apps/web/src/features/messenger/live-events.test.tsx` — host lifecycle and store behavior.
- `apps/web/src/features/messenger/types.ts` — web-facing presence and upload state.
- `apps/web/src/features/messenger/MessageBubble.tsx` — reply gesture and outgoing receipt.
- `apps/web/src/features/messenger/MediaMessage.tsx` — open viewer instead of inline-only playback.
- `apps/web/src/features/messenger/Conversation.tsx` — avatar/presence header and viewer ownership.
- `apps/web/src/features/messenger/ChatRow.tsx` — online dot and last-message receipt.
- `apps/web/src/features/messenger/Composer.tsx` — upload progress/error/retry UI.
- `apps/web/src/features/messenger/ConnectedMessenger.tsx` — attachment state and stale-presence handling.
- `apps/web/src/features/messenger/MessengerShell.tsx` — pass connection state and remove visible back button behavior.
- `apps/web/src/features/messenger/ChatRow.test.tsx` — presence and receipt rendering.
- `apps/web/src/features/messenger/ConnectedMessenger.test.tsx` — upload success/retry and reconnect behavior.
- `apps/web/src/features/messenger/messenger-store.ts` — clear presence while disconnected.
- `apps/web/src/features/messenger/messenger.css` — gesture, modal, header, presence, receipts, and upload styles.
- `apps/api/src/routes/messages.test.ts` — attachment isolation and cleanup assertions.
- `apps/worker/src/runtime/request-handler.test.ts` — attachment request remains session-scoped.
- `packages/protocol/src/commands.ts` — session-scoped message-forward operation.
- `packages/protocol/src/messages.ts` — strict forward request/response payload.
- `apps/api/src/runtime/bridge-runtime-gateway.ts` — per-user forward routing.
- `apps/api/src/routes/messages.ts` — authenticated forward endpoint.

## Task 1: Extend strict chat and message normalization

**Files:**

- Modify: `packages/core/src/domain/chat.ts`
- Modify: `packages/core/src/domain/domain.test.ts`
- Modify: `packages/max-adapter/src/adapters/chat-list-adapter.ts`
- Modify: `packages/max-adapter/src/adapters/history-adapter.ts`
- Modify: `packages/max-adapter/src/adapters/adapters.test.ts`

- [ ] **Step 1: Write failing core and adapter tests**

Add schema assertions that accept a direct chat with presence and outgoing
delivery state, reject unknown presence values, and normalize MAX variants:

```ts
expect(parseChatSummary({
  id: "42",
  kind: "direct",
  title: "Ольга",
  preview: "До встречи",
  timestamp: "2026-07-27T10:00:00.000Z",
  unreadCount: 0,
  muted: false,
  presence: "online",
  lastMessageDirection: "outgoing",
  deliveryStatus: "read"
})).toMatchObject({
  presence: "online",
  lastMessageDirection: "outgoing",
  deliveryStatus: "read"
});

expect(() => parseChatSummary({
  id: "42",
  kind: "direct",
  title: "Ольга",
  preview: "",
  timestamp: "2026-07-27T10:00:00.000Z",
  unreadCount: 0,
  muted: false,
  presence: "maybe"
})).toThrow();
```

In `adapters.test.ts`, use a chat whose `recipient.online` is true and whose
last message has the viewer as sender plus `status: "READ"`. Assert the adapted
chat is `online`, `outgoing`, and `read`. Add history cases for `ACKNOWLEDGED`,
`DELIVERED`, `SEEN`, and failure.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts packages/core/src/domain/domain.test.ts packages/max-adapter/src/adapters/adapters.test.ts
```

Expected: FAIL because `presence` and `lastMessageDirection` are rejected or
missing and acknowledgement variants still become `sent`.

- [ ] **Step 3: Add the schema fields and normalization helpers**

Add to `chat.ts`:

```ts
export const PresenceSchema = Type.Union([
  Type.Literal("online"),
  Type.Literal("offline"),
  Type.Literal("unknown")
]);

export const LastMessageDirectionSchema = Type.Union([
  Type.Literal("incoming"),
  Type.Literal("outgoing")
]);

// Inside ChatSummarySchema:
presence: Type.Optional(PresenceSchema),
lastMessageDirection: Type.Optional(LastMessageDirectionSchema),
```

Export their static types. In `chat-list-adapter.ts`, derive:

```ts
const lastSenderId = readOpaqueId(
  lastMessage ?? {},
  "sender",
  "senderId",
  "authorId"
);
const viewerId = readOpaqueId(chat, "viewerId");
const lastMessageDirection = lastSenderId === undefined || viewerId === undefined
  ? undefined
  : lastSenderId === viewerId ? "outgoing" as const : "incoming" as const;
const presence = chatKind(chat) !== "direct"
  ? undefined
  : readWireBoolean(chat, "online", "isOnline") === true
    ? "online" as const
    : readWireBoolean(chat, "online", "isOnline") === false
      ? "offline" as const
      : "unknown" as const;
```

Extract the delivery normalization into a shared local helper that maps
`PENDING`, `SENT`, `ACKNOWLEDGED`, `DELIVERED`, `SEEN`, `READ`, and failure
variants to the existing `DeliveryStatus`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command.

Expected: both files PASS with no schema diagnostics.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/domain/chat.ts packages/core/src/domain/domain.test.ts packages/max-adapter/src/adapters/chat-list-adapter.ts packages/max-adapter/src/adapters/history-adapter.ts packages/max-adapter/src/adapters/adapters.test.ts
git commit -m "feat: normalize MAX presence and receipts"
```

## Task 2: Extract presence and receipts from the MAX worker

**Files:**

- Modify: `apps/worker/src/max/max-web-page-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.test.ts`

- [ ] **Step 1: Write failing worker snapshot tests**

Build a fake `page.evaluate` result that includes viewer ID, a direct recipient,
and a last message:

```ts
const page = {
  on: vi.fn(),
  evaluate: vi.fn().mockResolvedValue({
    viewerId: "7",
    chats: [{
      id: "42",
      type: "DIALOG",
      title: "Ольга",
      viewerId: "7",
      online: true,
      lastMessage: {
        id: "m1",
        senderId: "7",
        status: "READ",
        time: 1_785_148_800_000,
        text: "До встречи"
      }
    }]
  })
};
```

Stub `ensureAdapter()` with the real adapter or a capturing adapter. Assert
`listChats()` returns `presence: "online"`,
`lastMessageDirection: "outgoing"`, and `deliveryStatus: "read"`. Add a second
case where no trusted online field exists and expect `unknown`.

- [ ] **Step 2: Run the worker test and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/worker/src/max/max-web-page-session.test.ts
```

Expected: FAIL because the worker snapshot does not contain `viewerId`,
`online`, last-message sender, or last-message status.

- [ ] **Step 3: Extend the browser-side snapshot**

Within the existing `page.evaluate` callback, include:

```ts
const recipient = record(chat["recipient"] ?? raw?.["recipient"]);
const recipientRaw = record(recipient?.["$"]);
const onlineValue =
  boolean(recipient?.["online"])
  ?? boolean(recipient?.["isOnline"])
  ?? boolean(recipientRaw?.["online"])
  ?? boolean(recipientRaw?.["isOnline"]);

return {
  id,
  viewerId,
  // existing fields
  ...(onlineValue === undefined ? {} : { online: onlineValue }),
  lastMessage: last === undefined ? undefined : {
    id: opaque(last["id"]),
    senderId: opaque(last["sender"] ?? last["senderId"] ?? last["authorId"]),
    status: text(last["status"] ?? last["deliveryStatus"] ?? last["ack"]),
    time: temporal(last["time"]),
    text: richText(last["text"]),
    attaches: attachments(last["attaches"])
  }
};
```

Add a strict `boolean(value): boolean | undefined` helper that accepts only
actual booleans. Do not treat “last seen” timestamps or an open chat as online.
Pass the fields to `adaptChatList`.

For history messages, preserve raw acknowledgement/status fields in the object
handed to `adaptHistoryPage`; do not default an unknown MAX value to `read`.

- [ ] **Step 4: Run the worker and adapter tests**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/worker/src/max/max-web-page-session.test.ts packages/max-adapter/src/adapters/adapters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/max/max-web-page-session.ts apps/worker/src/max/max-web-page-session.test.ts
git commit -m "feat: capture MAX presence and acknowledgements"
```

## Task 2A: Align the web client with the Telegram Mini App lifecycle

**Files:**

- Create: `apps/web/src/features/auth/telegram.test.ts`
- Modify: `apps/web/src/features/auth/telegram.ts`
- Modify: `apps/web/src/features/auth/AuthGate.tsx`
- Modify: `apps/web/src/api/socket.ts`
- Modify: `apps/web/src/api/socket.test.ts`
- Modify: `apps/web/src/features/messenger/useLiveEvents.ts`
- Modify: `apps/web/src/features/messenger/live-events.test.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.test.tsx`

- [ ] **Step 1: Write failing host-lifecycle tests**

Cover the official Telegram host contract:

- `themeChanged` reapplies current theme params and cleanup calls `offEvent`
  with the same callback;
- `deactivated` stops the authenticated live socket and publishes
  `disconnected`;
- `activated` reauthenticates using the current signed `initData`, restarts the
  socket, and triggers a current-data refresh callback exactly once;
- repeated activation does not create duplicate sockets;
- a missing capability on older Telegram versions is a safe no-op;
- no Telegram identity, token, or reconnect material is written to browser
  storage.

Keep the existing server-side HMAC and `auth_date` tests unchanged: signed
`initData`, not `initDataUnsafe`, remains the only identity source.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/auth/telegram.test.ts apps/web/src/api/socket.test.ts apps/web/src/features/messenger/live-events.test.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx
```

Expected: FAIL because the Telegram interface has no event methods and the live
socket does not pause or resume from host lifecycle events.

- [ ] **Step 3: Implement capability-guarded host integration**

Extend `TelegramWebApp` with only the documented capabilities used here:
`onEvent`, `offEvent`, `isActive`, `viewportStableHeight`, `BackButton`,
`HapticFeedback`, `isVersionAtLeast`, and optional full-screen methods. Keep
them optional so older clients remain supported.

In `AuthGate`, keep the existing early `ready()` and `expand()` calls, apply
the initial theme, subscribe to `themeChanged`, and remove the exact callback on
cleanup.

Give `AuthenticatedSocket` idempotent pause/resume semantics. Pause must cancel
timers and close the current socket without expiring authentication. Resume must
reauthenticate once before reconnecting. In `useLiveEvents`, subscribe to
`deactivated` and `activated`; deactivate pauses the socket, and activate
resumes it and requests a fresh chat/history snapshot through an injected
callback. Wire that callback in `ConnectedMessenger` to refresh the chat list
and currently selected chat history exactly once without marking messages read.
Remove both listeners and stop the socket on unmount.

Do not keep a live connection while Telegram reports the Mini App inactive.
Do not automatically mark MAX messages read as part of activation or refresh.

- [ ] **Step 4: Run focused and regression tests**

Run the Step 2 command plus:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/telegram-bootstrap.test.ts apps/api/src/auth/telegram-init-data.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/telegram.test.ts apps/web/src/features/auth/telegram.ts apps/web/src/features/auth/AuthGate.tsx apps/web/src/api/socket.ts apps/web/src/api/socket.test.ts apps/web/src/features/messenger/useLiveEvents.ts apps/web/src/features/messenger/live-events.test.tsx apps/web/src/features/messenger/ConnectedMessenger.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx
git commit -m "fix: follow Telegram Mini App lifecycle"
```

## Task 2B: Extract and normalize trusted MAX last-seen time

**Files:**

- Modify: `packages/core/src/domain/chat.ts`
- Modify: `packages/core/src/domain/domain.test.ts`
- Modify: `packages/max-adapter/src/adapters/chat-list-adapter.ts`
- Modify: `packages/max-adapter/src/adapters/adapters.test.ts`
- Modify: `apps/worker/src/max/max-web-page-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.test.ts`

- [ ] **Step 1: Record the inspected MAX contract and write failing tests**

The current public `web.max.ru` client model was inspected without reading
private content. It defines:

- `recipient.presence.status`: `0` offline, `1` online, `2` was recently,
  `3` was long ago;
- `recipient.presence.isOnline`: explicit boolean derived from status `1`;
- `recipient.presence.seen`: epoch milliseconds;
- `recipient.presence.$.seen`: epoch seconds, converted by MAX with `* 1000`.

Add failing core/adapter/worker tests that require:

- `lastSeenAt` is accepted only as a finite epoch-millisecond number within
  reasonable bounds;
- presence status `0/1/2/3` normalizes to
  `offline/online/recently/long_ago`;
- `lastSeenAt` is omitted for online, recently, long-ago, unknown, group, and
  channel summaries;
- it is read only from the authenticated `recipient.presence.seen` path or its
  observed raw `recipient.presence.$.seen` seconds form;
- message timestamps, preview timestamps, open-chat state, and local clock
  receipt time never populate it;
- only the verified raw `$` field is converted from seconds; ambiguous units
  and boolean-like strings are rejected.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts packages/core/src/domain/domain.test.ts packages/max-adapter/src/adapters/adapters.test.ts apps/worker/src/max/max-web-page-session.test.ts
```

Expected: FAIL because `lastSeenAt` is not present in the strict schema,
adapter, or worker snapshot.

- [ ] **Step 3: Implement the smallest trusted projection**

Extend `PresenceSchema` with `recently` and `long_ago`; add optional
`lastSeenAt` to `ChatSummary`. The adapter keeps the timestamp only for an
explicitly offline direct chat and rejects non-finite, negative, future-skewed,
or implausibly old values.

Extend the page-side snapshot with a bounded projection of the exact MAX
presence fields listed in Step 1. Preserve existing explicit boolean aliases as
compatibility inputs, but prefer the observed nested presence object. Do not
enumerate or clone the full recipient object, do not fall back to DOM text, and
do not infer last seen from any message field.

- [ ] **Step 4: Run focused and regression tests**

Run the Step 2 command plus:

```bash
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/chat.ts packages/core/src/domain/domain.test.ts packages/max-adapter/src/adapters/chat-list-adapter.ts packages/max-adapter/src/adapters/adapters.test.ts apps/worker/src/max/max-web-page-session.ts apps/worker/src/max/max-web-page-session.test.ts
git commit -m "feat: preserve MAX last seen time"
```

## Task 3: Render presence, avatars, and delivery indicators

**Files:**

- Modify: `apps/web/src/features/messenger/types.ts`
- Modify: `apps/web/src/features/messenger/ChatRow.tsx`
- Modify: `apps/web/src/features/messenger/ChatRow.test.tsx`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/ContextMenus.test.tsx`
- Modify: `apps/web/src/features/messenger/Conversation.tsx`
- Modify: `apps/web/src/features/messenger/MessengerShell.tsx`
- Modify: `apps/web/src/features/auth/telegram.ts`
- Modify: `apps/web/src/features/messenger/messenger-store.ts`
- Modify: `apps/web/src/features/messenger/live-events.test.tsx`
- Modify: `apps/web/src/features/messenger/messenger.css`

- [ ] **Step 1: Write failing rendering tests**

In `ChatRow.test.tsx`, render:

```tsx
<ChatRow
  chat={{
    ...chat(),
    avatarUrl: "https://i.oneme.ru/avatar",
    presence: "online",
    lastMessageDirection: "outgoing",
    deliveryStatus: "read"
  }}
  selected={false}
  onSelect={vi.fn()}
/>
```

Assert an image, `aria-label="В сети"`, and
`aria-label="Последнее сообщение прочитано"` with two checks. Add an incoming
case and assert no receipt.

Add conversation-header tests with a fixed clock. For an offline direct chat
whose trusted `lastSeenAt` is five minutes or two hours old, assert visible
localized subtitles `5 мин назад` and `2 ч назад`. Assert the explicit privacy
states render `Был(-а) недавно` and `Был(-а) давно`. Advance the fake clock
across a minute boundary and assert the value updates while active. Assert no
last-seen subtitle for online/unknown presence, groups, channels, malformed
timestamps, or reconnecting/disconnected state.

In `ContextMenus.test.tsx`, render outgoing messages for every status and assert
labels `Отправляется`, `Отправлено`, `Доставлено`, `Прочитано`, and
`Не отправлено`. Render an incoming message with `read` and assert none.

In a new conversation assertion, verify the avatar precedes the identity title
and no visible button named `Открыть список чатов` remains.
On a narrow selected-chat view, assert Telegram's native `BackButton` is shown,
its click calls `onOpenChats`, and it is hidden with the exact callback removed
when the list is visible or the component unmounts. Assert safe-area and stable
viewport variables are used by the shell/composer styles.

- [ ] **Step 2: Run the web tests and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/ChatRow.test.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/swipe.test.tsx
```

Expected: FAIL on missing presence, receipt, header avatar, and remaining back
button behavior.

- [ ] **Step 3: Add focused presentation components**

Add fields to `MessengerChat`:

```ts
presence?: "online" | "offline" | "recently" | "long_ago" | "unknown";
lastSeenAt?: number;
lastMessageDirection?: "incoming" | "outgoing";
```

Inside `ChatRow`, place:

```tsx
{chat.kind === "direct" && chat.presence === "online" && (
  <span className="presence-dot" aria-label="В сети" />
)}
```

Render the last receipt only when
`chat.lastMessageDirection === "outgoing"`. Add a small local
`DeliveryIndicator` component reused by `ChatRow` and `MessageBubble`:

```tsx
function DeliveryIndicator({ status }: { status: DeliveryStatus }) {
  const view = {
    pending: ["◷", "Отправляется"],
    sent: ["✓", "Отправлено"],
    delivered: ["✓", "Доставлено"],
    read: ["✓✓", "Прочитано"],
    failed: ["!", "Не отправлено"]
  }[status] as readonly [string, string];
  return <span className="delivery-indicator" aria-label={view[1]}>{view[0]}</span>;
}
```

Move it to `DeliveryIndicator.tsx` if importing it into both components would
otherwise create a component dependency cycle.

Replace the narrow back button with avatar/identity markup. Keep
`onOpenChats()` available for the pane gesture but do not render the old button.
For an explicitly offline direct chat with a trusted `lastSeenAt`, render a
localized relative subtitle below the title using MAX's current thresholds:
`Только что`, `N мин назад`, `N ч назад`, yesterday with time, then date.
Render `Был(-а) недавно` and `Был(-а) давно` for the corresponding explicit MAX
privacy states. Update timestamp-based labels on a minute-aligned timer while
the Mini App is active and clear that timer on deactivate or unmount. Never
derive the timestamp from a message.
Mirror the selected narrow-pane state to Telegram's native `BackButton` through
capability-guarded `show`, `hide`, `onClick`, and `offClick` calls. Use
`--tg-viewport-stable-height`, `--tg-safe-area-inset-*`, and
`--tg-content-safe-area-inset-*` with browser fallbacks for the messenger shell,
header, and composer.

Before introducing a local presentation primitive, compare it with the current
MAX UI package. Reuse a compatible MAX UI primitive or design token (notably
avatar/online-dot, input, button, spinner, or panel) only when focused tests
prove that it does not change DOM accessibility, gestures, or the approved
responsive layout. Do not import the full stylesheet merely to restyle custom
message bubbles.

When store connection becomes reconnecting/disconnected, map chat presence to
`unknown` and remove `lastSeenAt` before publishing the snapshot.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command plus:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/live-events.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/types.ts apps/web/src/features/messenger/ChatRow.tsx apps/web/src/features/messenger/ChatRow.test.tsx apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/Conversation.tsx apps/web/src/features/messenger/MessengerShell.tsx apps/web/src/features/auth/telegram.ts apps/web/src/features/messenger/messenger-store.ts apps/web/src/features/messenger/live-events.test.tsx apps/web/src/features/messenger/messenger.css
git commit -m "feat: show MAX presence and delivery receipts"
```

## Task 4: Add message swipe-to-reply without gesture conflicts

**Files:**

- Create: `apps/web/src/features/messenger/useSwipeToReply.ts`
- Create: `apps/web/src/features/messenger/swipe-to-reply.test.tsx`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/messenger.css`

- [ ] **Step 1: Write the failing gesture tests**

Render `MessageBubble` with `onReply={vi.fn()}` and fire pointer sequences:

```ts
fireEvent.pointerDown(message, pointer(180, 100, 1));
fireEvent.pointerMove(message, pointer(116, 103, 1));
expect(message).toHaveStyle({ "--reply-drag": "-64px" });
fireEvent.pointerUp(message, pointer(116, 103, 1));
expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
```

Add separate tests for 40 px snap-back, vertical movement, pointer cancel,
`data-no-swipe` media control, multi-touch cancellation, one haptic call after
crossing the threshold, and no duplicate haptic while staying armed.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/swipe-to-reply.test.tsx
```

Expected: FAIL because the test file imports a missing hook or the bubble does
not move.

- [ ] **Step 3: Implement the hook**

Define:

```ts
export function useSwipeToReply(options: Readonly<{
  disabled: boolean;
  onReply(): void;
  onArmed?(): void;
}>): Readonly<{
  dragging: boolean;
  armed: boolean;
  style: CSSProperties;
  handlers: Pick<JSX.IntrinsicElements["article"],
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;
}>
```

Use constants `REPLY_THRESHOLD = 56`, `REPLY_MAX = 84`, and
`AXIS_LOCK_DISTANCE = 8`. Start only for primary button/pointer, ignore targets
inside `[data-no-swipe]`, lock after directional intent is clear, and call
`preventDefault()` only after horizontal lock. Call `onReply()` once on release
while armed, then reset.

In `MessageBubble`, merge the reply handlers with long-press handlers
explicitly rather than overwriting either set, apply the CSS variable, and add:

```tsx
<span className="message__reply-swipe-icon" aria-hidden="true">↩</span>
```

Call the official
`Telegram.WebApp.HapticFeedback.impactOccurred("light")` through a guarded
utility passed as `onArmed`. The utility must be a no-op outside Telegram or on
an older host that does not expose the capability; it must not invoke MAX
Bridge or browser vibration as an identity-independent fallback.

- [ ] **Step 4: Run reply and navigation gesture tests**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/swipe-to-reply.test.tsx apps/web/src/features/messenger/swipe.test.tsx apps/web/src/features/messenger/ContextMenus.test.tsx
```

Expected: PASS; existing conversation navigation and context menus remain
green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/useSwipeToReply.ts apps/web/src/features/messenger/swipe-to-reply.test.tsx apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/messenger.css
git commit -m "feat: add swipe to reply"
```

## Task 5: Build deterministic image transform behavior

**Files:**

- Create: `apps/web/src/features/messenger/useMediaTransform.ts`
- Create: `apps/web/src/features/messenger/useMediaTransform.test.ts`

- [ ] **Step 1: Write failing pure transform tests**

Test exported helpers:

```ts
expect(clampScale(0.5)).toBe(1);
expect(clampScale(8)).toBe(5);
expect(scaleFromWheel(2, -100, true)).toBeGreaterThan(2);
expect(scaleFromWheel(2, 100, true)).toBeLessThan(2);
expect(pinchScale(2, 100, 150)).toBe(3);
expect(clampTranslation({ x: 500, y: -500 }, {
  scale: 2,
  viewportWidth: 300,
  viewportHeight: 400,
  mediaWidth: 300,
  mediaHeight: 200
})).toEqual({ x: 150, y: 0 });
```

Also test that unmodified vertical wheel leaves scale unchanged and resetting
returns `{ scale: 1, x: 0, y: 0 }`. Translation limits must use the actual
scaled-media overflow relative to the viewport:
`max(0, (mediaSize * scale - viewportSize) / 2)`, so media that still fits a
viewport on one axis cannot be panned to expose blank space.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/useMediaTransform.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement transform helpers and hook**

Use:

```ts
export const MIN_MEDIA_SCALE = 1;
export const MAX_MEDIA_SCALE = 5;

export function clampScale(value: number): number {
  return Math.min(MAX_MEDIA_SCALE, Math.max(MIN_MEDIA_SCALE, value));
}

export function pinchScale(
  initialScale: number,
  initialDistance: number,
  currentDistance: number
): number {
  if (initialDistance <= 0) return initialScale;
  return clampScale(initialScale * currentDistance / initialDistance);
}
```

The hook owns a `Map<number, Point>` for active pointers, records the initial
two-pointer distance, pans one pointer only when `scale > 1`, recognizes
control-modified wheel events as trackpad pinch, and exposes `zoomIn`,
`zoomOut`, `toggleZoom`, and `reset`.

- [ ] **Step 4: Run and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/useMediaTransform.ts apps/web/src/features/messenger/useMediaTransform.test.ts
git commit -m "feat: add image transform controls"
```

## Task 6: Add the accessible full-screen media viewer and gallery

**Files:**

- Create: `apps/web/src/features/messenger/MediaViewer.tsx`
- Create: `apps/web/src/features/messenger/MediaViewer.test.tsx`
- Create: `apps/web/src/features/messenger/useMediaCarousel.ts`
- Create: `apps/web/src/features/messenger/useMediaCarousel.test.ts`
- Modify: `apps/web/src/features/messenger/MediaMessage.tsx`
- Modify: `apps/web/src/features/messenger/MediaMessage.test.ts`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/Conversation.tsx`
- Modify: `apps/web/src/features/auth/telegram.ts`
- Modify: `apps/web/src/features/messenger/messenger.css`

- [ ] **Step 1: Write failing modal tests**

Render an image message and click `Открыть изображение`. Assert:

```ts
expect(screen.getByRole("dialog", { name: "Просмотр изображения" }))
  .toBeVisible();
fireEvent.click(screen.getByRole("button", { name: "Увеличить" }));
expect(screen.getByTestId("media-viewer-image"))
  .toHaveStyle({ "--media-scale": "1.25" });
fireEvent.keyDown(document, { key: "Escape" });
expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
```

Add pinch pointer tests, control-wheel, double click, panning at scale > 1,
reset on source change, focus restoration, and a video test that finds native
controls but no image zoom toolbar.

Add carousel tests with three ordered mixed image/video items:

- a 72 px left-to-right drag follows the pointer and selects the previous item;
- a 72 px right-to-left drag selects the next item;
- a short drag and resisted first/last overscroll snap back;
- a fast, shorter horizontal flick can complete, while vertical intent cannot;
- navigation is disabled for a zoomed image and re-enabled at 1x;
- the bottom 64 px of the current video is reserved for native controls, while
  a horizontal drag above it navigates;
- ArrowLeft/ArrowRight and Previous/Next buttons share the same bounds;
- a slide change pauses the previous video, resets image transform, announces
  `N из M`, and adjacent images are preloaded;
- reduced-motion mode changes the transition, not the selected item.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/useMediaCarousel.test.ts apps/web/src/features/messenger/MediaViewer.test.tsx apps/web/src/features/messenger/MediaMessage.test.ts
```

Expected: FAIL because no viewer exists.

- [ ] **Step 3: Implement viewer ownership and rendering**

Change `MediaMessage` to call:

```ts
onOpen?: (input: Readonly<{
  kind: "image" | "video";
  url: string;
  alt: string;
}>) => void;
```

Render image/video thumbnails as buttons marked `data-no-swipe`. Keep inline
voice and file behavior unchanged.

`Conversation` derives a stable ordered gallery from the current chat's
messages, including only normalized `image` and `video` items with usable media
URLs. Every item has the source message ID, kind, URL, and accessible label.
Opening one item records its gallery index.

`Conversation` owns:

```ts
const [openMediaIndex, setOpenMediaIndex] = useState<number | null>(null);
```

Render `MediaViewer` with `createPortal(..., document.body)`. The viewer sets
`role="dialog"`, `aria-modal="true"`, restores the opener on cleanup, locks body
overflow, and stops pointer/wheel propagation. Render `<video controls
playsInline>` for videos. Render the transformed `<img draggable={false}>` and
zoom controls for images.

`useMediaCarousel` owns one primary pointer, horizontal/vertical axis lock,
offset, resisted edge overscroll, velocity, and bounded previous/next
selection. Use a 72 px completion threshold, an 8 px axis lock, and a bounded
fast-flick threshold. The viewer renders current and adjacent slides on a
transforming track so the content follows the pointer. The selected item stays
the single source of truth; slide change resets `useMediaTransform`, pauses the
old video, and updates an `aria-live` position label.

For video, ignore a pointer that starts in the bottom 64 px of the rendered
video bounds so native controls retain seeking/volume gestures. Image carousel
drag is disabled whenever its scale is greater than 1. Provide bounded
Previous/Next buttons and ArrowLeft/ArrowRight keyboard actions. Preload only
adjacent image URLs. Do not autoplay adjacent videos.

When `Telegram.WebApp.isVersionAtLeast("8.0")` and `requestFullscreen` are
available, the viewer may request Telegram full-screen mode from the user's
open action and call `exitFullscreen` during close. A rejection or unsupported
host must leave the in-app modal fully functional. Do not require Telegram
full-screen for native video playback, browser full-screen, zoom, or dismissal.

- [ ] **Step 4: Run viewer and message tests**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/useMediaCarousel.test.ts apps/web/src/features/messenger/MediaViewer.test.tsx apps/web/src/features/messenger/MediaMessage.test.ts apps/web/src/features/messenger/swipe-to-reply.test.tsx
```

Expected: PASS and media controls do not trigger reply.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/MediaViewer.tsx apps/web/src/features/messenger/MediaViewer.test.tsx apps/web/src/features/messenger/useMediaCarousel.ts apps/web/src/features/messenger/useMediaCarousel.test.ts apps/web/src/features/messenger/MediaMessage.tsx apps/web/src/features/messenger/MediaMessage.test.ts apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/Conversation.tsx apps/web/src/features/auth/telegram.ts apps/web/src/features/messenger/messenger.css
git commit -m "feat: add full screen media viewer"
```

## Task 6A: Preserve rich forwarded messages and navigate to their source

**Files:**

- Modify: `packages/core/src/domain/message.ts`
- Modify: `packages/core/src/domain/domain.test.ts`
- Modify: `packages/max-adapter/src/adapters/history-adapter.ts`
- Modify: `packages/max-adapter/src/adapters/adapters.test.ts`
- Modify: `apps/worker/src/max/max-web-page-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.test.ts`
- Modify: `apps/web/src/features/messenger/types.ts`
- Create: `apps/web/src/features/messenger/RichMessageText.tsx`
- Create: `apps/web/src/features/messenger/RichMessageText.test.tsx`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/ContextMenus.test.tsx`
- Modify: `apps/web/src/features/messenger/Conversation.tsx`
- Modify: `apps/web/src/features/messenger/MessengerShell.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.test.tsx`
- Modify: `apps/web/src/features/messenger/messenger-store.ts`
- Modify: `apps/web/src/features/messenger/messenger.css`

- [x] **Step 1: Inspect the real forwarded record and write failing fixtures**

In the authenticated `web.max.ru` page, inspect one forwarded image with a
caption/link/emoji and one forwarded video. Record only field names, element
roles/classes, attachment kinds, and safe synthetic examples in tests. Never
copy real message bodies, session data, phone numbers, or cookies.

Add failing worker/adapter/core tests that require:

- a strict `forwardedSource` containing bounded `title`, trusted `chatId`, and
  `kind: "direct" | "group" | "channel"` when MAX exposes them;
- the full caption text including emoji;
- safe link information from MAX text entities or rendered anchors;
- forwarded PHOTO and VIDEO attachments to keep their real media kind and
  caption;
- sticker/voice/file forwarding to keep the attachment type;
- an unrecognized attachment to become an explicit unsupported-attachment
  presentation, not a generic text message containing “Сообщение”.

Add web tests that click the forwarded source, preserve a safe caption link,
render emoji, and show an actionable error if the source cannot be opened.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts packages/core/src/domain/domain.test.ts packages/max-adapter/src/adapters/adapters.test.ts apps/worker/src/max/max-web-page-session.test.ts apps/web/src/features/messenger/RichMessageText.test.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx
```

Expected: FAIL because forwarded source identity, rich caption links, and some
forwarded media kinds are discarded and the source title is not interactive.

- [x] **Step 3: Extend strict message normalization**

Add a strict forwarded-source object to the message schema. Keep
`forwardedFrom` temporarily for backward compatibility, but derive it from the
source title when the new object exists.

Preserve the complete bounded caption text. Normalize only link entities
actually present in MAX data or the rendered message DOM. Represent links in a
strict, bounded shape that cannot contain `javascript:`, `data:`, credentials,
or a non-HTTPS external URL. Malformed ranges/segments fall back to plain text.
Emoji must remain intact; never slice inside a surrogate pair.

Extend the worker's history snapshot to extract source ID/kind from raw
forwarding records and, when necessary, from the numeric path of the rendered
“Перейти в канал” control. Preserve caption/entity data and all bounded
attachment records before the media adapter runs.

Teach the history adapter to use `caption` aliases for media text and to map
PHOTO/VIDEO/STICKER/AUDIO/FILE correctly. An unknown type produces an explicit
unsupported attachment/message state and a non-sensitive diagnostic category.

- [x] **Step 4: Add safe rendering and in-app source navigation**

`RichMessageText` renders plain text and allowlisted HTTPS links without
`dangerouslySetInnerHTML`; external links use `rel="noreferrer noopener"`.

Render the forwarded source title as a real button. Pass an
`onOpenForwardedSource` callback through Conversation/MessengerShell. When the
source chat already exists, select it and load history. When it is not in the
list, create a transient chat summary only from the normalized source object,
select it, and request history through the current authenticated client. On
404/inaccessible source, return to the original chat and show an error instead
of silently doing nothing.

- [x] **Step 5: Run focused and regression tests**

Run the Step 2 command plus:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/MediaMessage.test.ts apps/web/src/features/messenger/MediaViewer.test.tsx
```

Expected: PASS. Forwarded image/video captions render below the media, source
navigation works, and no false “Сообщение” placeholder remains.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/domain/message.ts packages/core/src/domain/domain.test.ts packages/max-adapter/src/adapters/history-adapter.ts packages/max-adapter/src/adapters/adapters.test.ts apps/worker/src/max/max-web-page-session.ts apps/worker/src/max/max-web-page-session.test.ts apps/web/src/features/messenger/types.ts apps/web/src/features/messenger/RichMessageText.tsx apps/web/src/features/messenger/RichMessageText.test.tsx apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/Conversation.tsx apps/web/src/features/messenger/MessengerShell.tsx apps/web/src/features/messenger/ConnectedMessenger.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx apps/web/src/features/messenger/messenger-store.ts apps/web/src/features/messenger/messenger.css
git commit -m "fix: preserve rich forwarded messages"
```

## Task 6B: Forward messages from the context menu

**Files:**

- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/protocol/src/protocol.test.ts`
- Modify: `packages/max-adapter/src/max-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.test.ts`
- Modify: `apps/worker/src/runtime/request-handler.ts`
- Modify: `apps/worker/src/runtime/request-handler.test.ts`
- Modify: `apps/api/src/runtime/bridge-runtime-gateway.ts`
- Modify: `apps/api/src/runtime/bridge-runtime-gateway.test.ts`
- Modify: `apps/api/src/routes/messages.ts`
- Modify: `apps/api/src/routes/messages.test.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/features/messenger/types.ts`
- Create: `apps/web/src/features/messenger/ForwardMessagePicker.tsx`
- Create: `apps/web/src/features/messenger/ForwardMessagePicker.test.tsx`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/ContextMenus.test.tsx`
- Modify: `apps/web/src/features/messenger/Conversation.tsx`
- Modify: `apps/web/src/features/messenger/MessengerShell.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.test.tsx`
- Modify: `apps/web/src/features/messenger/messenger.css`

- [x] **Step 1: Inspect MAX's native forwarding flow and write failing tests**

Using the authenticated MAX page, record the accessible sequence for
right-click/long-press “Переслать”, destination search/selection, confirmation,
and completion. Store only selectors and synthetic fixtures.

Add failing tests for:

- “Переслать” appearing on eligible incoming and outgoing message menus;
- a searchable picker with chat/channel rows and explicit confirmation;
- no action with zero selected destinations;
- cancel returning focus to the source message;
- protocol/API/worker payloads containing source chat ID, source message ID,
  destination IDs, and client request ID only;
- worker selection of the exact source message and native MAX forward action;
- confirmed and ambiguous results with no automatic retry;
- user A's gateway/session handle never serving user B's forward request.

- [x] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts packages/protocol/src/protocol.test.ts apps/worker/src/max/max-web-page-session.test.ts apps/worker/src/runtime/request-handler.test.ts apps/api/src/runtime/bridge-runtime-gateway.test.ts apps/api/src/routes/messages.test.ts apps/web/src/features/messenger/ForwardMessagePicker.test.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx
```

Expected: FAIL because no forward operation or picker exists.

- [x] **Step 3: Add strict session-scoped forwarding**

Add `message.forward` to the protocol with bounded opaque IDs, 1–10 unique
destination IDs, and a client request ID. Reject duplicates, extra identity
fields, session handles, URLs, text, and attachment bodies.

The API derives `userLookup` exclusively from the authenticated Telegram
principal and forwards the strict payload to that user's gateway/session.

The worker verifies the source chat, opens the exact source message's native
context menu, selects MAX's forward action, selects only the requested
destinations in the native picker, confirms once, and waits for bounded MAX
confirmation. Never fall back to copying/reuploading media and never retry an
ambiguous result.

- [x] **Step 4: Add the web picker and action state**

Add a context-menu action labelled “Переслать”. The picker filters the current
normalized chat/channel list, supports 1–10 selections, has Cancel and Forward
buttons, traps focus, and restores focus after close. Show sending, confirmed,
failed, and ambiguous states. Disable duplicate submission and require an
explicit user retry after failure/ambiguity.

- [x] **Step 5: Run focused and isolation tests**

Run the Step 2 command.

Expected: PASS with no cross-user session, source, or destination leakage.

- [x] **Step 6: Commit**

```bash
git add packages/protocol/src/commands.ts packages/protocol/src/messages.ts packages/protocol/src/protocol.test.ts packages/max-adapter/src/max-session.ts apps/worker/src/max/max-web-page-session.ts apps/worker/src/max/max-web-page-session.test.ts apps/worker/src/runtime/request-handler.ts apps/worker/src/runtime/request-handler.test.ts apps/api/src/runtime/bridge-runtime-gateway.ts apps/api/src/runtime/bridge-runtime-gateway.test.ts apps/api/src/routes/messages.ts apps/api/src/routes/messages.test.ts apps/web/src/api/client.ts apps/web/src/features/messenger/types.ts apps/web/src/features/messenger/ForwardMessagePicker.tsx apps/web/src/features/messenger/ForwardMessagePicker.test.tsx apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/Conversation.tsx apps/web/src/features/messenger/MessengerShell.tsx apps/web/src/features/messenger/ConnectedMessenger.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx apps/web/src/features/messenger/messenger.css
git commit -m "feat: forward MAX messages"
```

## Task 7: Target the correct MAX attachment control

**Files:**

- Modify: `apps/worker/src/max/max-web-page-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.test.ts`
- Modify: `apps/worker/src/runtime/request-handler.test.ts`

- [x] **Step 1: Write failing worker automation tests**

Create locator fakes for:

- an attachment-menu button named `Прикрепить`;
- menu items `Фото или видео` and `Файл`;
- two unrelated hidden file inputs;
- one dialog-scoped input revealed by the chosen mode;
- preview and send controls.

For `kind: "media"`, assert `Фото или видео` is clicked and only the
dialog-scoped input receives `setInputFiles`. For `kind: "file"`, assert `Файл`
is clicked. Add failure cases at `open_menu`, `select_mode`, `set_file`,
`wait_for_preview`, and `send`; each must clear pending confirmation.

- [x] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/worker/src/max/max-web-page-session.test.ts apps/worker/src/runtime/request-handler.test.ts
```

Expected: FAIL because the implementation uses
`locator('input[type="file"]').first()` without opening a mode.

- [x] **Step 3: Implement mode-scoped selection**

Add private helpers:

```ts
private async openAttachmentInput(
  kind: "media" | "file"
): Promise<Locator> {
  const before = await this.options.page.locator('input[type="file"]').count();
  await this.options.page
    .getByRole("button", { name: /прикрепить/i })
    .click({ timeout: MAX_ACTION_WAIT_MS });
  await this.options.page
    .getByRole("menuitem", {
      name: kind === "media" ? /фото|видео/i : /^файл$/i
    })
    .click({ timeout: MAX_ACTION_WAIT_MS });
  const dialog = this.options.page.getByRole("dialog").last();
  const scoped = dialog.locator('input[type="file"]');
  if (await scoped.count() > 0) return scoped.last();
  const all = this.options.page.locator('input[type="file"]');
  await all.nth(before).waitFor({ state: "attached", timeout: 5_000 });
  return all.nth(before);
}
```

Use exact selectors observed in the authenticated MAX page when they are more
stable than accessible names, but keep scoping to the newly opened UI. Replace
the global-first input in `sendAttachment`. Keep one pending-send confirmation
and never retry after an ambiguous result.

- [x] **Step 4: Run worker tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/max/max-web-page-session.ts apps/worker/src/max/max-web-page-session.test.ts apps/worker/src/runtime/request-handler.test.ts
git commit -m "fix: send MAX attachments through selected mode"
```

## Task 8: Add attachment progress, failure, and explicit retry

**Files:**

- Modify: `apps/web/src/features/messenger/types.ts`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.tsx`
- Modify: `apps/web/src/features/messenger/ConnectedMessenger.test.tsx`
- Modify: `apps/web/src/features/messenger/Composer.tsx`
- Modify: `apps/web/src/features/messenger/messenger.css`

- [ ] **Step 1: Write failing UI state tests**

Use a deferred `client.sendAttachment`. After choosing a file, assert
`Отправляем photo.jpg…`, disabled attachment selection, and no duplicate call.
Reject the promise and assert:

```ts
expect(screen.getByRole("alert"))
  .toHaveTextContent("Не удалось отправить photo.jpg");
fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
expect(client.sendAttachment).toHaveBeenCalledTimes(2);
```

Change chat and assert retry state disappears. Return `state: "ambiguous"` and
assert the UI says the result is unknown and requires deliberate retry, not an
automatic second call.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/ConnectedMessenger.test.tsx
```

Expected: FAIL because attachment errors are collapsed into the global action
banner and no retry file state exists.

- [ ] **Step 3: Implement attachment state**

Define:

```ts
export type AttachmentSendState =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "sending"; fileName: string }>
  | Readonly<{
      state: "failed";
      fileName: string;
      file: File;
      kind: "media" | "file";
      ambiguous: boolean;
    }>;
```

`ConnectedMessenger` owns this state, awaits `client.sendAttachment`, and
passes `attachmentState`, `onRetryAttachment`, and `onCancelAttachment` to the
composer. It clears state when selected chat ID changes. An ambiguous response
becomes a failed state with `ambiguous: true`; it does not retry.

`Composer` renders sending/error rows, disables the attach button while
sending, and exposes explicit Retry/Cancel buttons. Keep the existing 20 MB
label consistent with the API limit and reject oversized files before fetch
with a user-facing error.

- [ ] **Step 4: Run and verify GREEN**

Run the Step 2 command plus:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/swipe.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/types.ts apps/web/src/features/messenger/ConnectedMessenger.tsx apps/web/src/features/messenger/ConnectedMessenger.test.tsx apps/web/src/features/messenger/Composer.tsx apps/web/src/features/messenger/messenger.css
git commit -m "feat: show attachment progress and retry"
```

## Task 9: Verify API cleanup and per-user isolation

**Files:**

- Modify: `apps/api/src/routes/messages.test.ts`
- Modify: `apps/api/src/runtime/bridge-runtime-gateway.test.ts`
- Modify: `apps/web/src/features/messenger/live-events.test.tsx`

- [ ] **Step 1: Add failing isolation and cleanup assertions**

In `messages.test.ts`, send distinct byte buffers as two authenticated
principals and assert gateway calls retain their matching `userLookup` and
unique transient path. Make the gateway throw and assert the file is gone after
the response:

```ts
expect(gateway.attachmentCalls).toEqual([
  expect.objectContaining({ userLookup: "user-a" }),
  expect.objectContaining({ userLookup: "user-b" })
]);
for (const call of gateway.attachmentCalls) {
  await expect(access(call.filePath)).rejects.toMatchObject({ code: "ENOENT" });
}
```

In gateway tests, assert the session handle for user A is never used for user
B. In live-event tests, emit online/read updates into two stores and assert each
store sees only its own event.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/api/src/routes/messages.test.ts apps/api/src/runtime/bridge-runtime-gateway.test.ts apps/web/src/features/messenger/live-events.test.tsx
```

Expected: at least the new presence/status event assertions fail until all
fields are preserved and stale presence is cleared.

- [ ] **Step 3: Make the minimum boundary fixes**

Keep `principal.userLookup` as the only source of user identity in attachment
routes. Preserve normalized presence/status fields in WebSocket events. If any
shared cache key omits `userLookup`, change it to:

```ts
const cacheKey = `${userLookup}\u0000${chatId}\u0000${messageId}`;
```

Do not accept user identity in query strings, bodies, media handles, or client
request IDs.

- [ ] **Step 4: Run and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/messages.test.ts apps/api/src/runtime/bridge-runtime-gateway.test.ts apps/web/src/features/messenger/live-events.test.tsx
git commit -m "test: enforce attachment and presence isolation"
```

## Task 10: Full verification, real-device check, and deployment

**Files:**

- Modify only if a verification failure identifies a concrete defect.

- [ ] **Step 1: Run static verification**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both exit 0 with no errors.

- [ ] **Step 2: Run the supported automated suite**

Run:

```bash
npm test
```

Expected: all non-environment-dependent tests PASS. If Chromium or loopback
tests are blocked by the local sandbox, rerun the exact affected test with the
required permission and record the result; do not treat permission errors as
feature failures or silently ignore them.

- [ ] **Step 3: Build production artifacts**

Run:

```bash
npm run build
```

Expected: API and worker `dist/entrypoint.js` exist and Vite reports a completed
production build.

- [ ] **Step 4: Verify the authenticated MAX UI on Mac**

Using the existing signed-in `web.max.ru` tab:

1. Inspect the current attachment menu accessible names/selectors.
2. Send one small image, one short video, and one text file to Saved Messages.
3. Confirm each appears once in MAX and `sendAttachment` reports confirmed or
   explicitly ambiguous.
4. Inspect one online and one offline direct chat and compare the normalized
   presence.
5. Send an outgoing message, observe one check, have it read, and observe two.
6. Open a forwarded image and video with captions, links, and emoji; require the
   caption and media to remain together and the source button to open its
   chat/channel.
7. Forward one message from its context menu to Saved Messages and one other
   test chat; require exactly one native MAX forward in each destination.

Do not print session tokens, cookies, phone numbers, message bodies, or raw
private chat payloads.

- [ ] **Step 5: Verify touch behavior on the connected Android phone**

Use the Mini App to check:

1. right-to-left message drag follows the finger and arms after 56 px;
2. left-to-right conversation drag still returns to the chat list;
3. image pinch, pan, double tap, and reset;
4. with the image at 1x, drag right to the previous media and left to the next;
   require the current/neighbor slides to follow the finger, a short drag to
   return, and a completed drag to settle without a flash;
5. after zooming the image above 1x, require the same horizontal gesture to pan
   the image instead of changing slides;
6. video play, seek, and full screen; require a swipe above the native controls
   to change slides and a swipe on the lower control strip to seek normally;
7. gallery and document pickers both expose local files and send one item.
8. theme changes apply without reopening, safe areas protect the composer, and
   Telegram's native BackButton returns from a selected chat to the list;
9. minimizing the Mini App closes the live socket, and returning reauthenticates,
   reconnects, and refreshes without an endless “reconnecting” banner.
10. forwarded captions/links remain visible, source navigation works, and the
   context-menu forward picker can send to one selected destination.

Expected: no text selection during the reply gesture and no indefinite
“reconnecting” state.

- [ ] **Step 6: Push the verified commits**

If Step 1–5 identifies a defect, return to the task that owns that component,
add a failing regression test, complete its RED/GREEN cycle, and commit the
exact files named by that task before continuing here.

Push the completed branch:

```bash
git push origin feature/max-telegram-bridge
```

- [ ] **Step 7: Build and deploy an immutable release**

Package `git archive HEAD` plus the freshly built `dist` directories for API,
worker, web, core, MAX adapter, and protocol. Verify the archive SHA-256 on the
server. Install into a new release ID, confirm all required runtime files before
switching `/opt/maxbridge/current`, then restart API and worker. Start
Cloudflare Tunnel if it is not active.

- [ ] **Step 8: Verify production and preserve rollback**

Verify:

```bash
systemctl is-active maxbridge-api.service maxbridge-workers.service maxbridge-cloudflared.service
/opt/maxbridge/current/ops/scripts/health-check.sh
```

From outside the server, require `200` from `/health/live` and `/health/ready`,
confirm the HTML references the new asset, and compare that asset's SHA-256 to
the local production build. Inspect fresh API/worker logs for warnings. Keep the
previous release and encrypted database backup available for rollback.
