import {
  type ReactNode,
  useEffect,
  useState
} from "react";

import {
  ApiError,
  type UserState
} from "../../api/client.js";
import { PendingScreen } from "./PendingScreen.js";
import {
  applyTelegramTheme,
  type TelegramWebApp
} from "./telegram.js";

export type AuthClient = Readonly<{
  authenticateTelegram(initData: string): Promise<void>;
  getMe(): Promise<Readonly<{ state: UserState }>>;
}>;

type AuthGateProps = Readonly<{
  client: AuthClient;
  telegram: TelegramWebApp | null;
  children: ReactNode;
}>;

type GateState =
  | "loading"
  | "ready"
  | "pending"
  | "disabled"
  | "outside"
  | "error";

export function AuthGate({
  client,
  telegram,
  children
}: AuthGateProps) {
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    telegram?.ready();
    telegram?.expand();
    if (telegram !== null) {
      applyTelegramTheme(telegram.themeParams);
    }
    if (telegram === null || telegram.initData.length === 0) {
      setState("outside");
      return () => {
        controller.abort();
      };
    }

    void (async () => {
      try {
        await client.authenticateTelegram(telegram.initData);
        const me = await client.getMe();
        if (controller.signal.aborted) {
          return;
        }
        if (me.state === "pending") {
          setState("pending");
        } else if (me.state === "disabled") {
          setState("disabled");
        } else {
          setState("ready");
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        if (
          errorCode(error) === "friend_approval_required"
        ) {
          setState("pending");
        } else if (errorCode(error) === "access_disabled") {
          setState("disabled");
        } else {
          setState("error");
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [client, telegram]);

  if (state === "ready") {
    return children;
  }
  if (state === "loading") {
    return (
      <main className="centered-page" aria-busy="true">
        <p className="loading-label">Защищённый вход…</p>
      </main>
    );
  }
  return <PendingScreen kind={state} />;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ApiError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}
