import {
  type FormEvent,
  useEffect,
  useState
} from "react";

import {
  ApiError,
  type MaxLoginResult,
  type MaxLoginState
} from "../../api/client.js";

export type PhoneLoginClient = Readonly<{
  submitPhone(phone: string): Promise<MaxLoginResult>;
  submitCode(code: string): Promise<MaxLoginResult>;
}>;

type PhoneLoginProps = Readonly<{
  client: PhoneLoginClient;
  initialState: MaxLoginState;
  onAuthenticated(): void;
  onCaptchaRequired?(): void;
}>;

export function PhoneLogin({
  client,
  initialState,
  onAuthenticated,
  onCaptchaRequired
}: PhoneLoginProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  useEffect(() => () => {
    setPhone("");
    setCode("");
  }, []);

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone === null) {
      setError(
        "Проверьте номер телефона. Для российского номера нужно 10 цифр после +7."
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await client.submitPhone(normalizedPhone);
      setState(result.state);
      if (result.state === "captcha_required") {
        onCaptchaRequired?.();
        return;
      }
      if (result.state !== "code_required") {
        setError(result.state === "failed"
          ? "MAX не принял номер. Проверьте его и попробуйте ещё раз."
          : messageForState(result.state));
      }
    } catch (caught: unknown) {
      if (
        caught instanceof ApiError
        && caught.code === "login_temporarily_locked"
      ) {
        setError(lockedMessage(caught.retryAfterSeconds));
      } else {
        setError("Не удалось связаться с MAX. Попробуйте позже.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await client.submitCode(code);
      setState(result.state);
      if (result.state === "authenticated") {
        setPhone("");
        setCode("");
        onAuthenticated();
      } else {
        setCode("");
        setError(messageForState(result.state));
      }
    } catch {
      setCode("");
      setError("Код не подошёл или устарел.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "code_required" || state === "invalid_code") {
    return (
      <form className="login-form" onSubmit={(event) => {
        void submitCode(event);
      }}>
        <label htmlFor="max-code">Код из SMS</label>
        <input
          id="max-code"
          name="max-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{4,8}"
          minLength={4}
          maxLength={8}
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value);
          }}
          disabled={busy}
          autoFocus
          required
        />
        {error.length > 0 && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Проверяем…" : "Войти"}
        </button>
      </form>
    );
  }

  return (
    <form className="login-form" onSubmit={(event) => {
      void submitPhone(event);
    }}>
      <label htmlFor="max-phone">Номер телефона</label>
      <input
        id="max-phone"
        name="max-phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+7 999 123-45-67"
        value={phone}
        onChange={(event) => {
          setPhone(event.currentTarget.value);
          setError("");
        }}
        disabled={busy}
        required
      />
      {error.length > 0 && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? "Отправляем…" : "Получить код"}
      </button>
    </form>
  );
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  let normalized: string;

  if (trimmed.startsWith("+")) {
    normalized = `+${digits}`;
  } else if (/^8\d{10}$/.test(digits)) {
    normalized = `+7${digits.slice(1)}`;
  } else if (/^7\d{10}$/.test(digits)) {
    normalized = `+${digits}`;
  } else if (/^\d{10}$/.test(digits)) {
    normalized = `+7${digits}`;
  } else {
    return null;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return null;
  }
  if (normalized.startsWith("+7") && !/^\+7\d{10}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function lockedMessage(retryAfterSeconds?: number): string {
  if (
    retryAfterSeconds === undefined
    || !Number.isFinite(retryAfterSeconds)
  ) {
    return "Слишком много попыток. Подождите и попробуйте снова.";
  }
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Слишком много попыток. Повторите через ${String(minutes)} мин.`;
}

function messageForState(state: MaxLoginState): string {
  switch (state) {
    case "captcha_required":
      return "MAX запросил проверку безопасности.";
    case "invalid_code":
      return "Код не подошёл или устарел.";
    case "failed":
      return "Вход не выполнен. Попробуйте позже.";
    default:
      return "MAX пока не подтвердил вход.";
  }
}
