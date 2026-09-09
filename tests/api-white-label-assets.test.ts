import { normalizeWhiteLabelLogoDataUrl } from "../supabase/functions/_shared/api-white-label-assets.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => unknown, contains: string): void {
  try {
    fn();
  } catch (error) {
    assert(String(error).includes(contains), `expected error containing ${contains}`);
    return;
  }
  throw new Error("expected function to throw");
}

function dataUrl(type: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
}

Deno.test("valid PNG and safe SVG logos are accepted", () => {
  const png = normalizeWhiteLabelLogoDataUrl(dataUrl("image/png", new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ])));
  assert(png.ext === "png");
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  assert(normalizeWhiteLabelLogoDataUrl(dataUrl("image/svg+xml", svg)).ext === "svg");
});

Deno.test("MIME spoofing, active SVG and external SVG content are rejected", () => {
  assertThrows(() => normalizeWhiteLabelLogoDataUrl(dataUrl("image/png", new Uint8Array([1, 2, 3]))), "does not match");
  const script = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assertThrows(() => normalizeWhiteLabelLogoDataUrl(dataUrl("image/svg+xml", script)), "unsafe");
  const external = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>');
  assertThrows(() => normalizeWhiteLabelLogoDataUrl(dataUrl("image/svg+xml", external)), "unsafe");
});

Deno.test("empty, unsupported and oversized logos fail closed", () => {
  assertThrows(() => normalizeWhiteLabelLogoDataUrl(""), "required");
  assertThrows(() => normalizeWhiteLabelLogoDataUrl(dataUrl("image/gif", new Uint8Array([1]))), "file type");
  const tooLarge = new Uint8Array(1024 * 1024 + 1);
  assertThrows(() => normalizeWhiteLabelLogoDataUrl(dataUrl("image/png", tooLarge)), "1MB");
});
