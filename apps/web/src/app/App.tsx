import {
  useMemo,
  useState
} from "react";

import { ApiClient } from "../api/client.js";
import { AuthGate } from "../features/auth/AuthGate.js";
import { currentTelegramWebApp } from "../features/auth/telegram.js";
import { MaxLogin } from "../features/login/MaxLogin.js";
import { MessengerShell } from "../features/messenger/MessengerShell.js";

export function App() {
  const client = useMemo(() => new ApiClient(), []);
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [maxReady, setMaxReady] = useState(false);

  return (
    <AuthGate client={client} telegram={telegram}>
      {maxReady ? (
        <MessengerShell
          chats={[]}
          messages={[]}
          onSelectChat={() => {}}
          onSend={() => {}}
        />
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
