// bc-ur (the UR/MUR codec) and its transitive deps (buffer, util) expect node
// globals — `Buffer` and `process` — which the browser does not provide. Import
// this module FIRST, before anything that pulls in the core / bc-ur, in every
// browser entry point.
import { Buffer } from "buffer";
import process from "process";

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: typeof process };
if (typeof g.Buffer === "undefined") g.Buffer = Buffer;
if (typeof g.process === "undefined") g.process = process;
