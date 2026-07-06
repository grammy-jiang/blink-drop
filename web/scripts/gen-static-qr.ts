// Generates ONE static QR image for a tiny file that fits in a single UR part
// (a complete transfer, seqLen=1) — for a real-optics test on a phone.
// Deterministic: the tiny input takes the compression=0 store path, so this
// matches byte-for-byte what the browser self-test verified.
//   npm run gen:static-qr
import { writeFileSync } from "node:fs";
import qrcode from "qrcode-generator";
import { Assembler, buildMessage, bytesEqual, openMessage, systematicQrParts } from "../src/core/index.js";

const text = "hi from blink-drop — single static QR optical test ✔";
const input = { bytes: new TextEncoder().encode(text), name: "hello.txt", mediaType: "text/plain" };

const message = await buildMessage(input);
const parts = systematicQrParts(message);
if (parts.length !== 1) throw new Error(`expected a single-part message, got ${parts.length} parts`);
const part = parts[0]!;

// Prove this exact part is a complete, verifying transfer before emitting the image.
const asm = new Assembler();
asm.receiveQr(part);
if (!asm.isSuccess) throw new Error("part did not reconstruct");
const decoded = await openMessage(asm.message());
if (!bytesEqual(decoded.bytes, input.bytes)) throw new Error("self-verify failed");

const qr = qrcode(0, "L");
qr.addData(part, "Alphanumeric");
qr.make();
const dataUrl = qr.createDataURL(10, 4); // cellSize=10px, margin=4 modules -> GIF data URL
const base64 = dataUrl.split(",")[1]!;
const out = new URL("../../hello-qr.gif", import.meta.url);
writeFileSync(out, Buffer.from(base64, "base64"));

console.log(
  `file=${input.bytes.length}B message=${message.length}B parts=${parts.length} partChars=${part.length} verified=${bytesEqual(decoded.bytes, input.bytes)}`,
);
console.log(`wrote ${out.pathname}`);
