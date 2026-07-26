export function zeroBuffer(value: Uint8Array): void {
  value.fill(0);
}

export async function withSecretBuffer<T>(
  value: Uint8Array,
  use: (secret: Uint8Array) => Promise<T> | T
): Promise<T> {
  const privateCopy = new Uint8Array(value);
  try {
    return await use(privateCopy);
  } finally {
    zeroBuffer(privateCopy);
  }
}
