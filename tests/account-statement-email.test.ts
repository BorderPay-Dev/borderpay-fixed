import { renderTemplate } from "../supabase/functions/_shared/email-templates/index.ts";
Deno.test("account statement attachment template is registered and escapes references",()=>{
 const mail=renderTemplate("account.statement",{period:"2026-09-01 to 2026-09-22",statement_id:"<script>bad</script>"});
 if(!mail.subject.includes("account statement")||!mail.text.includes("attached as a PDF")||!mail.html.includes("&lt;script&gt;bad&lt;/script&gt;")||mail.html.includes("<script>bad"))throw Error("Unsafe statement email");
 if(!mail.text.includes("2026-09-01 to 2026-09-22")||!mail.text.includes("support@borderpayafrica.com"))throw Error("Missing statement details");
});
