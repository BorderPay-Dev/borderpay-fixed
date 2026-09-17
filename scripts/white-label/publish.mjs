#!/usr/bin/env node
/** Operator-only release gate. Default is read-only; --publish applies the checked draft. */
import { readFile } from "node:fs/promises";
import { resolveTxt } from "node:dns/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    project: { type: "string" },
    evidence: { type: "string" },
    publish: { type: "boolean", default: false },
    pilot: { type: "boolean", default: false },
  },
});
if (
  !values.tenant || !/^[0-9a-f-]{36}$/i.test(values.tenant) ||
  !values.project || !values.evidence
) {
  throw new Error(
    "Usage: node scripts/white-label/publish.mjs --tenant UUID --project SUPABASE_REF --evidence launch-evidence.json [--publish]",
  );
}
const pat = process.env.SUPABASE_ACCESS_TOKEN,
  vercel = process.env.VERCEL_TOKEN;
if (!pat || !vercel) {
  throw new Error(
    "Set SUPABASE_ACCESS_TOKEN and VERCEL_TOKEN in your operator environment. Never put credentials in the evidence file.",
  );
}
const sqlString = (v) => "'" + String(v).replaceAll("'", "''") + "'";
async function query(query, read_only = true) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${values.project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, read_only }),
    },
  );
  if (!r.ok) throw new Error(`Database request failed (${r.status})`);
  return r.json();
}
const [release] = await query(
  `select r.*,t.is_active,t.metadata,t.default_mode,pa.status approval_status,pa.approved_products from public.white_label_releases r join public.api_tenants t on t.id=r.tenant_id join public.api_partner_approvals pa on pa.tenant_id=r.tenant_id where r.tenant_id=${
    sqlString(values.tenant)
  }::uuid`,
);
if (
  !release || !release.is_active || release.approval_status !== "approved" ||
  !release.approved_products?.includes("white_label")
) throw new Error("Active tenant and white-label product approval required");
const onboarding = release.metadata?.onboarding;
if (
  onboarding?.white_label_signup_enabled !== true ||
  !(onboarding?.individual_signup_enabled ||
    onboarding?.business_signup_enabled)
) {
  throw new Error(
    "Operator must approve at least one customer account type and enable white-label onboarding policy",
  );
}
if(release.default_mode !== 'production' || release.metadata?.production_access !== true) throw new Error('Production customer access must be approved separately; sandbox API activation cannot launch a real customer app');
const b = release.draft;
// The same validator is used by Edge and this operator script (Node 24 TS stripping).
const { validateWhiteLabelBrand } = await import(
  "../../supabase/functions/_shared/white-label-config.ts"
);
validateWhiteLabelBrand(b);
const evidence = JSON.parse(await readFile(values.evidence, "utf8"));
const requiredEvidence = values.pilot
  ? ["commercial_approval", "legal_approval", "rollback", "captcha_domain"]
  : [
    "commercial_approval",
    "legal_approval",
    "signup_verification",
    "tenant_isolation",
    "wallets_and_payments",
    "sca_regional_boundaries",
    "email_delivery",
    "support",
    "rollback",
    "captcha_domain",
  ];
