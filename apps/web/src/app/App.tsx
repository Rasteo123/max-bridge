import {
  useMemo,
  useState
} from "react";

import { ApiClient } from "../api/client.js";
import { AuthGate } from "../features/auth/AuthGate.js";
import { currentTelegramWebApp } from "../features/auth/telegram.js";
import { MaxLogin } from "../features/login/MaxLogin.js";

export function App() {
  const client = useMemo(() => new ApiClient(), []);
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [maxReady, setMaxReady] = useState(false);

  return (
    <AuthGate client={client} telegram={telegram}>
      {maxReady ? (
        <main className="centered-page">
          <section className="auth-card">
            <h1>MAX подключён</h1>
            <p className="muted">Загружаем ваши чаты…</p>
          </section>
        </main>
      ) : (
        <MaxLogin
          client={client}
          onAuthenticated={() => {
            setMaxReady(true);
          }}
        />
      )}
    </AuthGate>
  );
}
