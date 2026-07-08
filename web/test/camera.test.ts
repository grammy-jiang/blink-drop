// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CameraError, isSecureContextOk, startCamera } from "../src/receiver/camera.js";

// camera.ts's getUserMedia error mapping (getUserMedia rejection → typed
// CameraError). The success path (live video + scan loop) needs a real browser
// and is covered by the Tier 3 Playwright suite (docs/20).

function setSecure(v: boolean): void {
  Object.defineProperty(window, "isSecureContext", { value: v, configurable: true });
}

function stubGUM(reject: Error): void {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: () => Promise.reject(reject) },
    configurable: true,
  });
}

function named(name: string): Error {
  return Object.assign(new Error(name), { name });
}

beforeEach(() => setSecure(true));

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
});

describe("camera error mapping", () => {
  it("isSecureContextOk reflects window.isSecureContext", () => {
    setSecure(true);
    expect(isSecureContextOk()).toBe(true);
    setSecure(false);
    expect(isSecureContextOk()).toBe(false);
  });

  it("throws InsecureContext when not on a secure origin", async () => {
    setSecure(false);
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toMatchObject({
      name: "InsecureContext",
    });
  });

  it("maps NotAllowedError → PermissionDenied", async () => {
    stubGUM(named("NotAllowedError"));
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toBeInstanceOf(CameraError);
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toMatchObject({
      name: "PermissionDenied",
    });
  });

  it("maps SecurityError → PermissionDenied", async () => {
    stubGUM(named("SecurityError"));
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toMatchObject({
      name: "PermissionDenied",
    });
  });

  it("maps NotFoundError / OverconstrainedError → NoCamera", async () => {
    stubGUM(named("NotFoundError"));
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toMatchObject({ name: "NoCamera" });
    stubGUM(named("OverconstrainedError"));
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toMatchObject({ name: "NoCamera" });
  });

  it("maps any other failure → CameraFailed", async () => {
    stubGUM(named("WeirdError"));
    await expect(startCamera(document.createElement("div"), () => {})).rejects.toMatchObject({ name: "CameraFailed" });
  });
});
