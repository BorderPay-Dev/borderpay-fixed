import { PDFDocument, rgb, type PDFPage, type PDFFont } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import type { Invoice } from "./predeposit-policy.ts";
import type { BankPaymentInstructions } from "./predeposit-payment-instructions.ts";

export const INVOICE_PDF_DESIGN_VERSION = "borderpay-b2b-2026-09";
export type PdfAttachment = { kind?: "signed_agreement" | "executed_contract"; name: string; mime: string; bytes: Uint8Array; sha256: string };
export type PdfStyleAssets = { boldFontBytes?: Uint8Array; brandLogo?: Uint8Array };
type Args = PdfStyleAssets & {
  invoice: Invoice; invoiceNumber: string; fontBytes: Uint8Array; templateBody?: string;
  logo?: Uint8Array; signature?: Uint8Array; bank?: BankPaymentInstructions;
  customerCopy?: boolean; attachments?: PdfAttachment[]; agreementOnly?: boolean; approved?: boolean;
  complianceReview?: { assessment: unknown; recorded_at: string };
};

/** Presentation only: totals, bank eligibility and executed documents remain server-owned. */
export async function renderInvoiceDocument(args: Args): Promise<Uint8Array> {
  if (args.customerCopy && (args.attachments?.some(a => !["signed_agreement", "executed_contract"].includes(a.kind || "")) || args.templateBody || args.signature || args.complianceReview)) {
    throw Error("Invoice copies cannot contain private compliance documents or unverified agreements");
  }
  if (args.signature && args.invoice.agreement?.signature_consent !== true) throw Error("Signature consent is required");
  const inv = args.invoice;
  let total = 0;
  if (!inv.items.length) throw Error("Invoice requires line items");
  for (const item of inv.items) {
    const amount = item.quantity * item.unit_amount_minor;
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !Number.isSafeInteger(item.unit_amount_minor) || item.unit_amount_minor <= 0 ||
      !Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) throw Error("Invoice amount is invalid");
    total += amount;
  }
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(args.fontBytes, { subset: true });
  const bold = args.boldFontBytes ? await doc.embedFont(args.boldFontBytes, { subset: true }) : font;
  const width = 595.28, height = 841.89, left = 44, right = width - 44, bottom = 768;
  const ink = rgb(.078, .137, .122), muted = rgb(.396, .451, .424);
  const pale = rgb(.949, .961, .945), rule = rgb(.863, .890, .867), lime = rgb(.780, 1, 0), white = rgb(1, 1, 1);
  let page!: PDFPage;
  let y = 0, documentKind = args.agreementOnly ? "AGREEMENT" : "INVOICE";
  const generated = new Set<PDFPage>();
  const money = (n: number) => {
    const v = BigInt(n);
    return String(v / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(v % 100n).padStart(2, "0");
  };
  const rect = (x: number, top: number, w: number, h: number, color = pale) => page.drawRectangle({ x, y: height - top - h, width: w, height: h, color });
  const line = (top: number, x = left, end = right) => page.drawLine({ start: { x, y: height - top }, end: { x: end, y: height - top }, color: rule, thickness: .6 });
  const text = (value: string, x: number, top: number, size = 9.5, face: PDFFont = font, color = ink, align: "left" | "right" = "left") => {
    const s = String(value ?? "");
    page.drawText(s, { x: align === "right" ? x - face.widthOfTextAtSize(s, size) : x, y: height - top - size, size, font: face, color });
  };
  const wrap = (value: string, max: number, size = 9.5, face: PDFFont = font): string[] => {
    const lines: string[] = [];
    for (const paragraph of String(value ?? "").replace(/\r/g, "").split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
        if (face.widthOfTextAtSize(word, size) > max) {
          if (current) { lines.push(current); current = ""; }
          for (const char of word) {
            if (face.widthOfTextAtSize(current + char, size) > max) { lines.push(current); current = ""; }
            current += char;
          }
        } else if (current && face.widthOfTextAtSize(current + " " + word, size) > max) {
          lines.push(current); current = word;
        } else current += (current ? " " : "") + word;
      }
      lines.push(current);
    }
    return lines;
  };
  const fit = (value: string, max: number, size: number, face = font, minimum = 7) => {
    while (size > minimum && face.widthOfTextAtSize(value, size) > max) size -= .25;
    return size;
  };
  const block = (value: string, x: number, top: number, max: number, size = 9.5, face = font, color = ink, leading = 14) => {
    const rows = wrap(value, max, size, face);
    rows.forEach((s, i) => text(s, x, top + i * leading, size, face, color));
    return top + rows.length * leading;
  };
  const embedImage = (bytes: Uint8Array) => bytes[0] === 137 ? doc.embedPng(bytes) : doc.embedJpg(bytes);
  const merchantLogo = args.logo ? await embedImage(args.logo) : undefined;
  const brandLogo = args.brandLogo ? await embedImage(args.brandLogo) : undefined;
  const newPage = (kind = documentKind, continuation = true) => {
    documentKind = kind; page = doc.addPage([width, height]); generated.add(page);
    if (merchantLogo) {
      const scale = Math.min(130 / merchantLogo.width, 44 / merchantLogo.height);
      page.drawImage(merchantLogo, { x: left, y: height - 38 - merchantLogo.height * scale, width: merchantLogo.width * scale, height: merchantLogo.height * scale });
    } else {
      const nameLines = wrap(inv.merchant.legal_name, 255, 15, bold);
      // Full legal identity is printed in the parties section; keep the masthead compact.
      nameLines.slice(0, 2).forEach((s, i) => text(s, left, 39 + i * 19, 15, bold));
    }
    text(kind, right, 35, kind === "AGREEMENT" ? 27 : 31, bold, ink, "right");
    text(kind === "AGREEMENT" ? "B2B commercial agreement" : kind === "DOSSIER" ? "Supporting commercial records" : "Commercial invoice", right, 77, 8.5, font, muted, "right");
    if (continuation) {
      line(100); y = block("Invoice: " + args.invoiceNumber, left, 114, right - left - 90, 8.5, bold, muted, 12) + 17;
      text(inv.currency, right, 114, 8.5, bold, muted, "right");
    } else y = 110;
  };
  const ensure = (space: number) => { if (y + space > bottom) newPage(); };
  const paragraph = (value: string, size = 9.5, color = ink, indent = 0) => {
    for (const row of wrap(value, right - left - indent, size)) {
      ensure(size + 5); text(row, left + indent, y, size, font, color); y += size + 5;
    }
  };
  const section = (heading: string) => { ensure(58); y += 14; text(heading, left, y, 12, bold); y += 27; };
  const metadata = () => {
    const referenceRows = wrap(args.invoiceNumber, 258, 10, bold);
    const h = Math.max(57, 31 + referenceRows.length * 14);
    rect(left, y, right - left, h);
    text("INVOICE NUMBER", left + 14, y + 11, 7.5, bold, muted);
    block(args.invoiceNumber, left + 14, y + 27, 258, 10, bold);
    text("REVISION", 350, y + 11, 7.5, bold, muted);
    text(String(inv.revision), 350, y + 27, 10, bold);
    text("CURRENCY", 470, y + 11, 7.5, bold, muted); text(inv.currency, 470, y + 27, 10, bold);
    y += h + 24;
  };
  const parties = () => {
    const col = 236;
    const seller = wrap(inv.merchant.legal_name, col, 12, bold);
    const buyer = wrap(inv.buyer.legal_name, col, 12, bold);
    const detail = wrap(inv.buyer.address + " | " + inv.buyer.country + (inv.buyer.tax_id ? "\nTax / VAT ID: " + inv.buyer.tax_id : ""), col, 9);
    const required = 20 + Math.max(seller.length * 17 + 16, buyer.length * 17 + detail.length * 13) + 24;
    if (required > bottom - 155) {
      section("Seller"); paragraph(inv.merchant.legal_name); paragraph(inv.merchant.incorporation_country, 9, muted);
      section("Buyer"); paragraph(inv.buyer.legal_name); paragraph(inv.buyer.address + " | " + inv.buyer.country);
      if (inv.buyer.tax_id) paragraph("Tax / VAT ID: " + inv.buyer.tax_id, 9, muted);
      y += 18; return;
    }
    ensure(required);
    text("FROM", left, y, 7.5, bold, muted); text("BILL TO", 315, y, 7.5, bold, muted);
    const sellerEnd = block(inv.merchant.legal_name, left, y + 17, col, 12, bold, ink, 17);
    text("Incorporation: " + inv.merchant.incorporation_country, left, sellerEnd + 4, 9, font, muted);
    const buyerEnd = block(inv.buyer.legal_name, 315, y + 17, col, 12, bold, ink, 17);
    const end = block(inv.buyer.address + " | " + inv.buyer.country + (inv.buyer.tax_id ? "\nTax / VAT ID: " + inv.buyer.tax_id : ""), 315, buyerEnd + 4, col, 9, font, muted, 13);
    y = Math.max(sellerEnd + 20, end) + 20;
    line(y); y += 19;
    if (inv.order_reference) { paragraph("Order reference: " + inv.order_reference, 9, muted); y += 14; }
  };
  const tableHeader = () => {
    ensure(72); rect(left, y, right - left, 28, ink);
    text("DESCRIPTION", left + 12, y + 9, 7.5, bold, white);
    text("QTY", 355, y + 9, 7.5, bold, white, "right");
    text("UNIT PRICE", 445, y + 9, 7.5, bold, white, "right");
    text("AMOUNT", right - 12, y + 9, 7.5, bold, white, "right"); y += 28;
  };
  const items = () => {
    tableHeader();
    inv.items.forEach((item, index) => {
      const desc = wrap(item.description, 262, 9.5, bold).map(s => ({ s, size: 9.5, face: bold, color: ink }));
      const ref = item.deliverable_reference ? wrap("Reference: " + item.deliverable_reference, 262, 8).map(s => ({ s, size: 8, face: font, color: muted })) : [];
      const rows = [...desc, ...ref]; let offset = 0;
      while (offset < rows.length) {
        if (y + 45 > bottom) { newPage("INVOICE"); tableHeader(); }
        const capacity = Math.max(1, Math.floor((bottom - y - 24) / 14));
        const count = Math.min(rows.length - offset, capacity), h = Math.max(46, count * 14 + 24);
        if (index % 2) rect(left, y, right - left, h, rgb(.973, .980, .969));
        rows.slice(offset, offset + count).forEach((r, i) => text(r.s, left + 12, y + 10 + i * 14, r.size, r.face, r.color));
        if (offset === 0) {
          for (const [value, edge, max, face] of [
            [String(item.quantity), 355, 34, font],
            [money(item.unit_amount_minor), 445, 80, font],
            [money(item.quantity * item.unit_amount_minor), right - 12, 85, bold],
          ] as const) text(value, edge, y + 10, fit(value, max, 9, face, 5), face, ink, "right");
        }
        y += h; line(y); offset += count;
        if (offset < rows.length) { newPage("INVOICE"); tableHeader(); }
      }
    });
  };
  const totalPanel = () => {
    ensure(92); y += 18;
    text("Thank you for your business.", left, y + 12, 10, bold);
    rect(325, y, right - 325, 62, ink); rect(325, y, 3, 62, lime);
    text("INVOICE TOTAL", 338, y + 11, 7.5, bold, lime);
    const value = money(total) + " " + inv.currency;
    text(value, right - 12, y + 31, fit(value, right - 350, 19, bold, 10), bold, white, "right");
    y += 82;
  };
  const bankInstructions = () => {
    if (!args.bank) return;
    const b = args.bank;
    const fields: [string, string | undefined][] = [
      ["Beneficiary", b.beneficiary_name], ["Bank", b.bank_name], ["Account number", b.account_number],
      ["Routing number", b.routing_number], ["Sort code", b.sort_code], ["IBAN", b.iban], ["BIC", b.bic],
      ["Required bank reference", b.required_payment_reference], ["Invoice reference", args.invoiceNumber],
    ];
    const values = fields.filter((field): field is [string, string] => Boolean(field[1]));
    const pairs = [];
    for (let i = 0; i < values.length; i += 2) pairs.push(values.slice(i, i + 2));
    const heights = pairs.map(pair => Math.max(...pair.map(([, value]) => wrap(value, 224, 9, bold).length)) * 13 + 27);
    const notice = inv.currency === "GBP" ? "GBP payments must come from the corporate buyer named on this invoice." : "";
    const noticeRows = notice ? wrap(notice, right - left - 28, 8) : [];
    const heading = () => {
      ensure(90); rect(left, y, right - left, 42);
      text("Bank payment instructions", left + 14, y + 11, 10, bold); y += 42;
    };
    const required = 42 + heights.reduce((a, b) => a + b, 0) + noticeRows.length * 12 + 18;
    if (required < bottom - 150) ensure(required);
    heading();
    pairs.forEach((pair, i) => {
      if (y + heights[i] + 12 > bottom) { newPage("INVOICE"); heading(); }
      rect(left, y, right - left, heights[i]);
      pair.forEach(([name, value], col) => {
        const x = col === 0 ? left + 14 : 315;
        text(name.toUpperCase(), x, y + 2, 7, bold, muted);
        block(value, x, y + 15, 224, 9, bold, ink, 13);
      });
      y += heights[i];
    });
    if (noticeRows.length) {
      ensure(noticeRows.length * 12 + 18); rect(left, y, right - left, noticeRows.length * 12 + 18);
      noticeRows.forEach((row, i) => text(row, left + 14, y + 4 + i * 12, 8, font, muted)); y += noticeRows.length * 12 + 18;
    }
    y += 14;
  };

  newPage(documentKind, false); metadata();
  if (args.customerCopy && !args.bank) { paragraph("INVOICE COPY - PAYMENT DETAILS NOT INCLUDED", 8, muted); y += 14; }
  else if (!args.customerCopy && !args.approved && !args.agreementOnly) { paragraph("UNDER REVIEW - NOT PAYMENT INSTRUCTIONS", 8, muted); y += 14; }
  parties();
  if (!args.agreementOnly) { items(); totalPanel(); bankInstructions(); }

  if (args.templateBody) {
    if (!args.agreementOnly) { newPage("AGREEMENT", false); metadata(); parties(); }
    const terms = args.templateBody.replaceAll("{{seller}}", inv.merchant.legal_name).replaceAll("{{buyer}}", inv.buyer.legal_name)
      .replaceAll("{{amount}}", money(total)).replaceAll("{{currency}}", inv.currency).replaceAll("{{invoice}}", args.invoiceNumber);
    ensure(70); rect(left, y, right - left, 53);
    text("CONTRACT VALUE", left + 14, y + 10, 7.5, bold, muted);
    text(money(total) + " " + inv.currency, left + 14, y + 25, 15, bold); y += 75;
    // These identical fields are already printed above. All contractual clauses remain verbatim.
    const duplicate = new Set(["B2B COMMERCIAL AGREEMENT", "Seller: " + inv.merchant.legal_name, "Buyer: " + inv.buyer.legal_name,
      "Commercial reference: " + args.invoiceNumber, "Contract value: " + money(total) + " " + inv.currency]);
    for (const part of terms.split("\n")) {
      if (duplicate.has(part.trim())) continue;
      if (!part.trim()) { y += 8; continue; }
      const heading = /^(\d+)\.\s+(.+)$/.exec(part);
      if (heading) {
        const headingRows = wrap(heading[2], right - left - 31, 11, bold);
        ensure(headingRows.length * 15 + 50); y += 9;
        rect(left, y + 1, 20, 20); text(heading[1], left + 6, y + 5, 8, bold);
        headingRows.forEach((row, i) => text(row, left + 31, y + i * 15, 11, bold)); y += headingRows.length * 15 + 9;
      } else paragraph(part, 9.3, ink, 31);
    }
    y += 14; ensure(152);
    const signer = wrap(inv.agreement?.signed_by || "", 224, 9, bold);
    const signHeight = Math.max(145, 125 + signer.length * 13);
    ensure(signHeight); rect(left, y, right - left, signHeight);
    text("MERCHANT EXECUTION", left + 14, y + 12, 7.5, bold, muted);
    if (args.signature) {
      const signature = await embedImage(args.signature), scale = Math.min(205 / signature.width, 47 / signature.height);
      page.drawImage(signature, { x: left + 14, y: height - y - 34 - signature.height * scale, width: signature.width * scale, height: signature.height * scale });
      block(inv.agreement.signed_by, left + 14, y + 87, 224, 9, bold, ink, 13);
      block("Accepted: " + inv.agreement.signed_at, left + 14, y + 90 + signer.length * 13, 224, 7.5, font, muted, 11);
    } else text("Signature not applied", left + 14, y + 40, 9, font, muted);
    text("BUYER ACCEPTANCE", 315, y + 12, 7.5, bold, muted);
    block("Retain evidence of the buyer's acceptance with the commercial records. The merchant's signature does not establish the buyer's acceptance.", 315, y + 34, 220, 8.5, font, muted, 12);
    y += signHeight + 16; paragraph("Agreement version: " + inv.agreement.version, 8, muted);
  }
  if (!args.customerCopy && !args.agreementOnly && !args.bank) {
    newPage("DOSSIER");
    section("1. Sender and commercial relationship"); paragraph("Expected remitter: " + inv.remitter.legal_name); paragraph("Relationship: " + inv.remitter.relationship);
    section("2. Payment purpose and fund utilization"); paragraph("Use of funds: " + inv.fund_utilization);
    if (inv.discovery_channel) paragraph("Buyer acquisition: " + inv.discovery_channel);
    if (inv.cross_border_justification) paragraph("Cross-border rationale: " + inv.cross_border_justification);
    if (inv.commercial_end_use) paragraph("Commercial end use: " + inv.commercial_end_use);
    paragraph("Order source: " + inv.order_source + (inv.order_platform ? " / " + inv.order_platform : ""));
    if (inv.order_reference) paragraph("Order reference: " + inv.order_reference);
    section("3. Source of funds and supporting evidence"); paragraph("Source of funds: " + inv.source_of_funds);
    if (args.complianceReview) {
      paragraph("Review recorded: " + args.complianceReview.recorded_at, 8, muted);
      paragraph("Evidence assessment: " + JSON.stringify(args.complianceReview.assessment), 8, muted);
    }
  }
  if (args.attachments?.length && !args.agreementOnly) {
    section(args.customerCopy ? "Attached agreement" : "Evidence manifest");
    paragraph(args.customerCopy ? "A copy of the commercial agreement follows." : "Original files are retained separately. Copies below are for review.", 8.5, muted);
    for (const a of args.attachments) { paragraph(a.name, 9); if (!args.customerCopy) paragraph("SHA-256: " + a.sha256, 7.5, muted); }
    for (const a of args.attachments) {
      if (a.mime === "application/pdf") {
        const original = await PDFDocument.load(a.bytes, { ignoreEncryption: false });
        if (original.getPageCount() > 100) throw Error("Attachment has too many pages");
        // Preserve signed/custom PDFs byte-for-byte as evidence; only embed a visual copy in this package.
        const embedded = await doc.embedPages(original.getPages());
        for (const p of embedded) {
          page = doc.addPage([width, height]);
          const scale = Math.min((width - 40) / p.width, (height - 54) / p.height);
          page.drawPage(p, { x: (width - p.width * scale) / 2, y: 38, width: p.width * scale, height: p.height * scale });
        }
      } else {
        newPage("DOSSIER"); paragraph(a.name, 10);
        const image = await embedImage(a.bytes), scale = Math.min((right - left) / image.width, (bottom - y - 12) / image.height);
        page.drawImage(image, { x: left, y: height - y - image.height * scale, width: image.width * scale, height: image.height * scale });
      }
    }
  }
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    page = pages[i];
    if (generated.has(page)) {
      line(792);
      if (brandLogo) page.drawImage(brandLogo, { x: left, y: height - 817, width: 18, height: 18 });
      text("Powered by BorderPay", brandLogo ? 72 : left, 802, 8, bold);
      const reference = args.invoiceNumber;
      const labelSize = fit(reference, 250, 7, font, 4);
      text(reference, right, 803, labelSize, font, muted, "right");
    }
    text(String(i + 1).padStart(2, "0") + " / " + String(pages.length).padStart(2, "0"), right, 823, 6.8, font, muted, "right");
  }
  doc.setTitle(args.invoiceNumber + " - " + inv.merchant.legal_name); doc.setAuthor(inv.merchant.legal_name);
  doc.setCreator("BorderPay Invoice & Agreement Hub");
  doc.setSubject(INVOICE_PDF_DESIGN_VERSION);
  return doc.save();
}
