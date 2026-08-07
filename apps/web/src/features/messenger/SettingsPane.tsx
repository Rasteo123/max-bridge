import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { pushBackHandler } from "./back-navigation.js";
import { CHAT_FOLDERS } from "./chat-folders.js";
import type {
  MessengerChat,
  MessengerTheme
} from "./types.js";

export type MessengerDeviceSession = Readonly<{
  client: string;
  info: string;
  location: string;
  seenAt: string;
  current: boolean;
}>;

export type MessengerAccountSettings = Readonly<{
  profile: Readonly<{
    title: string;
    avatarUrl?: string;
    description?: string;
    link?: string;
  }>;
  sessions: readonly MessengerDeviceSession[];
  blocked: readonly MessengerChat[];
}>;

export type NotificationPreferences = Readonly<{
  messagePreview: boolean;
  sound: boolean;
  groupNotifications: boolean;
}>;

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  messagePreview: true,
  sound: true,
  groupNotifications: true
};

type SettingsPaneProps = Readonly<{
  settings?: MessengerAccountSettings;
  loading: boolean;
  failed?: boolean;
  theme: MessengerTheme;
  onThemeChange(theme: MessengerTheme): void;
  notifications: NotificationPreferences;
  onNotificationsChange(next: NotificationPreferences): void;
  onClose(): void;
  onLogout?(): void;
}>;

type Section =
  | "root"
  | "folders"
  | "security"
  | "devices"
  | "notifications"
  | "appearance"
  | "about";

const SECTION_TITLE: Readonly<Record<Section, string>> = {
  root: "Настройки",
  folders: "Папки",
  security: "Безопасность",
  devices: "Устройства",
  notifications: "Уведомления",
  appearance: "Оформление",
  about: "О приложении"
};

const THEMES: readonly (readonly [MessengerTheme, string])[] = [
  ["system", "Системная"],
  ["light", "Светлая"],
  ["dark", "Тёмная"]
];

/**
 * The account screen, laid out the way MAX lays out its own: the sections it
 * has, in the order it has them. What the bridge can read over the protocol is
 * shown as it is; what belongs to this client alone is editable here.
 */
