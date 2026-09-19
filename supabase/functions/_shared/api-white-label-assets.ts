export const WHITE_LABEL_LOGO_BUCKET = "tenant-assets";
export const WHITE_LABEL_LOGO_MAX_BYTES = 1024 * 1024;

const logoTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function hasBytes(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function normalizeWhiteLabelLogoDataUrl(v: unknown): {
  contentType: string;
  bytes: Uint8Array;
  ext: string;
} {
  if (typeof v !== "string" || !v.trim()) throw new Error("file_data_url is required");
  const match = v.trim().match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("file_data_url must be a base64 data URL");
  const contentType = match[1].toLowerCase();
  const ext = logoTypes[contentType];
  if (!ext) throw new Error("logo file type must be png, jpg, webp, or svg");
  let binary: string;
  try {
    binary = atob(match[2].replace(/\s+/g, ""));
  } catch {
    throw new Error("logo file contains invalid base64");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength === 0) throw new Error("logo file is empty");
  if (bytes.byteLength > WHITE_LABEL_LOGO_MAX_BYTES) {
    throw new Error("logo file must be 1MB or smaller");
  }

  if (contentType === "image/png" && !hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw new Error("logo content does not match image/png");
  }
  if (contentType === "image/jpeg" && !hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    throw new Error("logo content does not match image/jpeg");
  }
  if (
    contentType === "image/webp" &&
    (!hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) || !hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8))
  ) {
    throw new Error("logo content does not match image/webp");
  }
  if (contentType === "image/svg+xml") {
    let svg: string;
    try {
      svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("svg logo must be valid UTF-8");
    }
    if (!/^\s*<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
      throw new Error("svg logo must contain one SVG document");
    }
    if (
      /<!doctype|<!entity|<\?(?:xml-stylesheet)|<(?:script|foreignObject|iframe|object|embed|link|style|audio|video)\b|\bon[a-z]+\s*=|javascript:|data:text\/html|@import|url\(\s*["']?(?!#)/i.test(svg) ||
      /\b(?:href|xlink:href)\s*=\s*["'](?!#)[^"']+/i.test(svg)
    ) {
      throw new Error("svg logo contains unsafe active or external content");
    }
  }
  return { contentType, bytes, ext };
}
