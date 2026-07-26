import { MediaMessage } from "./MediaMessage.js";
import type { MessengerMessage } from "./types.js";

type MessageBubbleProps = Readonly<{
  message: MessengerMessage;
  showSender?: boolean;
}>;

export function MessageBubble({
  message,
  showSender = false
}: MessageBubbleProps) {
  const kind = message.kind ?? "text";
  const isMedia = kind === "image" || kind === "video" ||
    kind === "voice" || kind === "file";
  return (
    <article className={`message message--${message.direction}`}>
      {showSender && message.senderName !== undefined && (
        <strong>{message.senderName}</strong>
      )}
      {isMedia && message.media !== undefined && (
        <MediaMessage kind={kind} media={message.media} />
      )}
      {message.text.length > 0 && <p>{message.text}</p>}
      <time dateTime={message.sentAt}>
        {message.formattedTime ?? formatMessageTime(message.sentAt)}
      </time>
    </article>
  );
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
