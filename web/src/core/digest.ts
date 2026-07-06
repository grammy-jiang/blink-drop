// SHA-256 via the platform-native Web Crypto API (browser and node ≥ 20).

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return new Uint8Array(digest);
}

// Constant-time-ish equality. The digest is not a secret, so timing is not a
// concern here; this is just a correct fixed-work byte compare.
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
