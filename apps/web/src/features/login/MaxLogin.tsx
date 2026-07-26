import {
  useEffect,
  useState
} from "react";

import type {
  ApiClient,
  MaxLoginState
} from "../../api/client.js";
import { PhoneLogin } from "./PhoneLogin.js";
import { QrLogin } from "./QrLogin.js";

type MaxLoginProps = Readonly<{
  client: ApiClient;
  onAuthenticated(): void;
}>;

type Method = "phone" | "qr";

export function MaxLogin({
  client,
  onAuthenticated
}: MaxLoginProps) {
  const [method, setMethod] = useState<Method>("phone");
  const [state, setState] = useState<MaxLoginState | "loading">("loading");

  useEffect(() => {
    let active = true;
    void client.getMaxLoginStatus()
      .then((result) => {
        if (!active) {
          return;
        }
        if (result.state === "authenticated") {
          onAuthenticated();
        } else {
          setState(result.state);
          if (result.state === "qr_required") {
            setMethod("qr");
          }
        }
      })
      .catch(() => {
        if (active) {
          setState("method_required");
        }
      });
    return () => {
      active = false;
    };
  }, [client, onAuthenticated]);

  useEffect(() => {
    if (method !== "qr" || state === "loading") {
      return;
    }
    let checking = false;
    const timer = window.setInterval(() => {
      if (checking) {
        return;
      }
      checking = true;
      void client.getMaxLoginStatus()
        .then((result) => {
          if (result.state === "authenticated") {
            onAuthenticated();
          } else {
            setState(result.state);
          }
        })
        .catch(() => {
          // A transient status error must not discard the QR session.
        })
        .finally(() => {
          checking = false;
        });
    }, 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [client, method, onAuthenticated, state]);

  return (
    <main className="centered-page">
      <section className="auth-card">
        <div className="brand-mark" aria-hidden="true">КД</div>
        <p className="eyebrow">Круг друзей</p>
        <h1>Подключите MAX</h1>
        <p className="muted">
          Вход выполняется в вашем личном аккаунте MAX. Сообщения и изображения
          в нашей базе не сохраняются.
        </p>
        <div className="login-tabs" role="tablist" aria-label="Способ входа">
          <button
            type="button"
            role="tab"
            aria-selected={method === "phone"}
            onClick={() => {
              setMethod("phone");
            }}
          >
            По SMS
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === "qr"}
            onClick={() => {
              setMethod("qr");
            }}
          >
            По QR-коду
          </button>
        </div>
        {state === "loading" ? (
          <p className="loading-label" aria-busy="true">Проверяем MAX…</p>
        ) : method === "phone" ? (
          <PhoneLogin
            client={client}
            initialState={state}
            onAuthenticated={onAuthenticated}
          />
        ) : (
          <QrLogin />
        )}
        <p className="security-caption">
          Номер и код передаются только вашему серверу по защищённому соединению.
          Telegram их не получает.
        </p>
      </section>
    </main>
  );
}
