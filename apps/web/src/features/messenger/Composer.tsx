import {
  type FormEvent,
  type ChangeEvent,
  useState
} from "react";

type ComposerProps = Readonly<{
  disabled?: boolean;
  onSend(text: string): void;
  onAttach?(file: File, kind: "media" | "file"): void;
}>;

export function Composer({
  disabled = false,
  onSend,
  onAttach
}: ComposerProps) {
  const [text, setText] = useState("");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (message.length === 0 || disabled) {
      return;
    }
    onSend(message);
    setText("");
  }

  function choose(
    event: ChangeEvent<HTMLInputElement>,
    kind: "media" | "file"
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    setAttachmentsOpen(false);
    if (file !== undefined && !disabled) {
      onAttach?.(file, kind);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer__attachment">
        {attachmentsOpen && (
          <div className="composer__attachment-menu" role="menu">
            <label role="menuitem">
              <span aria-hidden="true">▧</span>
              Фото или видео
              <input
                type="file"
                accept="image/*,video/*"
                multiple={false}
                onChange={(event) => {
                  choose(event, "media");
                }}
              />
            </label>
            <label role="menuitem">
              <span aria-hidden="true">⌑</span>
              Файл
              <input
                type="file"
                multiple={false}
                onChange={(event) => {
                  choose(event, "file");
                }}
              />
            </label>
            <small>До 20 МБ</small>
          </div>
        )}
        <button
          className="composer__attach"
          type="button"
          aria-label="Прикрепить файл"
          aria-expanded={attachmentsOpen}
          data-no-swipe
          disabled={disabled}
          onClick={() => {
            setAttachmentsOpen((value) => !value);
          }}
        >
          <span aria-hidden="true">＋</span>
        </button>
      </div>
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
