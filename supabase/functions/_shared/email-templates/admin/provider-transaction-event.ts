import { BORDERPAY_BRAND, RenderedEmail, escapeHtml, htmlLayout, textLayout } from "../layout.ts";

export interface ProviderTransactionEventProps {
  provider?: string;
  event_type?: string;
  event_id?: string;
  resource_id?: string;
  customer_id?: string;
  user_id?: string;
  amount?: string | number;
  currency?: string;
  state?: string;
  direction?: string;
  occurred_at?: string;
  admin_url?: string;
}

export function render(props: ProviderTransactionEventProps): RenderedEmail {
  const provider = String(props.provider || "provider").toUpperCase();
  const eventType = String(props.event_type || "transaction.event");
  const state = String(props.state || "unknown");
  const rows = [
    ["Provider", provider],
    ["Event", eventType],
    ["State", state],
    ["Amount", props.amount === undefined ? "n/a" : `${props.amount} ${String(props.currency || "").toUpperCase()}`.trim()],
    ["Direction", props.direction || "n/a"],
    ["Customer", props.customer_id || "unknown"],
    ["BorderPay user", props.user_id || "unmapped"],
    ["Resource", props.resource_id || "unknown"],
    ["Provider event", props.event_id || "unknown"],
    ["Occurred", props.occurred_at || new Date().toISOString()],
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};padding:14px;">
    ${rows.map(([label, value]) => `<tr>
      <td style="padding:7px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${escapeHtml(String(label))}</td>
      <td style="padding:7px 0;color:${BORDERPAY_BRAND.text};font:12px 'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(value))}</td>
    </tr>`).join("")}
  </table>`;
  const heading = `${provider} transaction event`;
  const body = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  return {
    subject: `[TRANSACTION] ${provider} · ${state} · ${props.amount ?? "n/a"} ${String(props.currency || "").toUpperCase()}`,
    html: htmlLayout({
      preview: `${eventType} · ${props.resource_id || props.event_id || "unknown"}`,
      heading,
      introText: "A verified provider transaction webhook was processed by BorderPay.",
      body: table,
      ctaText: props.admin_url ? "Open Compliance" : undefined,
      ctaUrl: props.admin_url || undefined,
      brandTone: state.includes("fail") || state.includes("return") || state.includes("refund") ? "warning" : "default",
    }),
    text: textLayout({
      heading,
      body,
      ctaText: props.admin_url ? "Open Compliance" : undefined,
      ctaUrl: props.admin_url || undefined,
    }),
  };
}
