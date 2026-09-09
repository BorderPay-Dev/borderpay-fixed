import { BORDERPAY_BRAND, escapeHtml } from "./layout.ts";

export interface ReceiptTraceProps {
  source_bank_name?: string | null;
  source_bank_account?: string | null;
  payment_reference_text?: string | null;
  receiving_bank_name?: string | null;
  receiving_account_name?: string | null;
  receiving_account_number?: string | null;
  trace_id?: string | null;
  imad?: string | null;
  uetr?: string | null;
  clave_de_rastreo?: string | null;
}

const TRACE_ROWS: Array<[keyof ReceiptTraceProps, string]> = [
  ["source_bank_name", "Source bank"],
  ["source_bank_account", "Source account"],
  ["payment_reference_text", "Bank reference"],
  ["receiving_bank_name", "Receiving bank"],
  ["receiving_account_name", "Receiving account name"],
  ["receiving_account_number", "Receiving account"],
  ["trace_id", "Trace ID"],
  ["imad", "IMAD"],
  ["uetr", "UETR"],
  ["clave_de_rastreo", "Clave de rastreo"],
];

export function renderReceiptTraceHtml(props: ReceiptTraceProps): string {
  return TRACE_ROWS.map(([key, label]) => {
    const value = String(props[key] ?? "").trim();
    if (!value) return "";
    return `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(value)}</td></tr>`;
  }).join("");
}

export function renderReceiptTraceText(props: ReceiptTraceProps): string {
  return TRACE_ROWS.map(([key, label]) => {
    const value = String(props[key] ?? "").trim();
    return value ? `${label}: ${value}\n` : "";
  }).join("");
}
