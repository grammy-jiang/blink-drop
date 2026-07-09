// Generates the PWA icons from an inline SVG (a QR-finder-pattern glyph).
// Run once and commit the output: npm run gen:icons
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#141413"/>
  <g fill="none" stroke="#faf9f5" stroke-width="26">
    <rect x="96" y="96" width="120" height="120" rx="20"/>
    <rect x="296" y="96" width="120" height="120" rx="20"/>
    <rect x="96" y="296" width="120" height="120" rx="20"/>
  </g>
  <g fill="#faf9f5">
    <rect x="136" y="136" width="40" height="40" rx="8"/>
    <rect x="336" y="136" width="40" height="40" rx="8"/>
    <rect x="136" y="336" width="40" height="40" rx="8"/>
  </g>
  <circle cx="356" cy="356" r="52" fill="#b0512e"/>
</svg>`;

// Maskable variant: full-bleed background with the glyph inset to the central
// ~60% safe zone, so a circular/rounded mask never clips it.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#141413"/>
  <g transform="translate(102 102) scale(0.6)">
    <g fill="none" stroke="#faf9f5" stroke-width="26">
      <rect x="96" y="96" width="120" height="120" rx="20"/>
      <rect x="296" y="96" width="120" height="120" rx="20"/>
      <rect x="96" y="296" width="120" height="120" rx="20"/>
    </g>
    <g fill="#faf9f5">
      <rect x="136" y="136" width="40" height="40" rx="8"/>
      <rect x="336" y="136" width="40" height="40" rx="8"/>
      <rect x="136" y="336" width="40" height="40" rx="8"/>
    </g>
    <circle cx="356" cy="356" r="52" fill="#b0512e"/>
  </g>
</svg>`;

const dir = new URL("../public/icons/", import.meta.url);
await mkdir(dir, { recursive: true });
const buf = Buffer.from(svg);

async function png(size: number, name: string, source: Buffer = buf): Promise<void> {
  await sharp(source).resize(size, size).png().toFile(new URL(name, dir).pathname);
  console.log(`  icons/${name} (${size}px)`);
}

await png(192, "icon-192.png");
await png(512, "icon-512.png");
await png(180, "apple-touch-icon.png");
await png(512, "icon-maskable-512.png", Buffer.from(maskableSvg));
console.log("done → public/icons/");
