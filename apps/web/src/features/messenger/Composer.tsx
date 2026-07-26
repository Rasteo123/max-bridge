import {
  type FormEvent,
  useState
} from "react";

type ComposerProps = Readonly<{
  disabled?: boolean;
  onSend(text: string): void;
}>;

export function Composer({
  disabled = false,
  onSend
}: ComposerProps) {
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (message.length === 0 || disabled) {
      return;
    }
    onSend(message);
    setText("");
  }

  return (
    <form className="composer" onSubmit={submit}>
      <button
        className="composer__attach"
        type="button"
        aria-label="Прикрепить файл"
        data-no-swipe
        disabled={disabled}
      >
        <span aria-hidden="true">＋</span>
      </button>
      <label className="composer__field">
        <span className="sr-only">Сообщение</span>
        <textarea
          rows={1}
          value={text}
          placeholder="Сообщение"
          aria-label="Сообщение"
          data-no-swipe
          disabled={disabled}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        />
      </label>
      <button
        className="composer__send"
        type="submit"
        aria-label="Отправить"
        data-no-swipe
        disabled={disabled || text.trim().length === 0}
      >
        <span aria-hidden="true">➤</span>
      </button>
    </form>
  );
}
