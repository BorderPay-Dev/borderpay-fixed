import { escapeHtml } from "./layout.ts";

export interface BankTraceReceiptProps {
  sender_name?: string | null;
  source_bank_name?: string | null;
  source_bank_account?: string | null;
  source_bank_routing_number?: string | null;
  receiving_account_holder?: string | null;
  receiving_bank_name?: string | null;
  receiving_account_number?: string | null;
  receiving_routing_number?: string | null;
  receiving_iban?: string | null;
  receiving_bic?: string | null;
  receiving_bank_address?: string | null;
  payment_reference?: string | null;
  bridge_transaction_id?: string | null;
  trace_id?: string | null;
  tracking_number?: string | null;
  imad?: string | null;
  uetr?: string | null;
  clave_de_rastreo?: string | null;
}

const LABELS: Array<[keyof BankTraceReceiptProps, string]> = [
  ["sender_name", "Sender"],
  ["source_bank_name", "Source bank"],
  ["source_bank_account", "Source account"],
  ["source_bank_routing_number", "Source bank routing number"],
  ["receiving_account_holder", "Receiving account holder"],
  ["receiving_bank_name", "Receiving bank"],
  ["receiving_account_number", "Receiving account number"],
  ["receiving_routing_number", "Routing number"],
  ["receiving_iban", "IBAN"],
  ["receiving_bic", "BIC / SWIFT"],
  ["receiving_bank_address", "Receiving bank address"],
  ["payment_reference", "Payment reference"],
  ["bridge_transaction_id", "Transaction ID"],
  ["trace_id", "Trace ID"],
  ["tracking_number", "Payment tracking number"],
  ["imad", "IMAD"],
  ["uetr", "UETR"],
  ["clave_de_rastreo", "Clave de rastreo"],
];

function valueFor(
  props: BankTraceReceiptProps,
  key: keyof BankTraceReceiptProps,
): string | null {
  const value = String(props[key] ?? "").trim();
  return value || null;
}

export function renderBankTraceHtml(props: BankTraceReceiptProps): string {
  return LABELS.map(([key, label]) => {
    const value = valueFor(props, key);
    if (!value) return "";
    return `<tr><td style="padding:8px 0;color:#667085;font-size:13px;">${
      escapeHtml(label)
    }</td>
      <td style="padding:8px 0;color:#101828;font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${
      escapeHtml(value)
    }</td></tr>`;
  }).join("");
}

export function renderBankTraceText(props: BankTraceReceiptProps): string {
  const rows = LABELS.flatMap(([key, label]) => {
    const value = valueFor(props, key);
    return value ? [`${label}: ${value}`] : [];
  });
  return rows.length ? `${rows.join("\n")}\n` : "";
}
