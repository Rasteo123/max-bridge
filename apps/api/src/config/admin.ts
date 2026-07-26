export class AdminConfigurationError extends Error {
  readonly code = "admin_configuration_error";

  constructor() {
    super("Admin Telegram ID is invalid");
    this.name = "AdminConfigurationError";
  }
}

export function parseAdminTelegramId(value: string): string {
  if (!/^[1-9]\d{0,19}$/u.test(value)) {
    throw new AdminConfigurationError();
  }
  return value;
}
