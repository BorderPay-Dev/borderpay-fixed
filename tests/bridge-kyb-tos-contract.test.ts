function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const source = await Deno.readTextFile(
  new URL('../supabase/functions/bridge-kyb-link/index.ts', import.meta.url),
);

Deno.test('Business KYB exposes the same ToS webview response contract as Individual KYC', () => {
  assert(source.includes('interface ExtractedLinks'), 'Business KYB lacks the shared hosted-link response shape');
  assert(source.includes('tos_link_url: string | null'), 'Business KYB does not model tos_link_url');
  assert(source.includes('c?.tos_link?.url || c?.tos_link'), 'Business KYB does not extract Bridge ToS URLs');
  assert(source.includes('if (kycLinkUrl || tosLinkUrl)'), 'ToS-only Bridge responses are rejected');
  assert(source.includes('tos_link_url: links.tos_link_url'), 'Business response omits tos_link_url');
});

Deno.test('Business ToS-only responses do not erase a persisted KYB link', () => {
  const persistenceGuard = source.indexOf('if (links.kyc_link_url && links.kyc_link_id)');
  const businessUpdate = source.indexOf('.from("business_profiles").update', persistenceGuard);
  assert(persistenceGuard >= 0, 'Business KYB persistence is not guarded for ToS-only responses');
  assert(businessUpdate > persistenceGuard, 'Business KYB writes link fields before checking for a real hosted link');
});