export function SettingsPane({
  settings,
  loading,
  failed = false,
  theme,
  onThemeChange,
  notifications,
  onNotificationsChange,
  onClose,
  onLogout
}: SettingsPaneProps) {
  const [section, setSection] = useState<Section>("root");
  const closeRef = useRef<() => void>(onClose);
  const sectionRef = useRef<Section>(section);
  closeRef.current = onClose;
  sectionRef.current = section;

  useEffect(() => pushBackHandler(() => {
    if (sectionRef.current === "root") {
      closeRef.current();
      return;
    }
    setSection("root");
  }), []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (sectionRef.current === "root") {
        closeRef.current();
        return;
      }
      setSection("root");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return createPortal(
    <section
      className="settings-pane"
      data-no-swipe
      data-testid="settings-pane"
      aria-label={SECTION_TITLE[section]}
    >
      <header className="settings-pane__header">
        <button
          className="icon-button"
          type="button"
          aria-label={section === "root" ? "Закрыть настройки" : "Назад"}
          onClick={() => {
            if (section === "root") {
              onClose();
              return;
            }
            setSection("root");
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <h2>{SECTION_TITLE[section]}</h2>
      </header>
      <div className="settings-pane__scroll">
        {section === "root" && (
          <>
            <div className="settings-profile">
              <span className="settings-profile__avatar">
                {settings?.profile.avatarUrl === undefined ? (
                  <span aria-hidden="true">
                    {initialsFor(settings?.profile.title ?? "?")}
                  </span>
                ) : (
                  <img src={settings.profile.avatarUrl} alt="" />
                )}
              </span>
              <div>
                <p className="settings-profile__name">
                  {loading && settings === undefined
                    ? "Загружаем…"
                    : settings?.profile.title ?? "Профиль"}
                </p>
                {settings?.profile.description !== undefined && (
                  <p className="settings-profile__bio">
                    {settings.profile.description}
                  </p>
                )}
                {settings?.profile.link !== undefined && (
                  <a
                    className="settings-profile__link"
                    href={settings.profile.link}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {settings.profile.link.replace(/^https:\/\//u, "")}
                  </a>
                )}
              </div>
            </div>
            {failed && (
              <p className="empty-state">Не удалось загрузить профиль</p>
            )}
            <nav className="settings-list" aria-label="Разделы настроек">
              {([
                ["folders", "Папки"],
                ["security", "Безопасность"],
                ["devices", "Устройства"],
                ["notifications", "Уведомления"],
                ["appearance", "Оформление"],
                ["about", "О приложении"]
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  className="settings-list__item"
                  type="button"
                  onClick={() => {
                    setSection(id);
                  }}
                >
                  <span>{label}</span>
                  <span
                    className="settings-list__value"
                    aria-hidden="true"
                  >
                    {sectionHint(id, settings)}
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
              <a
                className="settings-list__item"
                href="https://help.max.ru/?source=web"
                target="_blank"
                rel="noreferrer noopener"
              >
                <span>Помощь</span>
                <span aria-hidden="true">↗</span>
              </a>
            </nav>
            {onLogout !== undefined && (
              <button
                className="settings-logout"
                type="button"
                onClick={onLogout}
              >
                Выйти из MAX
              </button>
            )}
          </>
        )}

        {section === "folders" && (
          <>
            <p className="settings-hint">
              Папки переключаются свайпом по списку чатов.
            </p>
            <ul className="settings-rows">
              {CHAT_FOLDERS.map((folder) => (
                <li key={folder.id}>{folder.label}</li>
              ))}
            </ul>
          </>
        )}

        {section === "security" && (
          <>
            <p className="settings-hint">
              Настройки приватности меняются в приложении MAX. Здесь видно, кого
              вы заблокировали.
            </p>
            <h3 className="settings-subtitle">Чёрный список</h3>
            {settings === undefined ? (
              <p className="empty-state">
                {loading ? "Загружаем…" : "Нет данных"}
              </p>
            ) : settings.blocked.length === 0 ? (
              <p className="empty-state">Чёрный список пуст</p>
            ) : (
              <ul className="settings-rows">
                {settings.blocked.map((contact) => (
                  <li key={contact.id}>{contact.title}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {section === "devices" && (
          settings === undefined ? (
            <p className="empty-state">
              {loading ? "Загружаем…" : "Нет данных"}
            </p>
          ) : settings.sessions.length === 0 ? (
            <p className="empty-state">Активных сессий нет</p>
          ) : (
            <ul className="settings-devices">
              {settings.sessions.map((device, index) => (
                <li key={`${device.client}-${String(index)}`}>
                  <p className="settings-devices__name">
                    {device.client}
                    {device.current && (
                      <span className="settings-devices__badge">
                        этот сеанс
                      </span>
                    )}
                  </p>
                  <p className="settings-devices__meta">{device.info}</p>
                  <p className="settings-devices__meta">{device.location}</p>
                  <p className="settings-devices__meta">
                    {formatSeenAt(device.seenAt)}
                  </p>
                </li>
              ))}
            </ul>
          )
        )}

        {section === "notifications" && (
          <fieldset className="settings-toggles">
            <legend className="sr-only">Уведомления</legend>
            {([
              ["messagePreview", "Предпросмотр сообщения"],
              ["sound", "Звук"],
              ["groupNotifications", "Уведомления групп и каналов"]
            ] as const).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  onChange={(event) => {
                    onNotificationsChange({
                      ...notifications,
                      [key]: event.currentTarget.checked
                    });
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {section === "appearance" && (
          <fieldset className="settings-toggles">
            <legend className="sr-only">Тема</legend>
            {THEMES.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="settings-theme"
                  checked={theme === value}
                  onChange={() => {
                    onThemeChange(value);
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {section === "about" && (
          <>
            <p className="settings-hint">
              MAX в Telegram — мост к вашему аккаунту MAX. Сообщения,
              звонки и данные остаются в MAX.
            </p>
            <ul className="settings-rows">
              <li>
                <a
                  href="https://max.ru/business_bot"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  MAX для бизнеса
                </a>
              </li>
              <li>
                <a
                  href="https://help.max.ru/?source=web"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Помощь
                </a>
              </li>
            </ul>
          </>
        )}
      </div>
    </section>,
    document.body
  );
}

function sectionHint(
  section: Section,
  settings: MessengerAccountSettings | undefined
): string {
  if (section === "devices") {
    return settings === undefined || settings.sessions.length === 0
      ? ""
      : String(settings.sessions.length);
  }
  if (section === "security" && settings !== undefined) {
    return settings.blocked.length === 0
      ? ""
      : String(settings.blocked.length);
  }
  return "";
}

function formatSeenAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function initialsFor(title: string): string {
  return title
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");
}
