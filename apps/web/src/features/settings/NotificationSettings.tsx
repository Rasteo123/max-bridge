import type { MessengerChat } from "../messenger/types.js";

export type NotificationSettingsValue = Readonly<{
  enabled: boolean;
  mutedChatIds: readonly string[];
  previewChatIds: readonly string[];
}>;

type NotificationSettingsProps = Readonly<{
  chats: readonly MessengerChat[];
  value: NotificationSettingsValue;
  disabled?: boolean;
  onChange(value: NotificationSettingsValue): void;
}>;

export function NotificationSettings({
  chats,
  value,
  disabled = false,
  onChange
}: NotificationSettingsProps) {
  return (
    <section className="notification-settings" aria-labelledby="notice-title">
      <h2 id="notice-title">Уведомления в Telegram</h2>
      <label>
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...value, enabled: event.currentTarget.checked });
          }}
        />
        Получать приватные уведомления
      </label>
      <p className="muted">
        По умолчанию уведомление содержит только имя отправителя и тип
        сообщения — без текста и файлов.
      </p>
      <ul className="notification-settings__chats">
        {chats.map((chat) => (
          <li key={chat.id}>
            <strong>{chat.title}</strong>
            <label>
              <input
                type="checkbox"
                checked={value.mutedChatIds.includes(chat.id)}
                disabled={disabled}
                onChange={(event) => {
                  onChange({
                    ...value,
                    mutedChatIds: toggleId(
                      value.mutedChatIds,
                      chat.id,
                      event.currentTarget.checked
                    )
                  });
                }}
              />
              Без Telegram-уведомлений
            </label>
            <label>
              <input
                type="checkbox"
                checked={value.previewChatIds.includes(chat.id)}
                disabled={disabled}
                onChange={(event) => {
                  onChange({
                    ...value,
                    previewChatIds: toggleId(
                      value.previewChatIds,
                      chat.id,
                      event.currentTarget.checked
                    )
                  });
                }}
              />
              Показывать текст сообщения в Telegram
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function toggleId(
  ids: readonly string[],
  id: string,
  enabled: boolean
): readonly string[] {
  return enabled
    ? [...new Set([...ids, id])]
    : ids.filter((value) => value !== id);
}
