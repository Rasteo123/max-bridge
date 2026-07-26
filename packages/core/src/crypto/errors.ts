export class CryptoConfigurationError extends Error {
  readonly code = "crypto_configuration_error";

  constructor(message: string) {
    super(message);
    this.name = "CryptoConfigurationError";
  }
}

export class CryptoIntegrityError extends Error {
  readonly code = "crypto_integrity_error";

  constructor() {
    super("Encrypted record failed authentication");
    this.name = "CryptoIntegrityError";
  }
}
