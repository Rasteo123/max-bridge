export type MaxLoginState =
  | "method_required"
  | "code_required"
  | "qr_required"
  | "captcha_required"
  | "authenticated"
  | "invalid_code"
  | "qr_expired"
  | "failed";

export type MaxLoginResult = Readonly<{
  state: MaxLoginState;
}>;
