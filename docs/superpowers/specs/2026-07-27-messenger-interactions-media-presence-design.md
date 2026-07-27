# Messenger interactions, media, presence, and attachment design

## Goal

Bring the Mini App closer to the interaction model of Telegram and MAX without
embedding `web.max.ru` or weakening the per-user session boundary.

The release adds:

- swipe-to-reply on individual messages;
- a full-screen image and video viewer;
- online presence for direct contacts;
- avatars in the conversation header;
- outgoing delivery/read receipts in messages and chat previews;
- complete forwarded-message captions, links, emoji, media, and source navigation;
- forwarding an existing message from its context menu;
- reliable image, video, and file sending from desktop and mobile browsers.

## Scope decisions

- Presence is shown only for direct chats. Groups, channels, and Saved Messages
  never display an online dot.
- Delivery indicators are shown only for messages sent by the current user.
- The visible narrow-screen “Chats” button is removed. Narrow-screen navigation
  back to the chat list uses the existing interactive edge swipe.
- Media stays in MAX and is not persisted in the bridge database.
- MAX remains the source of truth for presence, delivery state, and attachment
  confirmation. The Mini App must not infer these states from local activity.

## Official MAX platform boundary

The official MAX developer surfaces are used only within their documented
authority:

- MAX Bridge (`window.WebApp`) is available to a Mini App launched inside MAX.
  This project is launched inside Telegram, so host integration such as back
  navigation, viewport, and haptics uses the Telegram Mini App API instead.
- MAX Bot API operates as the bot and does not grant access to a user's complete
  personal chat list or permission to send as that user. It therefore cannot
  replace the authenticated per-user MAX web session used by this bridge.
- MAX UI is evaluated for presentation primitives and design tokens such as
  avatars, online dots, panels, inputs, and theme adaptation. Custom messenger
  interactions (message bubbles, swipe gestures, media transforms, and the
  responsive two-pane layout) remain local when MAX UI has no matching
  component or would change established behavior.
- `shareMaxContent` is not an attachment-send path for this product: it is a MAX
  host capability for sharing a message previously sent by a bot. Attachments
  in this project must be sent from the user's isolated MAX session.

This boundary keeps the implementation compatible with the official
documentation without presenting an unsupported Bot API or MAX Bridge feature
as personal-account access.

## Telegram host integration

Telegram is the actual Mini App host, so the web client follows the official
Telegram Mini Apps lifecycle:

- only signed `Telegram.WebApp.initData` is sent to the server; the server
  validates its HMAC, timestamp, and signed user before deriving identity;
- `ready()` and `expand()` run during bootstrap;
- `themeChanged` reapplies Telegram theme variables without reloading;
- `deactivated` stops the live socket and clears transient online presence so a
  minimized or closed Mini App does not keep an active conversation view;
- `activated` reauthenticates with the current `initData`, reconnects the live
  socket, and refreshes the current MAX snapshot;
- `viewportStableHeight`, safe-area variables, and content-safe-area variables
  protect the conversation header and composer from Telegram and system chrome;
- Telegram's native `BackButton` mirrors the narrow-screen selected-chat state,
  while the in-content “Chats” button remains removed;
- official `HapticFeedback` is used behind a capability guard for gesture
  thresholds;
- vertical Telegram close/minimize swipes remain enabled because this design's
  navigation and reply gestures are horizontal.

The image/video viewer may request Telegram full-screen mode when the host
supports it, but it must retain the browser modal/native-video fallback.

## User interaction design

### Swipe to reply

Each message bubble accepts a horizontal drag from right to left.

- The bubble follows the pointer up to 84 px and exposes a reply icon on its
  right side.
- The gesture locks to the horizontal axis only after horizontal movement is
  greater than vertical movement.
- Crossing 56 px arms the action and triggers light Telegram haptic feedback
  when the API is available.
- Releasing while armed opens the existing reply composer for that message.
- Releasing before the threshold animates the bubble back to its origin.
- Pointer cancellation, a vertical scroll, multi-touch, controls marked
  `data-no-swipe`, and an open context menu cancel the gesture.
- Long press, text selection, reaction buttons, media controls, and the
  left-to-right conversation navigation swipe remain independent.

### Full-screen media viewer

Clicking or tapping an image or video opens an in-app modal above the messenger.
The modal traps focus, locks page scrolling, closes with Escape or the close
button, and restores focus to the originating message.

Images support:

- two-pointer pinch zoom;
- Mac trackpad pinch through control-modified wheel events;
- explicit zoom-in, zoom-out, and reset buttons;
- double tap or double click between 1x and 2.5x;
- panning while zoomed;
- a clamped scale from 1x to 5x;
- reset of scale and translation whenever the viewed media changes.

