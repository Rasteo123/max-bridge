import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { pushBackHandler } from "./back-navigation.js";

type DeleteMessageDialogProps = Readonly<{
  /** Whether MAX allows withdrawing this message from the other side. */
  canDeleteForEveryone: boolean;
  onCancel(): void;
  onConfirm(forEveryone: boolean): void;
}>;

export function DeleteMessageDialog({
  canDeleteForEveryone,
  onCancel,
  onConfirm
}: DeleteMessageDialogProps) {
  const [forEveryone, setForEveryone] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  cancelRef.current = onCancel;

  useEffect(() => pushBackHandler(() => {
    cancelRef.current?.();
  }), []);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current?.();
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
      data-testid="delete-message-dialog"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-message-title"
      >
        <h2 id="delete-message-title">Удалить сообщение</h2>
        <p>Вы уверены, что хотите удалить 1 сообщение</p>
        {canDeleteForEveryone && (
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={forEveryone}
              onChange={(event) => {
                setForEveryone(event.currentTarget.checked);
              }}
            />
            <span>Удалить у всех</span>
          </label>
        )}
        <div className="modal__actions">
          <button
            ref={confirmRef}
            className="modal__action modal__action--danger"
            type="button"
            onClick={() => {
              onConfirm(forEveryone);
            }}
          >
            Удалить
          </button>
          <button
            className="modal__action"
            type="button"
            onClick={onCancel}
          >
            Отменить
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
