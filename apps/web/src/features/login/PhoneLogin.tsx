import {
  type FormEvent,
  useEffect,
  useState
} from "react";

import type {
  MaxLoginResult,
  MaxLoginState
} from "../../api/client.js";

export type PhoneLoginClient = Readonly<{
  submitPhone(phone: string): Promise<MaxLoginResult>;
  submitCode(code: string): Promise<MaxLoginResult>;
}>;

type PhoneLoginProps = Readonly<{
  client: PhoneLoginClient;
  initialState: MaxLoginState;
  onAuthenticated(): void;
}>;

export function PhoneLogin({
  client,
  initialState,
  onAuthenticated
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
    setBusy(true);
    setError("");
    try {
      const result = await client.submitPhone(phone);
      setState(result.state);
      if (result.state !== "code_required") {
        setError(messageForState(result.state));
      }
    } catch {
      setError("Не удалось отправить номер. Попробуйте позже.");
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
        pattern="\+[1-9][0-9]{7,14}"
        value={phone}
        onChange={(event) => {
          setPhone(event.currentTarget.value);
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

function messageForState(state: MaxLoginState): string {
  switch (state) {
    case "captcha_required":
      return "MAX запросил проверку. Попробуйте другой способ входа.";
    case "invalid_code":
      return "Код не подошёл или устарел.";
    case "failed":
      return "Вход не выполнен. Попробуйте позже.";
    default:
      return "MAX пока не подтвердил вход.";
  }
}
