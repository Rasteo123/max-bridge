import {
  useEffect,
  useMemo,
  useState
} from "react";

import { ApiClient } from "../api/client.js";
import { AuthGate } from "../features/auth/AuthGate.js";
import { currentTelegramWebApp } from "../features/auth/telegram.js";
import { MaxLogin } from "../features/login/MaxLogin.js";
import { ConnectedMessenger } from "../features/messenger/ConnectedMessenger.js";
import type { MessengerTheme } from "../features/messenger/types.js";

const THEME_STORAGE_KEY = "maxbridge-theme";

export function App() {
  const client = useMemo(() => new ApiClient(), []);
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [maxReady, setMaxReady] = useState(false);
  const [theme, setTheme] = useState<MessengerTheme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is optional in privacy-restricted webviews.
    }
  }, [theme]);

  return (
    <AuthGate client={client} telegram={telegram}>
      {maxReady ? (
        <ConnectedMessenger
          client={client}
          theme={theme}
          onThemeChange={setTheme}
          onLoggedOut={() => {
            setMaxReady(false);
          }}
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

function readTheme(): MessengerTheme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    // A system theme is a safe fallback when storage is unavailable.
  }
  return "system";
}
