import {
  useMemo,
  useState
} from "react";

import { ApiClient } from "../api/client.js";
import { AuthGate } from "../features/auth/AuthGate.js";
import { currentTelegramWebApp } from "../features/auth/telegram.js";
import { MaxLogin } from "../features/login/MaxLogin.js";
import { ConnectedMessenger } from "../features/messenger/ConnectedMessenger.js";

export function App() {
  const client = useMemo(() => new ApiClient(), []);
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [maxReady, setMaxReady] = useState(false);

  return (
    <AuthGate client={client} telegram={telegram}>
      {maxReady ? (
        <ConnectedMessenger client={client} />
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
