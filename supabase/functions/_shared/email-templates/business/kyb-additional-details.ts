import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessKybAdditionalDetailsProps {
  company_name?: string;
  verification_url?: string;
  tasks?: string[];
}

export function render(p: BusinessKybAdditionalDetailsProps): RenderedEmail {
  const company = (p.company_name || "your business").trim();
  const tasks = Array.isArray(p.tasks)
    ? p.tasks.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 5)
    : [];
  const subject = `Action required — ${company} needs additional verification details`;
  const heading = "Additional details required";
  const introText = `We need a few more details to complete verification for ${company}.`;

  const taskHtml = tasks.length
    ? `<ul style="margin:14px 0 0;padding-left:18px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.6;">
        ${tasks.map((task) => `<li style="margin:0 0 8px;">${escapeHtml(task)}</li>`).join("")}
       </ul>`
    : `<p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
         Open your dashboard to review and submit the requested details.
       </p>`;

  const ctaUrl = (p.verification_url && String(p.verification_url).trim()) || `${BORDERPAY_BRAND.appUrl}/dashboard`;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: taskHtml,
      ctaText: "Continue verification",
      ctaUrl,
      brandTone: "warning",
    }),
    text: textLayout({
      heading,
      body: [
        introText,
        tasks.length ? `Requested details:\n- ${tasks.join("\n- ")}` : "Requested details are available in your dashboard.",
      ].join("\n\n"),
      ctaText: "Continue verification",
      ctaUrl,
    }),
  };
}

