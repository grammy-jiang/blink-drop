// gzip / gunzip via the platform-native Compression Streams API
// (browser and node ≥ 18). The decompressor is BOUNDED: it refuses to inflate
// past a caller-supplied ceiling, which is the decompression-bomb guard
// (docs/01-protocol.md §9, SG-2).

export class DecompressionOverflowError extends Error {
  override name = "DecompressionOverflowError";
}

async function pump(
  input: Uint8Array,
  transform: CompressionStream | DecompressionStream,
  maxOut: number,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Fire-and-forget the write; errors surface on the read side / awaits below.
  // Cast works around the TS 5.7 Uint8Array<ArrayBufferLike> vs BufferSource
  // (ArrayBuffer-only) variance; a Uint8Array is a valid byte-stream chunk.
  const writeDone = writer.write(input as BufferSource).then(() => writer.close());

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOut) {
        await reader.cancel();
        throw new DecompressionOverflowError(`output exceeded ${maxOut} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    await writeDone.catch(() => undefined);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const GZIP_MAX_COMPRESSED = 64 * 1024 * 1024; // sanity bound on compress output

export async function gzip(input: Uint8Array): Promise<Uint8Array> {
  return pump(input, new CompressionStream("gzip"), GZIP_MAX_COMPRESSED);
}

export async function gunzip(input: Uint8Array, maxOut: number): Promise<Uint8Array> {
  return pump(input, new DecompressionStream("gzip"), maxOut);
}
