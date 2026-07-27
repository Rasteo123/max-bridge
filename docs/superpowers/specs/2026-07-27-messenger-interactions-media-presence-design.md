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

### Conversation and chat-list identity

The conversation header places the selected chat avatar immediately before the
title. If a direct contact is online, a green presence dot appears at the
avatar's bottom-right corner. The same dot is used on the contact's avatar in
the chat list.

If presence is unavailable, stale, or the bridge is reconnecting, no dot is
shown. Offline is represented by the absence of the dot.

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

## Data model and flow

`ChatSummary` gains:

- `presence: "online" | "offline" | "unknown"` for direct chats;
- `lastMessageDirection?: "incoming" | "outgoing"`;
- the existing `deliveryStatus` populated from MAX for the last message.

Messages continue to use the existing `status` field, but the worker and MAX
adapter must populate it from the raw message acknowledgement/read state rather
than from Mini App assumptions.

The MAX worker reads viewer identity, recipient presence, last-message sender,
and acknowledgement state from the authenticated page session. The adapter
normalizes raw MAX variants into the strict core schemas. API and WebSocket
events carry only normalized values.

Presence is refreshed whenever the worker produces a chat snapshot or receives
a relevant MAX update. When the worker connection is not healthy, the web store
treats presence as `unknown` and removes online dots.

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