Videos use native playback controls, seeking, volume, picture-in-picture where
the host permits it, and the browser's system full-screen action. Pinch zoom is
limited to images so it cannot conflict with video controls.

The viewer is also an ordered image/video gallery for the current chat.

- Dragging from left to right reveals and selects the previous media item.
- Dragging from right to left reveals and selects the next media item.
- The current slide and its neighbor follow the pointer. Release beyond the
  distance/velocity threshold completes a short Telegram-style slide
  transition; otherwise both slides spring back.
- At the beginning/end, resisted overscroll returns to the current slide.
- Image gallery navigation is disabled while scale is above 1x, so the same
  gesture pans the zoomed image. Returning to 1x re-enables slide navigation.
- The lower native-control strip of a video keeps priority for seeking and
  volume. A horizontal drag elsewhere on the video or viewer navigates.
- Left/Right arrow keys and accessible Previous/Next buttons provide the same
  operation on desktop.
- Changing slides pauses the previous video, resets image transform, updates
  the position announcement, and preloads adjacent images.
- `prefers-reduced-motion` removes the sliding animation without changing
  navigation.

### Conversation and chat-list identity

The conversation header places the selected chat avatar immediately before the
title. If a direct contact is online, a green presence dot appears at the
avatar's bottom-right corner. The same dot is used on the contact's avatar in
the chat list.

The current MAX web model exposes contact presence as
`recipient.presence.status`, with `presence.seen` returning milliseconds from
the raw seconds value at `presence.$.seen`. Its four documented-in-client
states are offline, online, was recently, and was long ago.

If a direct contact is explicitly offline and MAX exposes a trusted last-seen
timestamp, the conversation subtitle follows MAX's current display behavior:
`Только что` below one minute, `N мин назад` below one hour, `N ч назад` on the
same day, then yesterday/date forms. It updates while the Mini App is active
without changing the underlying timestamp. MAX's privacy states render
`Был(-а) недавно` and `Был(-а) давно` without fabricating a timestamp. Groups
and channels never show a personal last-seen value.

If presence or last-seen data is unavailable, stale, malformed, or the bridge
is reconnecting, no dot or relative last-seen value is shown. Offline is
otherwise represented by the absence of the dot. Message activity, the last
message timestamp, an open conversation, and local receipt time are never used
to infer presence or last seen.

### Delivery indicators

Outgoing message metadata renders:

- `pending`: a small clock;
- `sent` or `delivered`: one check;
- `read`: two checks;
- `failed`: a visible failure mark.

The last-message preview in the chat list renders the same indicator only when
the last message belongs to the current user. Incoming previews do not display
checks.

### Attachment feedback

Choosing an attachment immediately closes the attachment menu and shows an
uploading state in the composer. While a file is in progress, duplicate
submission is disabled. A failed upload produces a human-readable error and a
retry action that reuses the still-local `File` object; cancelling or selecting
another chat clears that retry state.

### Rich forwarded messages

A forwarded message is rendered as one coherent message, not as a media-only
card plus a generic “Сообщение” placeholder.

- The worker preserves the source title, trusted source chat/channel ID and
  kind, complete caption text, safe link entities, emoji, and the supported
  attachment type.
- Image, video, sticker, voice, and file attachments retain their caption.
- Safe `https` links in captions are interactive; unsupported schemes and
  malformed entity ranges render as plain text.
- The forwarded source title is a button. Activating it opens the corresponding
  chat or channel inside the Mini App. If it is absent from the current list,
  the client creates a transient summary from the signed MAX snapshot and asks
  the requesting user's worker to open that trusted ID. A missing or inaccessible
  source produces a visible error instead of a silent no-op.
- Unknown attachment types render a descriptive unsupported-attachment state
  and diagnostic category, never the misleading generic word “Сообщение”.

The source identifier is accepted only from the authenticated MAX snapshot; it
is never taken from a client-supplied URL.

### Forward from the context menu

Every eligible message context menu includes “Переслать”.

1. The action opens a searchable chat/channel picker in the Mini App.
2. The user selects one or more destinations and explicitly confirms.
3. The API sends only source chat ID, source message ID, selected destination
   IDs, and a client request ID to that authenticated Telegram user's worker.
4. The worker uses MAX's native forward UI/action so attribution, caption,
   links, emoji, and media stay attached to the original message.
5. Each destination is confirmed once. An ambiguous result is displayed and is
   never automatically retried.

