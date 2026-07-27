import {
  type FormEvent,
  type ChangeEvent,
  useEffect,
  useRef,
  useState
} from "react";
import type {
  MessengerMessage,
  MessengerSticker
} from "./types.js";

const MAX_EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
  "😊", "😇", "🙂", "🙃", "😉", "😍", "🥰", "😘",
  "😋", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
  "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁",
  "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯",
  "😳", "🥵", "🥶", "😱", "😨", "😰", "🤗", "🤔",
  "🫡", "🤭", "🫢", "🤫", "😶", "😐", "😬", "🙄",
  "😮", "😲", "🥱", "😴", "🤤", "😵", "🤐", "🥴",
  "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "👍", "👎",
  "👏", "🙌", "🫶", "🙏", "💪", "🤝", "❤️", "💔",
  "🔥", "✨", "🎉", "🎊", "💯", "✅", "❗", "❓"
] as const;

type ComposerProps = Readonly<{
  disabled?: boolean;
  onSend(text: string, replyToId?: string): void;
  onAttach?(file: File, kind: "media" | "file"): void;
  replyingTo?: MessengerMessage;
  editing?: MessengerMessage;
  onEdit?(messageId: string, text: string): void;
  onCancelContext?(): void;
  onLoadStickers?(): Promise<readonly MessengerSticker[]>;
  onSendSticker?(stickerId: string): Promise<void> | void;
}>;

