// hash-wasm ships per-algorithm UMD bundles under dist/ with no type declarations
// and no `exports` map. crypto.ts deep-imports the argon2 one to keep the offline
// single-file build lean (only argon2's wasm, not the whole barrel); the runtime
// value is cast to hash-wasm's own types at the import site.
declare module "hash-wasm/dist/argon2.umd.min.js";
