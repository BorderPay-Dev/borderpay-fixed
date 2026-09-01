import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const input = resolve(root, 'docs/BRIDGE_EEA_SCA_EVIDENCE_PACKAGE_2026-08-31.md');
const outputDir = resolve(root, 'output/bridge-sca');
mkdirSync(outputDir, { recursive: true });

const escape = (value) => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const inline = (value) => escape(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let inCode = false;
  let code = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      closeList();
      if (inCode) { out.push(`<pre>${escape(code.join('\n'))}</pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (line.startsWith('|') && lines[index + 1]?.match(/^\|[\s|:-]+\|$/)) {
      closeList();
      const rows = [];
      const parseRow = (row) => row.split('|').slice(1, -1).map((cell) => cell.trim());
      rows.push(parseRow(line)); index += 2;
      while (index < lines.length && lines[index].startsWith('|')) { rows.push(parseRow(lines[index])); index += 1; }
      index -= 1;
      out.push(`<table><thead><tr>${rows[0].map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { closeList(); list = kind; out.push(`<${kind}>`); }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`); continue;
    }
    closeList(); out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

const markdown = readFileSync(input, 'utf8');
const screenshots = [
  '01-account-access-pin.png', '02-account-access-totp.png',
  '03-payment-context.png', '04-factor-enrollment.png',
  '05-non-eea-bypass.png', '06-fund-in-excluded.png',
];
const figures = screenshots.map((name, index) => `<figure><img src="../../artifacts/bridge-sca-evidence/screenshots/${name}"><figcaption>Controlled QA capture ${index + 1}: ${name.replace('.png', '').replaceAll('-', ' ')}</figcaption></figure>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:18mm 17mm 18mm}body{font:10.2pt/1.5 Inter,Arial,sans-serif;color:#142026;margin:0}h1{font-size:23pt;color:#152126;border-bottom:4px solid #c7ff00;padding-bottom:10px}h2{font-size:15pt;margin-top:24px;break-after:avoid;color:#19333a}h3{font-size:12pt;break-after:avoid}p{margin:7px 0}li{margin:4px 0}code{font:8.5pt ui-monospace,monospace;background:#eef3f3;padding:1px 4px;border-radius:3px}pre{font:8pt/1.45 ui-monospace,monospace;background:#0d1518;color:#e9f3f2;padding:14px;border-radius:8px;white-space:pre-wrap;break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:8.5pt;margin:12px 0}th,td{border:1px solid #c9d4d5;padding:7px;vertical-align:top}th{background:#dceeee;text-align:left}.screenshots{break-before:page}figure{margin:18px 0 0;display:flex;min-height:225mm;flex-direction:column;justify-content:center}figure+figure{break-before:page}figure img{width:100%;border:1px solid #d8e0e0}figcaption{text-align:center;color:#59666b;margin-top:8px;font-size:9pt}strong{font-weight:750}</style></head><body>${markdownToHtml(markdown)}<section class="screenshots"><h1>Controlled QA screenshots</h1>${figures}</section></body></html>`;
writeFileSync(resolve(outputDir, 'BorderPay_Bridge_EEA_SCA_Initial_QA.html'), html);
console.log(resolve(outputDir, 'BorderPay_Bridge_EEA_SCA_Initial_QA.html'));
