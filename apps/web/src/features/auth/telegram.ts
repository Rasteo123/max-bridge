export type TelegramThemeParams = Readonly<Record<string, string | undefined>>;

export type TelegramEvent =
  | "activated"
  | "deactivated"
  | "themeChanged";

type TelegramEventCallback = () => void;

type TelegramBackButton = Readonly<{
  isVisible?: boolean;
  show(): void;
  hide(): void;
  onClick(callback: TelegramEventCallback): void;
  offClick(callback: TelegramEventCallback): void;
}>;

type TelegramHapticFeedback = Readonly<{
  impactOccurred?(
    style: "light" | "medium" | "heavy" | "rigid" | "soft"
  ): void;
  notificationOccurred?(type: "error" | "success" | "warning"): void;
  selectionChanged?(): void;
}>;

export interface TelegramWebApp {
  readonly initData: string;
  readonly themeParams: TelegramThemeParams;
  readonly isActive?: boolean;
  readonly viewportStableHeight?: number;
  readonly isFullscreen?: boolean;
  readonly BackButton?: TelegramBackButton;
  readonly HapticFeedback?: TelegramHapticFeedback;
  ready(): void;
  expand(): void;
  onEvent?(eventType: TelegramEvent, callback: TelegramEventCallback): void;
  offEvent?(eventType: TelegramEvent, callback: TelegramEventCallback): void;
  isVersionAtLeast?(version: string): boolean;
  requestFullscreen?(): void | Promise<void>;
  exitFullscreen?(): void | Promise<void>;
}

declare global {
  interface Window {
    Telegram?: Readonly<{
      WebApp?: TelegramWebApp;
    }>;
  }
}

export function currentTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function applyTelegramTheme(
  params: TelegramThemeParams,
  root: HTMLElement = document.documentElement
): void {
  const variables: Readonly<Record<string, string>> = {
    bg_color: "--tg-theme-bg-color",
    text_color: "--tg-theme-text-color",
    hint_color: "--tg-theme-hint-color",
    link_color: "--tg-theme-link-color",
    button_color: "--tg-theme-button-color",
    button_text_color: "--tg-theme-button-text-color",
    secondary_bg_color: "--tg-theme-secondary-bg-color"
  };
  for (const [telegramKey, cssName] of Object.entries(variables)) {
    const value = params[telegramKey];
    if (value !== undefined && isSafeCssColor(value)) {
      root.style.setProperty(cssName, value);
    }
  }
}

function isSafeCssColor(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/iu.test(value) ||
    /^(?:rgb|hsl)a?\([0-9.,% ]+\)$/iu.test(value);
}
