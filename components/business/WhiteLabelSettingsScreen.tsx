import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ImagePlus, Palette, Save, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type WhiteLabelBranding } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { authAPI } from '../../utils/supabase/client';

const DEFAULT_BRANDING: WhiteLabelBranding = {
  app_name: 'BorderPay',
  logo_url: null,
  primary_color: '#C7FF00',
  background_color: '#0B0E11',
  background_accent: '#1A1F26',
};

function cacheKey(userId: string) {
  return `borderpay_white_label_branding_v1:${userId}`;
}

function readCachedBranding(userId: string): WhiteLabelBranding {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) };
  } catch { /* noop */ }
  const stored = authAPI.getStoredUser();
  const name = String(stored?.company_name || '').trim();
  return { ...DEFAULT_BRANDING, app_name: name || DEFAULT_BRANDING.app_name };
}

function writeCachedBranding(userId: string, branding: WhiteLabelBranding) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(branding));
    window.dispatchEvent(new CustomEvent('borderpay:white_label_branding_updated', { detail: branding }));
  } catch { /* noop */ }
}

export function WhiteLabelSettingsScreen({ userId, onBack }: { userId: string; onBack: () => void }) {
  const tc = useThemeClasses();
  const initial = useMemo(() => readCachedBranding(userId), [userId]);
  const [branding, setBranding] = useState<WhiteLabelBranding>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;
    backendAPI.whiteLabel.get().then((res: any) => {
      if (!alive || !res?.success || !res?.data?.branding) return;
      setBranding(res.data.branding);
      writeCachedBranding(userId, res.data.branding);
    });
    return () => { alive = false; };
  }, [userId]);

  const update = (patch: Partial<WhiteLabelBranding>) => {
    setBranding((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await backendAPI.whiteLabel.save(branding);
      if (!res.success || !res.data?.branding) {
        toast.error(res.error || 'Could not save white-label settings.');
        return;
      }
      setBranding(res.data.branding);
      writeCachedBranding(userId, res.data.branding);
      toast.success('White-label settings saved.');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await backendAPI.whiteLabel.uploadLogo(file);
      if (!res.success || !res.data?.branding) {
        toast.error(res.error || 'Could not upload logo.');
        return;
      }
      setBranding(res.data.branding);
      writeCachedBranding(userId, res.data.branding);
      toast.success('Logo uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const previewStyle = {
    background:
      `radial-gradient(circle at 85% 0%, ${branding.primary_color}24, transparent 34%), ` +
      `linear-gradient(145deg, ${branding.background_color}, ${branding.background_accent})`,
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-5 pt-5 pb-10">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center ${tc.hoverBg}`}
            aria-label="Back"
          >
            <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Business</p>
            <h1 className={`text-xl font-semibold ${tc.text}`}>White label</h1>
          </div>
        </div>

        <div className={`${tc.card} border ${tc.cardBorder} rounded-3xl overflow-hidden mb-6`}>
          <div className="p-5" style={previewStyle}>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center overflow-hidden">
                {branding.logo_url ? (
                  <img src={branding.logo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-6 h-6 text-white/70" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-white/50 uppercase tracking-[0.18em]">App preview</p>
                <p className="text-white text-lg font-semibold truncate">{branding.app_name}</p>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-2">
              {['Wallet', 'Send', 'Receive'].map((label) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-center">
                  <div className="w-7 h-7 rounded-full mx-auto mb-2" style={{ backgroundColor: branding.primary_color }} />
                  <p className="text-[11px] font-semibold text-white">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <label className={`block text-xs font-semibold ${tc.textSecondary} mb-2`}>App name</label>
            <input
              value={branding.app_name}
              maxLength={40}
              onChange={(e) => update({ app_name: e.target.value })}
              className={`w-full h-12 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-4 ${tc.text} outline-none`}
              placeholder="Your app name"
            />
          </div>

          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <label className={`block text-xs font-semibold ${tc.textSecondary} mb-2`}>Logo</label>
            <div className="flex gap-2">
              <input
                value={branding.logo_url || ''}
                onChange={(e) => update({ logo_url: e.target.value || null })}
                className={`min-w-0 flex-1 h-12 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-4 ${tc.text} outline-none`}
                placeholder="https://..."
              />
              <label className={`h-12 px-4 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} ${tc.text} flex items-center justify-center gap-2 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                <Upload className="w-4 h-4" />
                <span className="text-sm font-semibold">{uploading ? 'Uploading' : 'Upload'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => uploadLogo(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            <p className={`mt-2 text-[11px] ${tc.textMuted}`}>PNG, JPG, WEBP, or SVG. Max 1MB.</p>
          </div>

          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <div className="flex items-center gap-2 mb-4">
              <Palette className="w-4 h-4 text-[#C7FF00]" />
              <p className={`text-xs font-semibold ${tc.textSecondary}`}>Theme</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                ['Accent', 'primary_color'],
                ['Background', 'background_color'],
                ['Background accent', 'background_accent'],
              ].map(([label, key]) => (
                <label key={key} className={`${tc.bgAlt} border ${tc.cardBorder} rounded-xl p-3`}>
                  <span className={`block text-[11px] ${tc.textMuted} mb-2`}>{label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={(branding as any)[key]}
                      onChange={(e) => update({ [key]: e.target.value } as any)}
                      className="w-9 h-9 rounded-lg bg-transparent"
                    />
                    <span className={`text-xs font-mono ${tc.text}`}>{(branding as any)[key]}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="w-full h-12 rounded-2xl bg-[#C7FF00] text-black font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save white-label settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WhiteLabelSettingsScreen;
