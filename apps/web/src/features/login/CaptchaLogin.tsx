import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  MaxLoginResult
} from "../../api/client.js";

export type CaptchaLoginClient = Readonly<{
  getMaxLoginStatus(): Promise<MaxLoginResult>;
  sendCaptchaPointer(
    phase: "down" | "move" | "up",
    x: number,
    y: number
  ): Promise<MaxLoginResult>;
}>;

type CaptchaLoginProps = Readonly<{
  client: CaptchaLoginClient;
  onAuthenticated(): void;
  onCodeRequired(): void;
}>;

export function CaptchaLogin({
  client,
  onAuthenticated,
  onCodeRequired
}: CaptchaLoginProps) {
  const [nonce, setNonce] = useState(() => cryptoNonce());
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const pointerActive = useRef(false);
  const lastMoveAt = useRef(0);
  const lastPoint = useRef<Readonly<{ x: number; y: number }> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => () => {
    active.current = false;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!pointerActive.current) {
        setNonce(cryptoNonce());
      }
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let checking = false;
    const timer = window.setInterval(() => {
      if (checking || pointerActive.current) {
        return;
      }
      checking = true;
      void client.getMaxLoginStatus()
        .then(handleResult)
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [client, onAuthenticated, onCodeRequired]);

  function handleResult(result: MaxLoginResult): void {
    if (!active.current) {
      return;
    }
    if (result.state === "authenticated") {
      onAuthenticated();
    } else if (result.state === "code_required") {
      onCodeRequired();
    } else if (result.state === "failed") {
      setError("Проверка MAX завершилась с ошибкой. Попробуйте ещё раз.");
    }
  }

  function point(
    event: ReactPointerEvent<HTMLImageElement>
  ): Readonly<{ x: number; y: number }> | null {
    const box = event.currentTarget.getBoundingClientRect();
    if (
      box.width <= 0
      || box.height <= 0
      || !Number.isFinite(event.clientX)
      || !Number.isFinite(event.clientY)
    ) {
      return null;
    }
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height)
    };
  }

  function send(
    phase: "down" | "move" | "up",
    x: number,
    y: number
  ): void {
    queue.current = queue.current
      .then(async () => {
        handleResult(await client.sendCaptchaPointer(phase, x, y));
        if (phase === "up") {
          pointerActive.current = false;
        }
        if (
          active.current
          && (phase === "up" || !pointerActive.current)
        ) {
          setNonce(cryptoNonce());
        }
      })
      .catch(() => {
        if (phase === "up") {
          pointerActive.current = false;
        }
        if (active.current) {
          setError("Не удалось передать действие в MAX. Повторите его.");
        }
      });
  }

  function pointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    event.preventDefault();
    const position = point(event);
    if (position === null) {
      setError("Проверка ещё загружается. Подождите и попробуйте снова.");
      return;
    }
    setError("");
    pointerActive.current = true;
    lastPoint.current = position;
    lastMoveAt.current = performance.now();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    send("down", position.x, position.y);
  }

  function pointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!pointerActive.current) {
      return;
    }
    event.preventDefault();
    const now = performance.now();
    if (now - lastMoveAt.current < 50) {
      return;
    }
    lastMoveAt.current = now;
    const position = point(event);
    if (position === null) {
      return;
    }
    lastPoint.current = position;
    send("move", position.x, position.y);
  }

  function pointerUp(event: ReactPointerEvent<HTMLImageElement>): void {
    if (!pointerActive.current) {
      return;
    }
    event.preventDefault();
    const position = point(event) ?? lastPoint.current;
    lastPoint.current = null;
    if (position === null) {
      setError("Не удалось завершить действие. Повторите его.");
      return;
    }
    send("up", position.x, position.y);
  }

  return (
    <div className="captcha-login">
      <p className="muted">
        Выполните проверку MAX прямо здесь. Можно нажимать и перетаскивать
        элементы пальцем.
      </p>
      <div className="captcha-frame">
        <img
          src={`/api/max/login/captcha?nonce=${encodeURIComponent(nonce)}`}
          alt="Проверка безопасности MAX"
          draggable={false}
          onLoad={() => {
            setFailed(false);
          }}
          onError={() => {
            setFailed(true);
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
      </div>
      {failed && (
        <p className="form-error" role="alert">
          Проверка не загрузилась. Обновите её.
        </p>
      )}
      {error.length > 0 && (
        <p className="form-error" role="alert">{error}</p>
      )}
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          setFailed(false);
          setError("");
          setNonce(cryptoNonce());
        }}
      >
        Обновить проверку
      </button>
      <p className="security-caption">
        Изображение проверки существует только в памяти и не сохраняется.
      </p>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function cryptoNonce(): string {
  return globalThis.crypto.randomUUID();
}
