export type ValidationIssue = Readonly<{
  path: string;
  message: string;
}>;

export class DomainValidationError extends Error {
  readonly code = "domain_validation_failed";
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super("Domain value failed validation");
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}
