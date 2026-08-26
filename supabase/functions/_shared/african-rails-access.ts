const AFRICAN_RAILS_TEST_EMAILS = new Set([
  "adhiamboadhiambo22@gmail.com",
  "appreview.individual@borderpayafrica.com",
  "appreview.business@borderpayafrica.com",
]);

export function isAfricanRailsTesterEmail(value: unknown): boolean {
  return AFRICAN_RAILS_TEST_EMAILS.has(String(value || "").trim().toLowerCase());
}

export type AfricanRailsAccessResult =
  | { allowed: true; user: { id: string; email?: string | null } }
  | { allowed: false; status: 401 | 403; code: string; message: string };

export async function authenticateAfricanRailsUser(
  supabase: any,
  req: Request,
): Promise<AfricanRailsAccessResult> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { allowed: false, status: 401, code: "authorization_required", message: "Authorization required" };
  }
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id) {
    return { allowed: false, status: 401, code: "unauthorized", message: "Unauthorized" };
  }
  return { allowed: true, user: { id: String(user.id), email: user.email || null } };
}

export async function authenticateAfricanRailsTester(
  supabase: any,
  req: Request,
): Promise<AfricanRailsAccessResult> {
  const access = await authenticateAfricanRailsUser(supabase, req);
  if (!access.allowed) return access;
  const user = access.user;

  const email = String(user.email || "").trim().toLowerCase();
  if (!isAfricanRailsTesterEmail(email)) {
    return {
      allowed: false,
      status: 403,
      code: "african_rails_closed_beta",
      message: "African rails are not available for this account.",
    };
  }

  return { allowed: true, user: { id: String(user.id), email: user.email || null } };
}

export async function recordAfricanRailsOperatorAlert(
  supabase: any,
  input: { userId: string; endpoint: string; code: string; message: string },
): Promise<void> {
  const { data: existing } = await supabase
    .from("admin_alerts")
    .select("id")
    .eq("alert_type", "african_rails_runtime_blocked")
    .eq("user_id", input.userId)
    .eq("resolved", false)
    .contains("metadata", { endpoint: input.endpoint, code: input.code })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;

  await supabase.from("admin_alerts").insert({
    alert_type: "african_rails_runtime_blocked",
    severity: "high",
    user_id: input.userId,
    message: input.message,
    metadata: {
      endpoint: input.endpoint,
      code: input.code,
      occurred_at: new Date().toISOString(),
    },
    resolved: false,
  });
}
