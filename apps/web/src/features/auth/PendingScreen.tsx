type PendingScreenProps = Readonly<{
  kind: "pending" | "disabled" | "outside" | "error";
}>;

const copy = {
  pending: {
    title: "Ожидаем подтверждения",
    body: "Доступ открывается вручную. Попросите владельца «Круга друзей» подтвердить ваш Telegram-аккаунт."
  },
  disabled: {
    title: "Доступ отключён",
    body: "Этот Telegram-аккаунт больше не имеет доступа к приложению."
  },
  outside: {
    title: "Откройте через Telegram",
    body: "Откройте приложение из доверенного Telegram-бота."
  },
  error: {
    title: "Не удалось войти",
    body: "Закройте Mini App, откройте его снова из бота и повторите попытку."
  }
} as const;

export function PendingScreen({ kind }: PendingScreenProps) {
  const content = copy[kind];
  return (
    <main className="centered-page">
      <section className="auth-card" aria-live="polite">
        <div className="brand-mark" aria-hidden="true">КД</div>
        <p className="eyebrow">Круг друзей</p>
        <h1>{content.title}</h1>
        <p className="muted">{content.body}</p>
        <p className="privacy-note">
          Мы не сохраняем ваши сообщения и изображения.
        </p>
      </section>
    </main>
  );
}
