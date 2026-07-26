import { Composer } from "./Composer.js";
import type {
  MessengerChat,
  MessengerMessage
} from "./types.js";

type ConversationProps = Readonly<{
  chat?: MessengerChat;
  messages: readonly MessengerMessage[];
  wide: boolean;
  onOpenChats(): void;
  onSend(text: string): void;
}>;

export function Conversation({
  chat,
  messages,
  wide,
  onOpenChats,
  onSend
}: ConversationProps) {
  return (
    <section
      className="conversation"
      data-testid="conversation"
      aria-label={chat === undefined ? "Переписка" : `Переписка с ${chat.title}`}
    >
      <header className="conversation__header">
        {!wide && (
          <button
            className="conversation__back"
            type="button"
            onClick={onOpenChats}
            aria-label="Открыть список чатов"
          >
            <span aria-hidden="true">‹</span>
            <span>Чаты</span>
          </button>
        )}
        <div className="conversation__identity">
          <strong>{chat?.title ?? "Выберите чат"}</strong>
          {chat !== undefined && <span>MAX</span>}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Действия чата"
          data-no-swipe
        >
          <span aria-hidden="true">•••</span>
        </button>
      </header>
      <div className="conversation__messages">
        {chat === undefined ? (
          <div className="conversation__placeholder">
            <div aria-hidden="true">💬</div>
            <p>Выберите чат, чтобы открыть переписку</p>
          </div>
        ) : (
          <>
            <div className="day-divider"><span>Сегодня</span></div>
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message message--${message.direction}`}
              >
                {message.senderName !== undefined && (
                  <strong>{message.senderName}</strong>
                )}
                <p>{message.text}</p>
                <time>{message.sentAt}</time>
              </article>
            ))}
          </>
        )}
      </div>
      <Composer disabled={chat === undefined} onSend={onSend} />
    </section>
  );
}
