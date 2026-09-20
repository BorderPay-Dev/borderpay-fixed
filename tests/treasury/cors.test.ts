import { treasuryCors } from '../../supabase/functions/bridge-operator-readonly/cors.ts';
Deno.test('treasury accepts exact web, iOS and Android application origins', () => {
  for (const origin of ['https://app.borderpayafrica.com', 'capacitor://localhost', 'https://localhost']) {
    const headers = treasuryCors(new Request('https://example.invalid', {headers:{Origin:origin}}));
    if(headers['Access-Control-Allow-Origin'] !== origin) throw new Error(`origin rejected: ${origin}`);
    if(headers['Vary'] !== 'Origin' || !headers['Access-Control-Allow-Headers'].includes('authorization')) throw new Error('preflight contract missing');
  }
});
Deno.test('treasury never reflects arbitrary or near-matching origins', () => {
  for(const origin of ['https://evil.example', 'capacitor://evil.example', 'https://localhost.evil.example', 'null']) {
    const headers=treasuryCors(new Request('https://example.invalid', {headers:{Origin:origin}}));
    if(headers['Access-Control-Allow-Origin'] === origin || headers['Access-Control-Allow-Origin'] === '*') throw new Error('untrusted origin reflected');
  }
});
