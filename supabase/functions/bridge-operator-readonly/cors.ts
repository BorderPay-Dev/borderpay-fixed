const ALLOWED_ORIGINS = new Set([
  "https://app.borderpayafrica.com",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:3000",
]);

export function treasuryCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://app.borderpayafrica.com",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

