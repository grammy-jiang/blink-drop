// Export a verified file via the Web Share API (Level 2, files) — which opens
// the real OS share sheet on iOS 16.4+ — falling back to a download when file
// sharing is unavailable (e.g. desktop browsers). Called ONLY after the SHA-256
// gate has passed (protocol §7 / SG-1).

export type ShareResult = "shared" | "downloaded" | "cancelled";

export async function shareOrDownload(bytes: Uint8Array, name: string, mediaType: string): Promise<ShareResult> {
  const type = mediaType || "application/octet-stream";
  const file = new File([bytes as unknown as BlobPart], name, { type });

  // Web Share API Level 2 (files) — opens the OS share sheet on iOS 16.4+.
  const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // fall through to download on any other share failure
    }
  }

  downloadFile(bytes, name, type);
  return "downloaded";
}

export interface ShareItem {
  bytes: Uint8Array;
  name: string;
  mediaType: string;
}

// Multi-file export — `navigator.share({ files })` lands each file individually in
// the OS share sheet (iOS supports multiple). Falls back to downloading each.
export async function shareOrDownloadMany(items: ShareItem[]): Promise<ShareResult> {
  const files = items.map(
    (i) => new File([i.bytes as unknown as BlobPart], i.name, { type: i.mediaType || "application/octet-stream" }),
  );
  const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files });
  if (canShareFiles) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // fall through to download on any other share failure
    }
  }
  for (const i of items) downloadFile(i.bytes, i.name, i.mediaType || "application/octet-stream");
  return "downloaded";
}

export function downloadFile(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
