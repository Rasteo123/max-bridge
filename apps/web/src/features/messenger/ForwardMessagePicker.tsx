import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";

import type { MessageSendResult } from "../../api/client.js";
import type { MessengerChat } from "./types.js";

type ForwardMessagePickerProps = Readonly<{
  chats: readonly MessengerChat[];
  onConfirm(destinationIds: readonly string[]): Promise<MessageSendResult>;
  onClose(): void;
}>;

type ForwardState =
  | "idle"
  | "sending"
  | "confirmed"
  | "ambiguous"
  | "failed";

export function ForwardMessagePicker({
  chats,
  onConfirm,
  onClose
}: ForwardMessagePickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [state, setState] = useState<ForwardState>("idle");
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized.length === 0
      ? chats
      : chats.filter((chat) =>
        `${chat.title}\n${chat.preview}\n${chatKindLabel(chat.kind)}`
          .toLocaleLowerCase("ru-RU")
          .includes(normalized)
      );
  }, [chats, query]);
  const isSending = state === "sending";

  async function confirm(): Promise<void> {
    if (selected.length < 1 || selected.length > 10 || isSending) {
      return;
    }
    setState("sending");
    try {
      const result = await onConfirm(selected);
      setState(result.state);
    } catch {
      setState("failed");
    }
  }

  function toggle(chatId: string): void {
    setState("idle");
    setSelected((current) => {
      if (current.includes(chatId)) {
        return current.filter((value) => value !== chatId);
      }
      return current.length >= 10 ? current : [...current, chatId];
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !isSending) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled])"
    );
    if (focusable === undefined || focusable.length < 1) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="forward-picker-backdrop">
      <div
        ref={dialogRef}
        className="forward-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-picker-title"
        onKeyDown={handleKeyDown}
      >
        <header>
          <h2 id="forward-picker-title">Переслать сообщение</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            disabled={isSending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Найти чат или канал"
          aria-label="Найти чат или канал"
          disabled={isSending}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
        <div className="forward-picker__list">
          {visibleChats.map((chat) => {
            const checked = selected.includes(chat.id);
            return (
              <label key={chat.id} className="forward-picker__chat">
                <span className="forward-picker__avatar" aria-hidden="true">
                  {initialsFor(chat.title)}
                </span>
                <span>
                  <strong>{chat.title}</strong>
                  <small>{chat.preview || chatKindLabel(chat.kind)}</small>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    isSending || (selected.length >= 10 && !checked)
                  }
                  onChange={() => {
                    toggle(chat.id);
                  }}
                />
              </label>
            );
          })}
          {visibleChats.length === 0 && (
            <p className="forward-picker__empty">Ничего не найдено</p>
          )}
        </div>
        <footer>
          <span aria-live="polite">
            {state === "confirmed" && "Сообщение переслано"}
            {state === "ambiguous" &&
              "MAX не подтвердил пересылку. Проверьте чат перед повтором."}
            {state === "failed" &&
              "Не удалось переслать сообщение."}
            {state === "sending" && "Пересылаем…"}
            {state === "idle" && selected.length > 0 &&
              `Выбрано: ${String(selected.length)}`}
          </span>
          {state === "confirmed" ? (
            <button type="button" onClick={onClose}>Готово</button>
          ) : (
            <button
              type="button"
              disabled={selected.length < 1 || isSending}
              onClick={() => {
                void confirm();
              }}
            >
              {state === "ambiguous" || state === "failed"
                ? "Повторить пересылку"
                : "Переслать"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function initialsFor(title: string): string {
  return title.trim().slice(0, 2).toLocaleUpperCase("ru-RU") || "MAX";
}

function chatKindLabel(kind: MessengerChat["kind"]): string {
  if (kind === "channel") {
    return "Канал";
  }
  if (kind === "group") {
    return "Группа";
  }
  return "Чат";
}
