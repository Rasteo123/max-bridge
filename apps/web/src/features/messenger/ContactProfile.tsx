import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { pushBackHandler } from "./back-navigation.js";
import type { MessengerChat } from "./types.js";
import { VerifiedBadge } from "./VerifiedBadge.js";

type ContactProfileProps = Readonly<{
  chat: MessengerChat;
  subtitle: string;
  onClose(): void;
  onSubscribe?(chat: MessengerChat): void;
  onUnsubscribe?(chat: MessengerChat): void;
  busy?: boolean;
}>;

const KIND_LABEL: Readonly<Record<MessengerChat["kind"], string>> = {
  direct: "Контакт",
  group: "Группа",
  channel: "Канал"
};

export function ContactProfile({
  chat,
  subtitle,
  onClose,
  onSubscribe,
  onUnsubscribe,
  busy = false
}: ContactProfileProps) {
  const joined = chat.joined === true;
  const membership = joined ? onUnsubscribe : onSubscribe;
  const closeRef = useRef<() => void>(onClose);
  closeRef.current = onClose;

  useEffect(() => pushBackHandler(() => {
    closeRef.current();
  }), []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      data-no-swipe
      data-testid="contact-profile"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="profile-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-profile-title"
      >
        <span className="profile-card__avatar">
          {chat.avatarUrl === undefined ? (
            <span aria-hidden="true">{initialsFor(chat.title)}</span>
          ) : (
            <img src={chat.avatarUrl} alt="" />
          )}
        </span>
        <h2 id="contact-profile-title">
          {chat.title}
          {chat.verified === true && <VerifiedBadge />}
        </h2>
        <p className="profile-card__subtitle">{subtitle}</p>
        {membership !== undefined && chat.kind !== "direct" && (
          <button
            className={joined
              ? "modal__action modal__action--quiet"
              : "modal__action modal__action--primary"}
            type="button"
            disabled={busy}
            onClick={() => {
              membership(chat);
            }}
          >
            {busy
              ? "Подождите…"
              : joined
                ? "Отписаться"
                : "Подписаться"}
          </button>
        )}
        <dl className="profile-card__facts">
          <div>
            <dt>Тип</dt>
            <dd>{KIND_LABEL[chat.kind]}</dd>
          </div>
          {chat.link !== undefined && (
            <div>
              <dt>Ссылка</dt>
              <dd>
                <a href={chat.link} target="_blank" rel="noreferrer noopener">
                  {chat.link.replace(/^https:\/\//u, "")}
                </a>
              </dd>
            </div>
          )}
          {chat.membersCount !== undefined && (
            <div>
              <dt>{chat.kind === "channel" ? "Подписчики" : "Участники"}</dt>
              <dd>
                {new Intl.NumberFormat("ru-RU").format(chat.membersCount)}
              </dd>
            </div>
          )}
          <div>
            <dt>Уведомления</dt>
            <dd>{chat.muted ? "Выключены" : "Включены"}</dd>
          </div>
        </dl>
        <button
          className="modal__action"
          type="button"
          onClick={onClose}
        >
          Закрыть
        </button>
      </div>
    </div>,
    document.body
  );
}

function initialsFor(title: string): string {
  return title
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");
}
