export const TEXT_MAX_BYTES = 1_000_000;

export function createTextFile(text: string): File {
  return new File([text], `message-${Date.now()}.txt`, { type: "text/plain;charset=utf-8" });
}

export function canPreviewText(blob: Blob, name = ""): boolean {
  return blob.type.split(";")[0].toLowerCase() === "text/plain" || /\.txt$/i.test(name);
}
