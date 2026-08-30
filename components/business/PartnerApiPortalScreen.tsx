import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, KeyRound, Plus, RefreshCw, ShieldCheck, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

const SCOPES = [
  'customers:write', 'onboarding:write', 'wallets:write',
  'virtual_accounts:write', 'transfers:write', 'payouts:write', 'webhooks:write',
];

type PortalData = {
  tenant: { tenant_name: string; default_mode: string; is_active: boolean; beta_access_enabled?: boolean; rate_limit_per_minute: number; metadata?: any };
  api_keys: Array<{ id: string; key_prefix: string; key_label?: string; scopes: string[]; is_active: boolean; last_used_at?: string; created_at: string }>;
  ip_allowlist: Array<{ id: string; cidr_block: string; note?: string; is_active: boolean }>;
  webhook_endpoints: Array<{ id: string; endpoint_url: string; is_active: boolean; delivery_enabled: boolean }>;
  recent_requests: Array<{ status_code?: number; error_code?: string; latency_ms?: number; created_at: string }>;
};

export function PartnerApiPortalScreen({ onBack }: { onBack: () => void }) {
  const tc = useThemeClasses();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('Server integration');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['customers:write', 'onboarding:write']);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [cidr, setCidr] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<{ title: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await backendAPI.partnerPortal.request<PortalData>('get_portal');
    if (result.success && result.data) setData(result.data);
    else setError(result.error || 'Could not load API access');
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: any, input: Record<string, unknown>, secretField?: string) => {
    setBusy(true);
    const result: any = await backendAPI.partnerPortal.request(action, input);
    if (!result.success) toast.error(result.error || 'Request failed');
    else {
      const secret = secretField ? result.data?.[secretField] : '';
      if (secret) setRevealedSecret({ title: secretField === 'plain_api_key' ? 'New API key' : 'New webhook secret', value: secret });
      toast.success('Saved');
      await load();
    }
    setBusy(false);
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success('Copied');
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-3xl mx-auto px-5 pt-5 pb-16">
        <button type="button" onClick={onBack} className={`mb-5 inline-flex items-center gap-2 text-sm ${tc.textMuted}`}><ArrowLeft className="w-4 h-4" /> Back</button>
        <div className="flex items-start justify-between gap-4 mb-6">
          <div><p className={`text-[10px] uppercase tracking-[0.2em] ${tc.textMuted}`}>Business</p><h1 className={`text-2xl font-semibold ${tc.text}`}>API & white-label</h1></div>
          <a href="https://docs.borderpayafrica.com" target="_blank" rel="noreferrer" className="h-10 px-3 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold inline-flex items-center gap-2">Docs <ExternalLink className="w-4 h-4" /></a>
        </div>

        {loading && <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5 ${tc.textMuted}`}>Loading approved API access…</div>}
        {!loading && error && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200"><strong>Access unavailable.</strong><p className="mt-1">{error}</p></div>}

        {data && <div className="space-y-5">
          <section className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
            <div className="flex items-center justify-between gap-3"><div><h2 className={`font-semibold ${tc.text}`}>{data.tenant.tenant_name}</h2><p className={`text-xs ${tc.textMuted}`}>{data.tenant.default_mode} · {data.tenant.rate_limit_per_minute} requests/minute</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${data.tenant.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{data.tenant.is_active ? 'Active' : 'Inactive'}</span></div>
            <p className={`mt-3 text-xs ${tc.textMuted}`}>Tenant mode, activation, onboarding policy, and published branding remain operator-controlled.</p>
          </section>

          {revealedSecret && <section className="rounded-2xl border border-[#C7FF00]/30 bg-[#C7FF00]/10 p-5"><h2 className="font-semibold text-[#C7FF00]">{revealedSecret.title} — copy it now</h2><p className="mt-1 text-xs text-white/60">This value will not be shown again.</p><div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 break-all rounded-xl bg-black/30 p-3 text-xs text-white">{revealedSecret.value}</code><button onClick={() => copy(revealedSecret.value)} className="h-10 w-10 rounded-xl bg-[#C7FF00] text-black flex items-center justify-center"><Copy className="w-4 h-4" /></button></div></section>}

          <section className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
            <div className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-[#C7FF00]" /><h2 className={`font-semibold ${tc.text}`}>API keys</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><input value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="Key label" className={`h-11 rounded-xl border ${tc.cardBorder} bg-transparent px-3 text-sm ${tc.text}`} /><button disabled={busy || selectedScopes.length === 0} onClick={() => run('create_api_key', { key_label: label, scopes: selectedScopes }, 'plain_api_key')} className="h-11 rounded-xl bg-[#C7FF00] px-4 text-sm font-semibold text-black disabled:opacity-50 inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Create key</button></div>
            <div className="mt-3 flex flex-wrap gap-2">{SCOPES.map(scope => <button key={scope} onClick={() => setSelectedScopes(v => v.includes(scope) ? v.filter(x => x !== scope) : [...v, scope])} className={`rounded-full px-2.5 py-1 text-[11px] border ${selectedScopes.includes(scope) ? 'border-[#C7FF00] text-[#C7FF00]' : `${tc.cardBorder} ${tc.textMuted}`}`}>{scope}</button>)}</div>
            <div className="mt-4 divide-y divide-white/10">{data.api_keys.map(key => <div key={key.id} className="py-3 flex items-center justify-between gap-3"><div className="min-w-0"><p className={`text-sm ${tc.text}`}>{key.key_label || key.key_prefix}</p><p className={`text-xs ${tc.textMuted} truncate`}>{key.key_prefix}… · {key.scopes.join(', ')}</p></div>{key.is_active && <button disabled={busy} onClick={() => run('revoke_api_key', { key_id: key.id })} className="text-xs text-red-300">Revoke</button>}</div>)}</div>
          </section>

          <section className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
            <div className="flex items-center gap-2"><Webhook className="w-5 h-5 text-[#C7FF00]" /><h2 className={`font-semibold ${tc.text}`}>Webhooks</h2></div>
            <div className="mt-4 flex gap-2"><input value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} placeholder="https://your-domain.com/webhooks/borderpay" className={`h-11 min-w-0 flex-1 rounded-xl border ${tc.cardBorder} bg-transparent px-3 text-sm ${tc.text}`} /><button disabled={busy || !endpointUrl} onClick={() => run('create_webhook_endpoint', { endpoint_url: endpointUrl }, 'signing_secret')} className="h-11 rounded-xl bg-[#C7FF00] px-4 text-sm font-semibold text-black disabled:opacity-50">Add</button></div>
            <div className="mt-4 divide-y divide-white/10">{data.webhook_endpoints.map(item => <div key={item.id} className="py-3 flex items-center justify-between gap-3"><p className={`text-xs truncate ${tc.text}`}>{item.endpoint_url}</p><div className="flex gap-3">{item.is_active && <><button disabled={busy} onClick={() => run('rotate_webhook_secret', { webhook_id: item.id }, 'signing_secret')} className={`text-xs ${tc.textMuted}`}>Rotate</button><button disabled={busy} onClick={() => run('disable_webhook_endpoint', { webhook_id: item.id })} className="text-xs text-red-300">Disable</button></>}</div></div>)}</div>
          </section>

          <section className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
            <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-[#C7FF00]" /><h2 className={`font-semibold ${tc.text}`}>IP allowlist</h2></div>
            <div className="mt-4 flex gap-2"><input value={cidr} onChange={e => setCidr(e.target.value)} placeholder="203.0.113.10/32" className={`h-11 min-w-0 flex-1 rounded-xl border ${tc.cardBorder} bg-transparent px-3 text-sm ${tc.text}`} /><button disabled={busy || !cidr} onClick={() => run('add_ip_allowlist', { cidr_block: cidr })} className="h-11 rounded-xl bg-[#C7FF00] px-4 text-sm font-semibold text-black disabled:opacity-50">Add</button></div>
            <div className="mt-4 divide-y divide-white/10">{data.ip_allowlist.map(item => <div key={item.id} className="py-3 flex items-center justify-between"><span className={`text-sm ${tc.text}`}>{item.cidr_block}</span>{item.is_active && <button disabled={busy} onClick={() => run('disable_ip_allowlist', { allowlist_id: item.id })} className="text-xs text-red-300">Disable</button>}</div>)}</div>
          </section>

          <button type="button" disabled={loading} onClick={load} className={`inline-flex items-center gap-2 text-sm ${tc.textMuted}`}><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>}
      </div>
    </div>
  );
}
