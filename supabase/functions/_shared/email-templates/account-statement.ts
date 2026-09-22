import { htmlLayout, escapeHtml } from "./layout.ts";
export function render(props:{period:string;statement_id:string}) {
 const period=String(props.period||"All recorded history"),reference=String(props.statement_id||"");
 const subject="Your BorderPay account statement";
 const text="Hello,\n\nYour BorderPay account statement is attached as a PDF.\n\nPeriod: "+period+"\nStatement reference: "+reference+"\n\nThe statement includes your recorded account activity, receiving account details, and charges in their original currencies.\n\nIf you have any questions, reply to this email or contact support@borderpayafrica.com and include the statement reference.\n\nBorderPay Support";
 return {subject,text,html:htmlLayout({heading:"Your account statement",preview:"Your BorderPay statement is attached as a PDF.",body:
  "<p>Hello,</p><p>Your BorderPay account statement is attached as a PDF.</p><p><strong>Period:</strong> "+escapeHtml(period)+"<br><strong>Statement reference:</strong> "+escapeHtml(reference)+"</p><p>The statement includes your recorded account activity, receiving account details, and charges in their original currencies.</p><p>If you have any questions, reply to this email or contact support@borderpayafrica.com and include the statement reference.</p><p>BorderPay Support</p>"})};
}
