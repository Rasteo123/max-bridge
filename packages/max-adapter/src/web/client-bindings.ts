export type MaxClientBindings = Readonly<{
  moduleUrl: string;
  sessionExport: string;
  routerExport: string;
}>;

export class MaxClientBindingError extends Error {
  readonly code = "max_client_binding_unavailable";

  constructor() {
    super("MAX web client compatibility binding is unavailable");
    this.name = "MaxClientBindingError";
  }
}

export function discoverMaxClientBindings(
  source: string,
  nodeModuleUrl: string
): MaxClientBindings {
  if (source.length < 1 || source.length > 4 * 1024 * 1024) {
    throw new MaxClientBindingError();
  }
  const sessionLocal = source.match(
    /let\{viewer:[A-Za-z_$][\w$]*\}=([A-Za-z_$][\w$]*)\(\)/u
  )?.[1];
  const routerLocal = source.match(
    /([A-Za-z_$][\w$]*)\.openChat\(/u
  )?.[1];
  if (sessionLocal === undefined || routerLocal === undefined) {
    throw new MaxClientBindingError();
  }

  const imports = parseImports(source);
  const session = imports.find((binding) =>
    binding.localName === sessionLocal
  );
  const router = imports.find((binding) =>
    binding.localName === routerLocal
  );
  if (
    session === undefined
    || router === undefined
    || session.modulePath !== router.modulePath
  ) {
    throw new MaxClientBindingError();
  }

  let moduleUrl: string;
  try {
    moduleUrl = new URL(session.modulePath, nodeModuleUrl).href;
  } catch {
    throw new MaxClientBindingError();
  }
  if (!moduleUrl.startsWith("https://web.max.ru/")) {
    throw new MaxClientBindingError();
  }
  return {
    moduleUrl,
    sessionExport: session.exportName,
    routerExport: router.exportName
  };
}

type ImportBinding = Readonly<{
  exportName: string;
  localName: string;
  modulePath: string;
}>;

function parseImports(source: string): ImportBinding[] {
  const output: ImportBinding[] = [];
  const pattern = /import\{([^}]*)\}from"([^"]+)"/gu;
  for (const match of source.matchAll(pattern)) {
    const specifiers = match[1];
    const modulePath = match[2];
    if (specifiers === undefined || modulePath === undefined) {
      continue;
    }
    for (const specifier of specifiers.split(",")) {
      const parts = specifier.trim().split(/\s+as\s+/u);
      const exportName = parts[0];
      const localName = parts[1] ?? parts[0];
      if (
        exportName !== undefined
        && localName !== undefined
        && /^[A-Za-z_$][\w$]*$/u.test(exportName)
        && /^[A-Za-z_$][\w$]*$/u.test(localName)
      ) {
        output.push({ exportName, localName, modulePath });
      }
    }
  }
  return output;
}
