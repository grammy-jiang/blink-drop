// Minimal deterministic CBOR (RFC 8949) for the Blink-Drop message envelope.
//
// Scope is deliberately the small subset the protocol needs (docs/01-protocol.md §4):
//   unsigned integers, byte strings, text strings, arrays, and maps with
//   unsigned-integer keys. We own this wire boundary rather than pulling a
//   general CBOR library so the bytes are fully under our control and identical
//   across the TypeScript and (future) Swift implementations bound by the shared
//   test vectors. Encoding is canonical: definite lengths, shortest-form head,
//   map keys sorted ascending by numeric value (equivalent to byte order for the
//   single-byte keys we use).
//
// Anything outside the subset throws — strict at the boundary (SG-5).

export type CborValue = number | string | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<number, CborValue>;

const MT_UINT = 0;
const MT_BYTES = 2;
const MT_TEXT = 3;
const MT_ARRAY = 4;
const MT_MAP = 5;

function assertUint(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) throw new CborError(`${what} must be a non-negative integer, got ${n}`);
  if (n > Number.MAX_SAFE_INTEGER) throw new CborError(`${what} exceeds MAX_SAFE_INTEGER (${n})`);
}

export class CborError extends Error {
  override name = "CborError";
}

// ---- encoder ----

class Writer {
  private chunks: number[] = [];
  pushByte(b: number): void {
    this.chunks.push(b & 0xff);
  }
  pushBytes(bytes: Uint8Array): void {
    for (const b of bytes) this.chunks.push(b);
  }
  head(major: number, arg: number): void {
    assertUint(arg, "cbor head argument");
    const base = major << 5;
    if (arg < 24) {
      this.pushByte(base | arg);
    } else if (arg < 0x100) {
      this.pushByte(base | 24);
      this.pushByte(arg);
    } else if (arg < 0x10000) {
      this.pushByte(base | 25);
      this.pushByte(arg >>> 8);
      this.pushByte(arg);
    } else if (arg < 0x100000000) {
      this.pushByte(base | 26);
      this.pushByte(arg >>> 24);
      this.pushByte(arg >>> 16);
      this.pushByte(arg >>> 8);
      this.pushByte(arg);
    } else {
      // 64-bit: split into hi/lo 32-bit halves (values stay < 2^53, so safe).
      this.pushByte(base | 27);
      const hi = Math.floor(arg / 0x100000000);
      const lo = arg >>> 0;
      this.pushByte(hi >>> 24);
      this.pushByte(hi >>> 16);
      this.pushByte(hi >>> 8);
      this.pushByte(hi);
      this.pushByte(lo >>> 24);
      this.pushByte(lo >>> 16);
      this.pushByte(lo >>> 8);
      this.pushByte(lo);
    }
  }
  result(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function encodeValue(w: Writer, v: CborValue): void {
  if (typeof v === "number") {
    assertUint(v, "uint");
    w.head(MT_UINT, v);
  } else if (typeof v === "string") {
    const bytes = new TextEncoder().encode(v);
    w.head(MT_TEXT, bytes.length);
    w.pushBytes(bytes);
  } else if (v instanceof Uint8Array) {
    w.head(MT_BYTES, v.length);
    w.pushBytes(v);
  } else if (Array.isArray(v)) {
    w.head(MT_ARRAY, v.length);
    for (const item of v) encodeValue(w, item);
  } else if (v instanceof Map) {
    const keys = [...v.keys()].sort((a, b) => a - b);
    w.head(MT_MAP, keys.length);
    for (const k of keys) {
      assertUint(k, "map key");
      w.head(MT_UINT, k);
      encodeValue(w, v.get(k)!);
    }
  } else {
    throw new CborError(`unsupported CBOR value: ${Object.prototype.toString.call(v)}`);
  }
}

export function encode(value: CborValue): Uint8Array {
  const w = new Writer();
  encodeValue(w, value);
  return w.result();
}

// ---- decoder ----

class Reader {
  constructor(
    private readonly buf: Uint8Array,
    public pos = 0,
  ) {}
  byte(): number {
    if (this.pos >= this.buf.length) throw new CborError("unexpected end of CBOR input");
    return this.buf[this.pos++]!;
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new CborError("unexpected end of CBOR input");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function readHead(r: Reader): { major: number; arg: number } {
  const first = r.byte();
  const major = first >> 5;
  const info = first & 0x1f;
  let arg: number;
  if (info < 24) {
    arg = info;
  } else if (info === 24) {
    arg = r.byte();
  } else if (info === 25) {
    arg = (r.byte() << 8) | r.byte();
  } else if (info === 26) {
    arg = r.byte() * 0x1000000 + (r.byte() << 16) + (r.byte() << 8) + r.byte();
  } else if (info === 27) {
    const hi = r.byte() * 0x1000000 + (r.byte() << 16) + (r.byte() << 8) + r.byte();
    const lo = r.byte() * 0x1000000 + (r.byte() << 16) + (r.byte() << 8) + r.byte();
    arg = hi * 0x100000000 + lo;
    if (arg > Number.MAX_SAFE_INTEGER) throw new CborError("CBOR integer exceeds MAX_SAFE_INTEGER");
  } else {
    throw new CborError(`unsupported CBOR additional-info ${info} (indefinite lengths not allowed)`);
  }
  return { major, arg };
}

function decodeValue(r: Reader): CborValue {
  const { major, arg } = readHead(r);
  switch (major) {
    case MT_UINT:
      return arg;
    case MT_BYTES:
      return new Uint8Array(r.bytes(arg));
    case MT_TEXT:
      return new TextDecoder("utf-8", { fatal: true }).decode(r.bytes(arg));
    case MT_ARRAY: {
      const out: CborValue[] = [];
      for (let i = 0; i < arg; i++) out.push(decodeValue(r));
      return out;
    }
    case MT_MAP: {
      const out: CborMap = new Map();
      for (let i = 0; i < arg; i++) {
        const { major: km, arg: key } = readHead(r);
        if (km !== MT_UINT) throw new CborError(`map key must be a uint, got major type ${km}`);
        out.set(key, decodeValue(r));
      }
      return out;
    }
    default:
      throw new CborError(`unsupported CBOR major type ${major}`);
  }
}

export function decode(buf: Uint8Array): CborValue {
  const r = new Reader(buf);
  const value = decodeValue(r);
  if (r.pos !== buf.length) throw new CborError(`trailing bytes after CBOR value (${buf.length - r.pos} left)`);
  return value;
}