The operation cannot forward across worker sessions and cannot accept a session
handle or Telegram user identity from the request body.

## Data model and flow

`ChatSummary` gains:

- `presence: "online" | "offline" | "recently" | "long_ago" | "unknown"` for
  direct chats;
- `lastSeenAt?: number`, an authenticated MAX epoch-millisecond timestamp for
  explicitly offline direct contacts;
- `lastMessageDirection?: "incoming" | "outgoing"`;
- the existing `deliveryStatus` populated from MAX for the last message.

Messages continue to use the existing `status` field, but the worker and MAX
adapter must populate it from the raw message acknowledgement/read state rather
than from Mini App assumptions.

The MAX worker reads viewer identity, recipient presence, an explicit
recipient last-seen timestamp, last-message sender, and acknowledgement state
from the authenticated page session. The adapter normalizes raw MAX variants
into the strict core schemas. API and WebSocket events carry only normalized
values. A last-seen value is accepted only from the authenticated recipient
record and only after its unit and reasonable time bounds are validated.

Presence is refreshed whenever the worker produces a chat snapshot or receives
a relevant MAX update. When the worker connection is not healthy, the web store
treats presence as `unknown` and removes online dots and last-seen labels.

Every API and WebSocket lookup remains keyed by the authenticated Telegram
user. No presence, status, media handle, upload path, or retry state is shared
between users.

## Reliable attachment sending

The current worker selects the first file input in the MAX document. MAX has
multiple hidden file inputs, so this can target the wrong upload mode.

The corrected sequence is:

1. Activate and verify the requested chat.
2. Open MAX's attachment menu.
3. Select “Photo/video” for `kind=media` or “File” for `kind=file`.
4. Resolve the file input belonging to the newly opened menu/dialog, not the
   first input in the document.
5. Set the validated transient server file on that input.
6. Wait for MAX's attachment preview and enabled send control.
7. Send once and wait for the MAX message confirmation event.
8. Return `confirmed` with the message ID, or `ambiguous` after the existing
   bounded confirmation timeout. Never retry automatically.

The API accepts the raw request body only after Telegram authorization and
origin/CSRF checks. It writes the upload to a mode-0600 file below `/run`,
passes that exact path only to the requesting user's worker session, zeroes the
request buffer, and deletes the file and directory in a `finally` block.
Attachment contents are never written to SQLite.

## Error handling

- Gesture cancellation never triggers reply.
- A media fetch failure stays inside the viewer/message and does not break the
  conversation.
- Invalid media handles and non-allowlisted direct URLs remain rejected.
- A missing or malformed MAX presence/status value becomes `unknown`, not a
  guessed state.
- Attachment failures identify whether selection, preview, send, or
  confirmation failed in server diagnostics without logging file contents,
  phone numbers, Telegram init data, or MAX session material.
- Ambiguous sends are reported to the user and are not automatically repeated,
  preventing duplicate messages.

## Test strategy

Development follows red-green-refactor.

Automated coverage includes:

- message swipe threshold, axis lock, cancellation, and reply callback;
- no conflict between reply swipe, context menu, media controls, and
  conversation navigation;
- image modal open/close, pinch, wheel zoom, double activation, pan, clamping,
  focus restoration, and reset;
- video modal controls and absence of image-only zoom behavior;
- presence and avatar rendering for direct chats and absence for other kinds;
- stale presence removal during reconnect;
- message and chat-preview receipt rendering for every status and direction;
- strict core/adapter parsing of presence, direction, and status;
- attachment-menu mode selection and dialog-scoped file-input targeting;
- upload cleanup on success, rejection, timeout, and disconnect;
- authenticated per-user isolation for presence, statuses, media, and upload
  paths.

After automated checks, the release is tested against the authenticated MAX web
session on Mac. The connected Android phone is used for final touch checks:
reply swipe, navigation swipe, pinch zoom, video playback, gallery selection,
and document selection.

## Release and rollback

Lint, type checking, targeted tests, the full supported test suite, and the
production build must pass before commit. The exact commit is pushed to GitHub
and packaged with built runtime artifacts. Deployment uses a new immutable
release directory and switches `/opt/maxbridge/current` only after required
runtime files exist. API, worker, Cloudflare tunnel, internal health, external
health, and the published asset checksum are verified. The previous release
remains available for immediate rollback.

## Non-goals

- Embedding or proxying the entire MAX web interface.
- Fabricating online state from an open conversation.
- Showing read receipts on incoming messages.
- Persisting message or attachment bodies in the bridge database.
- Automatically retrying an attachment whose MAX confirmation is ambiguous.
