import { render as renderUpdate } from "../mobile-app-update.ts";
import type { RenderedEmail } from "../layout.ts";
export function render(p: { full_name?: string; company_name?: string; ios_available?: boolean }): RenderedEmail {
  return renderUpdate({ ...p, audience: "individual" });
}
