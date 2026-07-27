import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

export type ContextMenuPoint = Readonly<{
  x: number;
  y: number;
}>;

export type ContextMenuAction = Readonly<{
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}>;

export type ContextMenuReaction = Readonly<{
  emoji: string;
  label: string;
  selected?: boolean;
  onSelect(): void;
}>;

type PressContextMenuProps = Readonly<{
  point: ContextMenuPoint;
  actions: readonly ContextMenuAction[];
  reactions?: readonly ContextMenuReaction[];
  ariaLabel: string;
  onClose(): void;
}>;

const VIEWPORT_MARGIN = 8;

export function PressContextMenu({
  point,
  actions,
  reactions = [],
  ariaLabel,
  onClose
}: PressContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const bounds = menu.getBoundingClientRect();
    const maxX = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - bounds.width - VIEWPORT_MARGIN
    );
    const maxY = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - bounds.height - VIEWPORT_MARGIN
    );
    setPosition({
      x: clamp(point.x, VIEWPORT_MARGIN, maxX),
      y: clamp(point.y, VIEWPORT_MARGIN, maxY)
    });
    setMeasured(true);
  }, [point]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        menuRef.current?.contains(target) !== true
      ) {
        onClose();
      }
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    function closeOnViewportChange() {
      onClose();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointer,
        true
      );
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [onClose]);

  useEffect(() => {
    if (!measured) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
      ?.focus();
  }, [measured]);

  function choose(action: () => void) {
    onClose();
    action();
  }

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not(:disabled)'
      )
    );
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length;
    }
    items[nextIndex]?.focus();
  }

  return createPortal(
    <div
      ref={menuRef}
      className="press-context-menu"
      role="menu"
      aria-label={ariaLabel}
      data-no-swipe
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onKeyDown={navigateMenu}
      style={{
        left: position.x,
        top: position.y,
        visibility: measured ? "visible" : "hidden"
      }}
    >
      {reactions.length > 0 && (
        <div
          className="press-context-menu__reactions"
          aria-label="Реакции"
        >
          {reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              className="press-context-menu__reaction"
              type="button"
              role="menuitemcheckbox"
              aria-label={reaction.label}
              aria-checked={reaction.selected === true}
              onClick={() => {
                choose(reaction.onSelect);
              }}
            >
              {reaction.emoji}
            </button>
          ))}
        </div>
      )}
      <div className="press-context-menu__actions">
        {actions.map((action) => (
          <button
            key={action.id}
            className={
              action.danger === true
                ? "press-context-menu__action press-context-menu__action--danger"
                : "press-context-menu__action"
            }
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              choose(action.onSelect);
            }}
          >
            {action.icon !== undefined && (
              <span aria-hidden="true">{action.icon}</span>
            )}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

type LongPressOptions = Readonly<{
  onOpen(point: ContextMenuPoint): void;
  disabled?: boolean;
  delayMs?: number;
  moveTolerance?: number;
}>;

export type LongPressBindings = Readonly<{
  onContextMenu(event: ReactMouseEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  onClickCapture(event: ReactMouseEvent<HTMLElement>): void;
  onDragStart(event: ReactMouseEvent<HTMLElement>): void;
}>;

export function useLongPressContextMenu({
  onOpen,
  disabled = false,
  delayMs = 500,
  moveTolerance = 8
}: LongPressOptions): LongPressBindings {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef<Readonly<{
    id: number;
    x: number;
    y: number;
  }> | null>(null);
  const suppressClickRef = useRef(false);

  function cancelPending() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pointerRef.current = null;
  }

  useEffect(() => {
    function cancelForScroll() {
      cancelPending();
    }
    document.addEventListener("scroll", cancelForScroll, true);
    return () => {
      document.removeEventListener("scroll", cancelForScroll, true);
      cancelPending();
    };
  }, []);

  function onContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cancelPending();
    const bounds = event.currentTarget.getBoundingClientRect();
    onOpen({
      x: event.clientX > 0 ? event.clientX : bounds.left + bounds.width / 2,
      y: event.clientY > 0 ? event.clientY : bounds.top + bounds.height / 2
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      disabled ||
      (event.pointerType !== "touch" && event.pointerType !== "pen") ||
      event.button !== 0 ||
      !event.isPrimary
    ) {
      return;
    }
    cancelPending();
    suppressClickRef.current = false;
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    const point = { x: event.clientX, y: event.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (pointerRef.current?.id !== event.pointerId) {
        return;
      }
      suppressClickRef.current = true;
      window.getSelection()?.removeAllRanges();
      onOpen(point);
    }, delayMs);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const pointer = pointerRef.current;
    if (
      pointer === null ||
      pointer.id !== event.pointerId ||
      Math.hypot(
        event.clientX - pointer.x,
        event.clientY - pointer.y
      ) <= moveTolerance
    ) {
      return;
    }
    cancelPending();
  }

  function finishPointer(event: ReactPointerEvent<HTMLElement>) {
    if (pointerRef.current?.id === event.pointerId) {
      cancelPending();
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!suppressClickRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  return {
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onClickCapture,
    onDragStart: (event) => {
      event.preventDefault();
    }
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