for (const key of requiredEvidence) {
  if (typeof evidence[key] !== "string" || evidence[key].trim().length < 8) {
    throw new Error(`Missing evidence reference: ${key}`);
  }
}
if (
  evidence.tenant_id !== values.tenant || evidence.app_origin !== b.app_origin
) throw new Error("Evidence belongs to a different tenant or domain");
const hostname = new URL(b.app_origin).hostname;
const txt = await resolveTxt(`_borderpay.${hostname}`);
if (
  !txt.some((parts) =>
    parts.join("") === `borderpay-verification=${release.domain_challenge}`
  )
) throw new Error("Domain ownership TXT record does not match");
if (
  !evidence.vercel_team_id || !evidence.vercel_project_id ||
  !evidence.deployment_id
) throw new Error("Exact Vercel project, team and deployment required");
const vh = { Authorization: `Bearer ${vercel}` };
const vr = await fetch(
  `https://api.vercel.com/v9/projects/${
    encodeURIComponent(evidence.vercel_project_id)
  }/domains/${hostname}?teamId=${encodeURIComponent(evidence.vercel_team_id)}`,
  { headers: vh },
);
if (!vr.ok || (await vr.json()).verified !== true) {
  throw new Error("Domain is not verified in the specified Vercel project");
}
const dr = await fetch(
  `https://api.vercel.com/v13/deployments/${hostname}?teamId=${
    encodeURIComponent(evidence.vercel_team_id)
  }`,
  { headers: vh },
);
if (!dr.ok) throw new Error("Cannot inspect deployment");
const deployment = await dr.json();
if (
  deployment.id !== evidence.deployment_id ||
  deployment.projectId !== evidence.vercel_project_id ||
  deployment.readyState !== "READY"
) throw new Error("Domain does not serve the reviewed Ready deployment");
const page = await fetch(b.app_origin, {
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
if (
  !page.ok ||
  !(await page.text()).includes('name="borderpay-white-label-runtime"')
) throw new Error("HTTPS customer runtime is not deployed on this domain");
const ar = await fetch(
  `https://api.supabase.com/v1/projects/${values.project}/config/auth`,
  { headers: { Authorization: `Bearer ${pat}` } },
);
if (!ar.ok) throw new Error("Cannot verify Auth redirect allowlist");
const auth = await ar.json();
const redirects = String(auth.uri_allow_list || "").split(",").map((x) =>
  x.trim()
);
if (!redirects.includes(b.app_origin)) {
  throw new Error(
    "Exact customer app origin must be in the Supabase Auth redirect allowlist",
  );
}
for (const url of [b.logo_url, b.terms_url, b.privacy_url, b.support_url]) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("A required brand or legal URL is unavailable");
  await r.body?.cancel();
}
console.log(
  "Verified domain, HTTPS, reviewed deployment, URLs, Auth allowlist and evidence references.",
);
if (!values.publish) {
  console.log(
    "Read-only preflight passed. Use --publish to publish this exact draft.",
  );
  process.exit(0);
}
if (
  values.pilot &&
  (!Array.isArray(evidence.pilot_emails) || !evidence.pilot_emails.length ||
    evidence.pilot_emails.some((x) =>
      typeof x !== "string" || !/^\S+@\S+\.\S+$/.test(x)
    ))
) throw new Error("Provide explicit pilot_emails before a pilot release");
const pilotEmails = values.pilot
  ? evidence.pilot_emails.map((x) => x.trim().toLowerCase())
  : [];
const keyId = release.managed_key_id || randomUUID();
// No usable API secret is retained or sent to a browser. This identity only
// supplies provenance for server-authorized signup; it has no payment scopes.
const keyHash = createHash("sha256").update(randomBytes(64)).digest("hex");
const q = sqlString;
const result = await query(
  `begin;
select tenant_id from public.white_label_releases where tenant_id=${
    q(values.tenant)
  }::uuid for update;
do $gate$ begin if not exists(select 1 from public.white_label_releases where tenant_id=${
    q(values.tenant)
  }::uuid and updated_at=${q(release.updated_at)}::timestamptz and draft=${
    q(JSON.stringify(b))
  }::jsonb) then raise exception 'Draft changed. Run preflight again.'; end if; end $gate$;
insert into public.api_keys(id,tenant_id,key_prefix,key_hash,key_label,scopes) values(${
    q(keyId)
  }::uuid,${q(values.tenant)}::uuid,${q("wl_" + keyId)},${
    q(keyHash)
  },'Managed white-label signup',ARRAY['onboarding:write']) on conflict(id) do nothing;
update public.white_label_releases set published=draft,app_origin=${
    q(b.app_origin)
  },status=${q(values.pilot ? "pilot" : "live")},pilot_emails=ARRAY[${
    pilotEmails.map(q).join(",")
  }]::text[],revision=revision+1,domain_verified_at=now(),managed_key_id=${
    q(keyId)
  }::uuid,launch_evidence=${
    q(JSON.stringify(evidence))
  }::jsonb,published_at=now(),review_requested_at=null,updated_at=now() where tenant_id=${
    q(values.tenant)
  }::uuid;
commit;
select tenant_id,app_origin,status,revision from public.white_label_releases where tenant_id=${
    q(values.tenant)
  }::uuid;`,
  false,
);
console.log(JSON.stringify(result));
