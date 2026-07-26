export class MaxCompatibilityError extends Error {
  readonly code = "max_wire_incompatible";

  constructor() {
    super("MAX event shape is not supported");
    this.name = "MaxCompatibilityError";
  }
}
