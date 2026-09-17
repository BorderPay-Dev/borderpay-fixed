/** Additional Latin representation requested by Bridge; never replaces the legal name. */
export function bridgeBusinessNameFields(name: string | undefined): Record<string, string | undefined> {
  const fields: Record<string, string | undefined> = { business_legal_name: name };
  if (!name || /^[\x20-\x7e]*$/.test(name)) return fields;
  // Unicode decomposition handles accents but not letters such as Polish ł.
  const letters: Record<string, string> = {
    Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ð: 'D', ð: 'd', Ø: 'O', ø: 'o',
    Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', ß: 'ss', ẞ: 'SS', Þ: 'TH', þ: 'th',
    '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-',
  };
  const latin = Array.from(name, character => letters[character] ?? character).join('')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
  // Unknown scripts require an explicit transliteration, not silent deletion.
  if (latin && /^[\x20-\x7e]+$/.test(latin)) fields.transliterated_business_legal_name = latin;
  return fields;
}
