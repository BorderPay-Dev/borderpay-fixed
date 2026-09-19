import { bridgeBusinessNameFields } from '../../supabase/functions/_shared/providers/bridge-business-name.ts';
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`)};
Deno.test('Polish legal identity stays unchanged while Bridge receives Latin transliteration',()=>{
 equal(bridgeBusinessNameFields('Oskar Jagieła'),{business_legal_name:'Oskar Jagieła',transliterated_business_legal_name:'Oskar Jagiela'});
 equal(bridgeBusinessNameFields('Łódź Żółć Sp. z o.o.'),{business_legal_name:'Łódź Żółć Sp. z o.o.',transliterated_business_legal_name:'Lodz Zolc Sp. z o.o.'});
});
Deno.test('ASCII names keep their existing request shape',()=>{
 equal(bridgeBusinessNameFields('Acme & Co. Ltd'),{business_legal_name:'Acme & Co. Ltd'});
 equal(bridgeBusinessNameFields(undefined),{business_legal_name:undefined});
});
Deno.test('Latin accents and composed/decomposed characters retain the original name',()=>{
 for(const name of ['Société','Socie\u0301te\u0301'])equal(bridgeBusinessNameFields(name),{business_legal_name:name,transliterated_business_legal_name:'Societe'});
 equal(bridgeBusinessNameFields('Müller–Straße'),{business_legal_name:'Müller–Straße',transliterated_business_legal_name:'Muller-Strasse'});
});
Deno.test('unsupported scripts are never erased into a different legal identity',()=>{
 for(const name of ['東京 Ltd','ООО Компания'])equal(bridgeBusinessNameFields(name),{business_legal_name:name});
});
