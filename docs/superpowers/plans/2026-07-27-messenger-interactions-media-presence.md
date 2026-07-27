# Messenger Interactions, Media, Presence, and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add swipe-to-reply, a full-screen image/video viewer, direct-contact presence, outgoing delivery receipts, header avatars, and reliable desktop/mobile attachment sending.

**Architecture:** Keep MAX as the source of truth. The worker extracts presence, direction, acknowledgement state, and performs attachment UI automation; core schemas and adapters normalize that data; the React client renders it and owns only transient interaction state. New gesture and media-transform logic live in focused hooks so message navigation, context menus, and media controls remain isolated and testable. MAX Bridge is not called because this Mini App runs inside Telegram, and MAX Bot API is not treated as personal-account access. MAX UI components and design tokens may be reused in presentation tasks when they preserve the approved messenger behavior.

**Tech Stack:** TypeScript, React 19, Fastify, Playwright, TypeBox, Vitest, Testing Library, CSS, systemd release deployment.

---

## Official platform compatibility checkpoint

Before Tasks 3, 4, 6, 7, and 8, compare the implementation surface with the
current official documentation:

- use Telegram WebApp host APIs for viewport, back navigation, and haptics;
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

- `apps/web/src/features/messenger/useSwipeToReply.ts` — message-local horizontal gesture state and reply threshold.
- `apps/web/src/features/messenger/swipe-to-reply.test.tsx` — gesture conflict and threshold coverage.
- `apps/web/src/features/messenger/useMediaTransform.ts` — image scale/translation math and pointer tracking.
- `apps/web/src/features/messenger/MediaViewer.tsx` — accessible image/video modal.
- `apps/web/src/features/messenger/MediaViewer.test.tsx` — viewer interaction coverage.

**Modify**

- `packages/core/src/domain/chat.ts` — strict presence and last-message direction fields.
- `packages/core/src/domain/domain.test.ts` — schema acceptance/rejection.
- `packages/max-adapter/src/adapters/chat-list-adapter.ts` — normalized presence, direction, and last-message status.
- `packages/max-adapter/src/adapters/history-adapter.ts` — normalize additional MAX acknowledgement variants.
- `packages/max-adapter/src/adapters/adapters.test.ts` — adapter fixtures for presence and receipts.
- `apps/worker/src/max/max-web-page-session.ts` — extract MAX state and target the correct attachment input.
- `apps/worker/src/max/max-web-page-session.test.ts` — attachment stage and snapshot behavior.
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

- [ ] **Step 5: Commit**

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

## Task 3: Render presence, avatars, and delivery indicators

**Files:**

- Modify: `apps/web/src/features/messenger/types.ts`
- Modify: `apps/web/src/features/messenger/ChatRow.tsx`
- Modify: `apps/web/src/features/messenger/ChatRow.test.tsx`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/ContextMenus.test.tsx`
- Modify: `apps/web/src/features/messenger/Conversation.tsx`
- Modify: `apps/web/src/features/messenger/MessengerShell.tsx`
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

In `ContextMenus.test.tsx`, render outgoing messages for every status and assert
labels `Отправляется`, `Отправлено`, `Доставлено`, `Прочитано`, and
`Не отправлено`. Render an incoming message with `read` and assert none.

In a new conversation assertion, verify the avatar precedes the identity title
and no visible button named `Открыть список чатов` remains.

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
presence?: "online" | "offline" | "unknown";
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
When store connection becomes reconnecting/disconnected, map chat presence to
`unknown` before publishing the snapshot.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command plus:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/live-events.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/types.ts apps/web/src/features/messenger/ChatRow.tsx apps/web/src/features/messenger/ChatRow.test.tsx apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/ContextMenus.test.tsx apps/web/src/features/messenger/Conversation.tsx apps/web/src/features/messenger/MessengerShell.tsx apps/web/src/features/messenger/messenger-store.ts apps/web/src/features/messenger/live-events.test.tsx apps/web/src/features/messenger/messenger.css
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

Call `Telegram.WebApp.HapticFeedback.impactOccurred("light")` through a guarded
utility passed as `onArmed`.

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
})).toEqual({ x: 150, y: -100 });
```

Also test that unmodified vertical wheel leaves scale unchanged and resetting
returns `{ scale: 1, x: 0, y: 0 }`.

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

## Task 6: Add the accessible full-screen media viewer

**Files:**

- Create: `apps/web/src/features/messenger/MediaViewer.tsx`
- Create: `apps/web/src/features/messenger/MediaViewer.test.tsx`
- Modify: `apps/web/src/features/messenger/MediaMessage.tsx`
- Modify: `apps/web/src/features/messenger/MediaMessage.test.ts`
- Modify: `apps/web/src/features/messenger/MessageBubble.tsx`
- Modify: `apps/web/src/features/messenger/Conversation.tsx`
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

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/MediaViewer.test.tsx apps/web/src/features/messenger/MediaMessage.test.ts
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

`Conversation` owns:

```ts
const [openMedia, setOpenMedia] = useState<ViewerMedia | null>(null);
```

Render `MediaViewer` with `createPortal(..., document.body)`. The viewer sets
`role="dialog"`, `aria-modal="true"`, restores the opener on cleanup, locks body
overflow, and stops pointer/wheel propagation. Render `<video controls
playsInline>` for videos. Render the transformed `<img draggable={false}>` and
zoom controls for images.

- [ ] **Step 4: Run viewer and message tests**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/web/src/features/messenger/MediaViewer.test.tsx apps/web/src/features/messenger/MediaMessage.test.ts apps/web/src/features/messenger/swipe-to-reply.test.tsx
```

Expected: PASS and media controls do not trigger reply.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/messenger/MediaViewer.tsx apps/web/src/features/messenger/MediaViewer.test.tsx apps/web/src/features/messenger/MediaMessage.tsx apps/web/src/features/messenger/MediaMessage.test.ts apps/web/src/features/messenger/MessageBubble.tsx apps/web/src/features/messenger/Conversation.tsx apps/web/src/features/messenger/messenger.css
git commit -m "feat: add full screen media viewer"
```

## Task 7: Target the correct MAX attachment control

**Files:**

- Modify: `apps/worker/src/max/max-web-page-session.ts`
- Modify: `apps/worker/src/max/max-web-page-session.test.ts`
- Modify: `apps/worker/src/runtime/request-handler.test.ts`

- [ ] **Step 1: Write failing worker automation tests**

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

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npx vitest run --config vitest.workspace.ts apps/worker/src/max/max-web-page-session.test.ts apps/worker/src/runtime/request-handler.test.ts
```

Expected: FAIL because the implementation uses
`locator('input[type="file"]').first()` without opening a mode.

- [ ] **Step 3: Implement mode-scoped selection**

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

- [ ] **Step 4: Run worker tests and verify GREEN**

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

Do not print session tokens, cookies, phone numbers, message bodies, or raw
private chat payloads.

- [ ] **Step 5: Verify touch behavior on the connected Android phone**

Use the Mini App to check:

1. right-to-left message drag follows the finger and arms after 56 px;
2. left-to-right conversation drag still returns to the chat list;
3. image pinch, pan, double tap, and reset;
4. video play, seek, and full screen;
5. gallery and document pickers both expose local files and send one item.

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
