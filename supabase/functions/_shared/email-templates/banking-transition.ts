import { BANKING_TRANSITION_CAMPAIGN as copy } from "./banking-transition-copy.ts";
import { htmlLayout, textLayout, escapeHtml, firstName, type RenderedEmail } from "./layout.ts";

export function render(props: { full_name?: string } = {}): RenderedEmail {
  const greeting = "Hi " + firstName(props.full_name) + ",";
  const paragraph = (value: string) => '<p style="margin:0 0 16px;">' + escapeHtml(value) + '</p>';
  const body = paragraph(greeting) + paragraph(copy.intro) + paragraph(copy.continuity)
    + '<ul style="margin:0 0 20px;padding-left:20px;">'
    + copy.items.map(item => '<li style="margin-bottom:12px;"><strong>' + escapeHtml(item.title)
      + ':</strong> ' + escapeHtml(item.text) + '</li>').join('') + '</ul>'
    + '<h2 style="font-size:18px;margin:24px 0 12px;">' + escapeHtml(copy.pausedHeading) + '</h2>'
    + paragraph(copy.paused) + paragraph(copy.closing) + paragraph(copy.support)
    + paragraph("Thank you,") + paragraph("The BorderPay Team");
  return {
    subject: copy.subject,
    html: htmlLayout({ preview: copy.preview, heading: copy.heading, body, ctaText: copy.cta, ctaUrl: copy.url }),
    text: textLayout({ heading: copy.heading, body: [greeting, copy.intro, copy.continuity,
      ...copy.items.map(item => item.title + ": " + item.text), copy.pausedHeading, copy.paused,
      copy.closing, copy.support, "Thank you, The BorderPay Team"].join("\n\n"), ctaText: copy.cta, ctaUrl: copy.url }),
  };
}
