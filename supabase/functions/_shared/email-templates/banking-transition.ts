import { BANKING_TRANSITION_ACTIVE, BANKING_TRANSITION_RESTRICTED, BANKING_TRANSITION_STATUS_MESSAGES } from "./banking-transition-copy.ts";
import { htmlLayout, textLayout, escapeHtml, firstName, type RenderedEmail } from "./layout.ts";

type Props = { full_name?: string; transition_status?: string };
function renderNotice(copy: typeof BANKING_TRANSITION_ACTIVE | typeof BANKING_TRANSITION_RESTRICTED, props: Props, statusMessage?: string): RenderedEmail {
  const greeting = "Hi " + firstName(props.full_name) + ",";
  const paragraph = (value: string) => '<p style="margin:0 0 16px;">' + escapeHtml(value) + '</p>';
  const body = paragraph(greeting) + paragraph(copy.intro) + (statusMessage ? paragraph(statusMessage) : "") + paragraph(copy.continuity)
    + '<ul style="margin:0 0 20px;padding-left:20px;">'
    + copy.items.map(item => '<li style="margin-bottom:12px;"><strong>' + escapeHtml(item.title)
      + ':</strong> ' + escapeHtml(item.text) + '</li>').join('') + '</ul>'
    + paragraph(copy.closing) + paragraph(copy.support) + paragraph("Thank you,") + paragraph("The BorderPay Team");
  return {
    subject: copy.subject,
    html: htmlLayout({ preview: copy.preview, heading: copy.heading, body, ctaText: copy.cta, ctaUrl: copy.url }),
    text: textLayout({ heading: copy.heading, body: [greeting, copy.intro, statusMessage, copy.continuity,
      ...copy.items.map(item => item.title + ": " + item.text), copy.closing, copy.support,
      "Thank you, The BorderPay Team"].filter(Boolean).join("\n\n"), ctaText: copy.cta, ctaUrl: copy.url }),
  };
}
export function renderActive(props: Props = {}): RenderedEmail {
  return renderNotice(BANKING_TRANSITION_ACTIVE, props);
}
export function renderRestricted(props: Props = {}): RenderedEmail {
  const key = props.transition_status as keyof typeof BANKING_TRANSITION_STATUS_MESSAGES;
  if (!Object.prototype.hasOwnProperty.call(BANKING_TRANSITION_STATUS_MESSAGES, key)) throw new Error("Restricted business status is required");
  return renderNotice(BANKING_TRANSITION_RESTRICTED, props, BANKING_TRANSITION_STATUS_MESSAGES[key]);
}
