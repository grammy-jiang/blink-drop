import type { Plugin } from "vite";

// Content-Security-Policy, injected into each built HTML page (architecture §17
// SG-3/SG-4'). Added at BUILD time only — skipped during `vite dev` so HMR's
// websocket + injected scripts keep working.
//
// Egress is forbidden on BOTH hosted pages (connect-src 'none') — "the file
//   never leaves the machine" is browser-enforced on the sender AND the
//   receiver. The receiver window issues no network request of its own; its
//   service-worker precache fetches run in the worker context, which the page's
//   connect-src does NOT govern, so 'none' does not break offline. getUserMedia
//   is a permission (not connect-src), the MediaStream is set via srcObject (not
//   a URL), and Web Share / blob: downloads are local — so the camera and
//   delivery paths are unaffected.
//
// script-src: the HOSTED pages load only EXTERNAL scripts (the module bundle +
//   the PWA registerSW.js), so they need no 'unsafe-inline'. The OFFLINE
//   single-file sender inlines all its JS (viteSingleFile), so THAT build alone
//   passes { inlineScripts: true } to re-add 'unsafe-inline' — scoped to the one
//   build that actually needs it, never the hosted site.
//
// 'wasm-unsafe-eval' (both pages, v0.4): the opt-in Argon2id KDF runs in
//   WebAssembly (hash-wasm), which needs this directive to instantiate. It is
//   strictly narrower than 'unsafe-eval' (no JS eval), and egress stays
//   forbidden, so the no-upload guarantee is intact.

export interface CspOptions {
  // The single-file offline sender inlines its scripts and so needs
  // script-src 'unsafe-inline'. The hosted Pages build must NOT set it.
  inlineScripts?: boolean;
}

function senderCsp(inlineScripts: boolean): string {
  const scriptSrc = inlineScripts
    ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
    : "script-src 'self' 'wasm-unsafe-eval'";
  return `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; object-src 'none'`;
}

const RECEIVER_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; worker-src 'self'; base-uri 'none'; object-src 'none'";

export function cspPlugin(opts: CspOptions = {}): Plugin {
  return {
    name: "blink-drop-csp",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.server) return html; // dev server: leave HMR alone
        const csp = ctx.path.includes("receiver") ? RECEIVER_CSP : senderCsp(opts.inlineScripts ?? false);
        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
        return html.replace("<head>", `<head>\n    ${meta}`);
      },
    },
  };
}
