import { htmlLayout, textLayout, BORDERPAY_BRAND, escapeHtml, RenderedEmail } from "../layout.ts";

export interface BusinessScheduledMaintenanceProps {
  company_name?: string;
  maintenance_date?: string;
  maintenance_time?: string;
  maintenance_duration?: string;
}

export function render(p: BusinessScheduledMaintenanceProps): RenderedEmail {
  const company = String(p.company_name || "your business");
  const maintenanceDate = String(p.maintenance_date || "Saturday, August 1, 2026");
  const maintenanceTime = String(p.maintenance_time || "8:00 PM Pacific Time");
  const maintenanceDuration = String(p.maintenance_duration || "up to 30 minutes");
  const subject = "Scheduled BorderPay maintenance";
  const heading = "Scheduled maintenance";
  const introText = `${company} has a short maintenance window coming up.`;
  const bodyText =
    `BorderPay will be temporarily unavailable on ${maintenanceDate}, starting at ${maintenanceTime}. ` +
    `The maintenance is expected to last ${maintenanceDuration}. During this time, your team may not be able to sign in, view account details, or complete payment actions.`;
  const safetyText = "Your funds, account information, and business records remain safe. No action is required from your team.";
  const reasonText = "We are completing this work to improve BorderPay reliability and performance.";

  const body = `
    <p style="margin:0 0 14px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(bodyText)}</p>
    <p style="margin:0 0 14px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(safetyText)}</p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(reasonText)}</p>
  `;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      brandTone: "warning",
      footerNote: "Thank you for your patience.",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${bodyText}\n\n${safetyText}\n\n${reasonText}`,
      footerNote: "Thank you for your patience.",
    }),
  };
}