export function Composer({
  disabled = false,
  onSend,
  onAttach,
  replyingTo,
  editing,
  onEdit,
  onCancelContext,
  onLoadStickers,
  onSendSticker
}: ComposerProps) {
  const [text, setText] = useState("");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<"emoji" | "stickers">("emoji");
  const [stickers, setStickers] =
    useState<readonly MessengerSticker[] | null>(null);
  const [stickersLoading, setStickersLoading] = useState(false);
  const [stickerError, setStickerError] = useState<string | null>(null);
  const attachmentRoot = useRef<HTMLDivElement>(null);
  const stickerRoot = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const stickerRequest = useRef(0);
  const pendingCursor = useRef<number | null>(null);

  useEffect(() => {
    if (editing !== undefined) {
      setText(editing.text);
      textAreaRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyingTo !== undefined) {
      textAreaRef.current?.focus();
    }
  }, [replyingTo]);

  useEffect(() => {
    const cursor = pendingCursor.current;
    if (cursor === null) {
      return;
    }
    pendingCursor.current = null;
    textAreaRef.current?.focus();
    textAreaRef.current?.setSelectionRange(cursor, cursor);
  }, [text]);

  useEffect(() => {
    if (!attachmentsOpen && !stickersOpen) {
      return;
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        attachmentsOpen &&
        attachmentRoot.current?.contains(target) === false
      ) {
        setAttachmentsOpen(false);
      }
      if (
        stickersOpen &&
        stickerRoot.current?.contains(target) === false
      ) {
        setStickersOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAttachmentsOpen(false);
        setStickersOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [attachmentsOpen, stickersOpen]);

  useEffect(() => () => {
    stickerRequest.current += 1;
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (message.length === 0 || disabled) {
      return;
    }
    if (editing !== undefined && onEdit !== undefined) {
      onEdit(editing.id, message);
      onCancelContext?.();
    } else {
      onSend(message, replyingTo?.id);
      if (replyingTo !== undefined) {
        onCancelContext?.();
      }
    }
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

  async function loadStickers() {
    if (onLoadStickers === undefined) {
      return;
    }
    const requestId = ++stickerRequest.current;
    setStickersLoading(true);
    setStickerError(null);
    try {
      const loaded = await onLoadStickers();
      if (requestId === stickerRequest.current) {
        setStickers(loaded);
      }
    } catch {
      if (requestId === stickerRequest.current) {
        setStickerError("Не удалось загрузить стикеры.");
      }
    } finally {
      if (requestId === stickerRequest.current) {
        setStickersLoading(false);
      }
    }
  }

  async function chooseSticker(stickerId: string) {
    if (onSendSticker === undefined || disabled || editing !== undefined) {
      return;
    }
    setStickersOpen(false);
    try {
      await onSendSticker(stickerId);
    } catch {
      setStickerError("Не удалось отправить стикер.");
    }
  }

  function insertEmoji(emoji: string) {
    const field = textAreaRef.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? start;
    pendingCursor.current = start + emoji.length;
    setText(`${text.slice(0, start)}${emoji}${text.slice(end)}`);
  }

  const composerClassName = [
    "composer",
    replyingTo !== undefined || editing !== undefined
      ? "composer--context"
      : "",
    "composer--stickers"
  ].filter(Boolean).join(" ");

  return (
    <form
      className={composerClassName}
      onSubmit={submit}
    >
      {(replyingTo !== undefined || editing !== undefined) && (
        <div className="composer__context">
          <div>
            <strong>
              {editing === undefined ? "Ответ на сообщение" : "Редактирование"}
            </strong>
            <span>
              {(editing ?? replyingTo)?.text || "Вложение"}
            </span>
          </div>
          <button
            type="button"
            aria-label={
              editing === undefined
                ? "Отменить ответ"
                : "Отменить редактирование"
            }
            data-no-swipe
            onClick={() => {
              setText("");
              onCancelContext?.();
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className="composer__attachment" ref={attachmentRoot}>
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
          disabled={disabled || editing !== undefined}
          onClick={() => {
            setStickersOpen(false);
            setAttachmentsOpen((value) => !value);
          }}
        >
          <span aria-hidden="true">＋</span>
        </button>
      </div>
      <label className="composer__field">
        <span className="sr-only">Сообщение</span>
        <textarea
          ref={textAreaRef}
          rows={1}
          value={text}
          placeholder={
            editing === undefined ? "Сообщение" : "Измените сообщение"
          }
          aria-label="Сообщение"
          data-no-swipe
          disabled={disabled}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        />
      </label>
      <div className="composer__stickers" ref={stickerRoot}>
        {stickersOpen && (
          <section
            className="composer__sticker-popover"
            role="dialog"
            aria-label="Эмодзи и стикеры"
            data-no-swipe
          >
            <header>
              <div className="composer__picker-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={pickerTab === "emoji"}
                  onClick={() => {
                    setPickerTab("emoji");
                  }}
                >
                  Эмодзи
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pickerTab === "stickers"}
                  onClick={() => {
                    setPickerTab("stickers");
                    if (
                      stickers === null &&
                      !stickersLoading &&
                      onLoadStickers !== undefined
                    ) {
                      void loadStickers();
                    }
                  }}
                >
                  Стикеры
                </button>
              </div>
              <button
                className="composer__picker-close"
                type="button"
                aria-label="Закрыть эмодзи и стикеры"
                onClick={() => {
                  setStickersOpen(false);
                }}
              >
                ×
              </button>
            </header>
            {pickerTab === "emoji" ? (
              <div className="composer__emoji-grid" aria-label="Эмодзи">
                {MAX_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Вставить ${emoji}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      insertEmoji(emoji);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : stickersLoading ? (
                <p role="status">Загружаем стикеры…</p>
              ) : stickerError !== null ? (
                <div className="composer__sticker-state" role="alert">
                  <p>{stickerError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void loadStickers();
                    }}
                  >
                    Повторить
                  </button>
                </div>
              ) : onLoadStickers === undefined || onSendSticker === undefined ? (
                <p className="composer__sticker-state">
                  Стикеры недоступны
                </p>
              ) : stickers?.length === 0 ? (
                <p className="composer__sticker-state">Стикеров пока нет</p>
              ) : (
                <div className="composer__sticker-grid">
                  {stickers?.map((sticker) => (
                    <button
                      key={sticker.id}
                      type="button"
                      aria-label={`Отправить стикер ${sticker.id}`}
                      onClick={() => {
                        void chooseSticker(sticker.id);
                      }}
                    >
                      <img
                        src={sticker.previewDataUrl}
                        alt=""
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              )}
          </section>
        )}
        <button
          className="composer__sticker-button"
          type="button"
          aria-label="Эмодзи и стикеры"
          aria-expanded={stickersOpen}
          data-no-swipe
          disabled={disabled}
          onClick={() => {
            if (stickersOpen) {
              setStickersOpen(false);
              return;
            }
            setAttachmentsOpen(false);
            setStickersOpen(true);
          }}
        >
          <span aria-hidden="true">☺</span>
        </button>
      </div>
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
