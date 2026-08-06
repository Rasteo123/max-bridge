import type { ReactionEmoji } from "./types.js";

/**
 * The POPULAR reaction section of MAX, in the order the web client shows it.
 * Captured from opcode 27/28 rather than invented, so the picker matches what
 * the recipient sees in MAX itself.
 */
export const MAX_REACTIONS: readonly ReactionEmoji[] = [
  "👍", "❤️", "🤣", "🔥", "😭", "😍", "👌", "💩",
  "💯", "😁", "✅", "😡", "🎉", "👎", "😱", "🤮",
  "💔", "🤩", "💀", "🤟", "🤡", "😎", "🙄", "😐",
  "🤯", "🤪", "😉", "🤤", "😇", "😘", "🥰", "🥳",
  "🌚", "🌝", "😴", "😈", "🤬", "🫠", "🤔", "🫡",
  "😳", "🥱", "😢", "🐱", "🐶", "💪", "🤞", "👋",
  "👏", "🤝", "🙏", "💋", "👑", "🍷", "🍑", "⚡️",
  "🤷‍♀️", "🤷‍♂️", "👩‍❤️‍👨", "🦄", "👻", "⛄️", "🎄", "🎅",
  "🗿", "👀", "👁️", "🖤", "❤️‍🩹", "🛑", "❓", "❗️",
  "🚀", "🇷🇺"
];

/** The row shown before the picker is expanded. */
export const QUICK_REACTION_COUNT = 6;

export function quickReactions(
  selected: readonly ReactionEmoji[]
): readonly ReactionEmoji[] {
  const head = MAX_REACTIONS.slice(0, QUICK_REACTION_COUNT);
  // A reaction already on the message stays reachable without expanding.
  const missing = selected.filter((emoji) => !head.includes(emoji));
  return missing.length === 0
    ? head
    : [...missing, ...head].slice(0, QUICK_REACTION_COUNT);
}
