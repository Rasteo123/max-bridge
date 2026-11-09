# Restore MAX sessions and keep message menus open

User request: automatically recover the MAX failure diagnosed on 2026-11-09, and fix message menus disappearing after opening.

## Session recovery

Evidence: the running worker reports authenticated but fails `chats.list`; a fresh browser with the same saved encrypted session returns 14 valid chats. Restarting the worker restored the application. Existing gateway recovery handles only `session_not_found`.

Approaches: restarting every worker would interrupt other accounts; reloading a page couples recovery to browser internals. Reopen only the affected user's worker session from the existing encrypted saved session in the gateway. Retry `chats.list` once after `worker_failure`. Share one recovery between concurrent requests, allow at most one reset per account per 60 seconds, and preserve logout/revocation generation checks. Restrict this recovery to active accounts. Never replay mutations after an ambiguous failure. Do not log session values or message data. Existing missing-session recovery remains supported.

Acceptance: a broken authenticated session becomes usable during the original chat-list request; repeated failures are bounded; concurrent reads share recovery; logout during recovery does not reopen or retry the revoked session; unrelated users and message sends retain their behavior.

## Context menus

Evidence: the menu currently dismisses on every captured document scroll, including its own reaction scroller and programmatic conversation scrolling. Investigate with component regressions and a real browser before choosing the smallest change.

Approaches: ignoring all dismissal loses normal controls; adding a timeout merely postpones the bug. Keep intentional outside tap, Escape, selecting an action, and changing chats; prevent incidental background/internal scrolling or keyboard viewport changes from dismissing the menu. Preserve existing appearance and keyboard navigation.

Acceptance: an idle open message menu survives background message updates and internal reaction scrolling; all deliberate dismissal paths still work.

## Delivery

Work in an isolated clone containing the currently deployed October compatibility changes. Run focused red/green regressions, full verify, and relevant browser tests. Review the combined patch. Publish the source and deploy a built release retaining the previous release for rollback, then verify the actual worker returns valid chats.
