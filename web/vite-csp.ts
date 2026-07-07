import type { Plugin } from "vite";

// Content-Security-Policy, injected into each built HTML page (architecture §17
// SG-3/SG-4'). It is added at BUILD time only — skipped during `vite dev` so
// HMR's websocket + injected scripts keep working.
//
// Sender: forbids ALL network (connect-src 'none') — "the file never leaves the
//   machine" becomes browser-enforced. The single-file build inlines JS/CSS, so
//   script/style need 'unsafe-inline'; the load-bearing control is connect-src.
// Receiver: same-origin only (connect-src 'self') — its service worker must fetch
//   app assets, so 'none' would break offline. getUserMedia is a permission (not
//   connect-src) and the MediaStream is set via srcObject (not a URL), so the
//   camera is unaffected; Web Share and blob: downloads are local, not network.
//
// 'wasm-unsafe-eval' (both pages, v0.4): the OPT-IN Argon2id KDF runs in
//   WebAssembly (hash-wasm), which needs this directive to instantiate. It is
//   strictly narrower than 'unsafe-eval' (no JS eval), and egress stays
//   forbidden (connect-src 'none'/'self'), so the no-upload guarantee is intact.
const SENDER_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; object-src 'none'";
const RECEIVER_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'";

export function cspPlugin(): Plugin {
  return {
    name: "blink-drop-csp",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.server) return html; // dev server: leave HMR alone
        const csp = ctx.path.includes("receiver") ? RECEIVER_CSP : SENDER_CSP;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
        return html.replace("<head>", `<head>\n    ${meta}`);
      },
    },
  };
}
