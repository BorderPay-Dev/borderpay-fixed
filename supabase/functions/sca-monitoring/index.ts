import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildScaSignals, type ScaAuditRow } from "../_shared/sca-monitoring.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sameSecret(actual: string, expected: string): boolean {
  const left = new TextEncoder().encode(actual);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function recipients(): string[] {
  return (Deno.env.get("SCA_INCIDENT_EMAILS") || Deno.env.get("COMPLIANCE_OPERATOR_EMAILS") || "")
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const expectedToken = required("SCA_MONITORING_WORKER_TOKEN");
    const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!sameSecret(suppliedToken, expectedToken)) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const windowStartedAt = new Date(Date.now() - 15 * 60_000);
    const { data, error } = await supabase
      .from("sca_audit_events")
      .select("user_id,event_type,reason,created_at")
      .gte("created_at", windowStartedAt.toISOString())
      .order("created_at", { ascending: true });
    if (error) throw new Error(`SCA audit read failed: ${error.message}`);

    const rows = (data || []) as ScaAuditRow[];
    const signals = buildScaSignals(rows);
    const alertRecipients = recipients();
    if (signals.length > 0 && alertRecipients.length === 0) {
      throw new Error("SCA incident recipient is required");
    }

    const bucket = windowStartedAt.toISOString().slice(0, 13);
    const created: Array<Record<string, unknown>> = [];
    for (const signal of signals) {
      const signalKey = `${bucket}:${signal.userId || "unknown"}:${signal.signalType}`;
      const { data: alert, error: insertError } = await supabase
        .from("sca_monitoring_alerts")
        .upsert({
          signal_key: signalKey,
          signal_type: signal.signalType,
          severity: signal.severity,
          user_id: signal.userId,
          event_count: signal.count,
          window_started_at: windowStartedAt.toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "signal_key", ignoreDuplicates: true })
        .select("id,signal_key,email_sent_at")
        .maybeSingle();
      if (insertError) throw new Error(`SCA alert write failed: ${insertError.message}`);
      if (!alert || alert.email_sent_at) continue;
      created.push(alert);

      const sendToken = required("SEND_EMAIL_INTERNAL_TOKEN");
      for (const to of alertRecipients) {
        const response = await fetch(`${required("SUPABASE_URL")}/functions/v1/send-email`, {
          method: "POST",
          headers: { authorization: `Bearer ${sendToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            template: "admin.incident_alert",
            to,
            idempotency_key: `sca-monitoring:${signalKey}:${to}`,
            props: {
              severity: signal.severity,
              service: "bridge-eea-sca",
              title: "Bridge EEA SCA monitoring alert",
              user_id: signal.userId || "pseudonymous/unknown",
              code: signal.signalType,
              message: `${signal.count} credential-free audit event(s) detected in the monitoring window.`,
              occurred_at: new Date().toISOString(),
            },
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`SCA alert email failed with HTTP ${response.status}`);
      }
      await supabase.from("sca_monitoring_alerts").update({ email_sent_at: new Date().toISOString() }).eq("id", alert.id);
    }
    return json({ scanned: rows.length, signals: signals.length, alerts_created: created.length });
  } catch (error) {
    return json({ error: "sca_monitoring_unavailable", detail: error instanceof Error ? error.message : "unknown" }, 503);
  }
});
