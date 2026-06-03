/**
 * TeamScreen — business team management UI.
 *
 * Surface:
 *   • Header with seat usage ("3 of 5 seats used") and plan badge.
 *   • Invite row (email + role picker) gated to owner/admin.
 *   • Member list grouped by status (active → invited → suspended), with
 *     per-row remove button for owners/admins (and never on owner rows).
 *
 * Server-driven authorisation: the edge functions enforce role + seat-cap
 * rules and return structured codes. This screen renders those codes
 * cleanly:
 *   • 402 plan_required → opens the global UpgradeModal via the existing
 *     `borderpay:plan_required` DOM event (apiCall dispatches it).
 *   • 403 forbidden_role → renders inline as a disabled-form notice.
 *
 * Account-type guard:
 *   • Renders a friendly "Business plans only" notice for individual users.
 *     MainApp routes 'team' for individuals to this screen (we don't hide
 *     the drawer entry), so the notice is the safety net.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft, UserPlus, Trash2, Sparkles, Loader2, Mail, ShieldCheck,
  AlertCircle, Building2, Crown, ChevronDown,
} from 'lucide-react';
import { backendAPI, type TeamMemberRow, type TeamRosterResponse, type TeamRole } from '../../utils/api/backendAPI';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';

export interface TeamScreenProps {
  onBack: () => void;
  /** Open /pricing — for upgrade CTAs when seat cap is reached. */
  onManagePlans: () => void;
  /** Account type — passed by MainApp; individuals get the placeholder. */
  accountType: 'individual' | 'business';
}

const ROLE_LABEL: Record<TeamRole, string> = {
  owner:  'Owner',
  admin:  'Admin',
  member: 'Member',
  viewer: 'Viewer',
};
const STATUS_LABEL: Record<string, string> = {
  active:    'Active',
  invited:   'Invited',
  suspended: 'Suspended',
  removed:   'Removed',
};
const TEAM_LOAD_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function TeamScreen({ onBack, onManagePlans, accountType }: TeamScreenProps) {
  const tc = useThemeClasses();
  const { t } = useThemeLanguage();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  // ── Individual-account placeholder ────────────────────────────────────
  if (accountType !== 'business') {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <Header tc={tc} onBack={onBack} title="Team members" />
        <div className="max-w-2xl mx-auto px-5 py-12 text-center">
          <Building2 className={`w-10 h-10 ${tc.textMuted} mx-auto mb-3`} />
          <h2 className={`text-base font-semibold ${tc.text} mb-1`}>
            Team management is for business accounts
          </h2>
          <p className={`text-sm ${tc.textMuted} max-w-xs mx-auto`}>
            Switch to a business account to invite team members and assign roles.
          </p>
        </div>
      </div>
    );
  }

  return <BusinessTeamPanel tc={tc} tt={tt} onBack={onBack} onManagePlans={onManagePlans} />;
}

// ──────────────────────────────────────────────────────────────────────────
function BusinessTeamPanel({
  tc, tt, onBack, onManagePlans,
}: {
  tc: ReturnType<typeof useThemeClasses>;
  tt: (k: string, fb: string) => string;
  onBack: () => void;
  onManagePlans: () => void;
}) {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [roster, setRoster]     = useState<TeamRosterResponse | null>(null);
  const [busyId, setBusyId]     = useState<string | null>(null);

  // Invite form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail]           = useState('');
  const [role, setRole]             = useState<Exclude<TeamRole, 'owner'>>('member');
  const [inviting, setInviting]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await withTimeout(
        backendAPI.team.list(),
        TEAM_LOAD_TIMEOUT_MS,
        'Team is taking longer than expected. Please try again.'
      );
      if (r.success && r.data) {
        setRoster(r.data);
      } else {
        setError(r.error || 'Could not load team');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canManage = roster?.caller_role === 'owner' || roster?.caller_role === 'admin';
  const seatsLeft = useMemo(() => {
    if (!roster) return null;
    if (roster.seats.cap === null) return Infinity;
    return Math.max(0, roster.seats.cap - roster.seats.used);
  }, [roster]);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true); setError(null);
    try {
      const r = await backendAPI.team.invite({ email: email.trim(), role });
      if (r.success) {
        setEmail('');
        setInviteOpen(false);
        await load();
      } else {
        // 402 plan_required is auto-intercepted globally → UpgradeModal opens.
        // Surface other errors inline.
        const code = (r as any)?.code;
        if (code !== 'plan_required') setError(r.error || 'Could not send invite');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not send invite');
    } finally {
      setInviting(false);
    }
  };

  const submitRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from the team? They will lose access immediately.`)) return;
    setBusyId(memberId);
    try {
      const r = await backendAPI.team.remove(memberId);
      if (r.success) {
        await load();
      } else {
        setError(r.error || 'Could not remove member');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not remove member');
    } finally {
      setBusyId(null);
    }
  };

  // Group members by status for tidy stacking
  const grouped = useMemo(() => {
    const g: Record<string, TeamMemberRow[]> = { active: [], invited: [], suspended: [] };
    for (const m of (roster?.members || [])) {
      if (m.status === 'removed') continue;
      g[m.status]?.push(m);
    }
    return g;
  }, [roster]);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <Header tc={tc} onBack={onBack} title="Team members" />

      <div className="max-w-2xl mx-auto px-5 py-5 space-y-5">
        {/* Plan + seats summary */}
        {roster && (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3 flex items-center gap-3`}>
            <div className="w-10 h-10 rounded-full bg-[#C7FF00] text-black flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${tc.text}`}>
                {roster.plan.plan_key.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </p>
              <p className={`text-[11px] ${tc.textMuted}`}>
                {roster.seats.cap === null
                  ? `${roster.seats.used} ${roster.seats.used === 1 ? 'seat' : 'seats'} · unlimited`
                  : `${roster.seats.used} of ${roster.seats.cap} seats used`}
              </p>
            </div>
            {roster.seats.cap !== null && (
              <button
                type="button"
                onClick={onManagePlans}
                className="text-[11px] font-semibold text-[#C7FF00] flex-shrink-0"
              >
                Manage plan
              </button>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className={`text-xs ${tc.text}`}>{error}</p>
              <button
                type="button"
                onClick={load}
                className="mt-2 text-xs font-semibold text-red-200 hover:text-white"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Invite form */}
        {canManage && (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card}`}>
            <button
              type="button"
              onClick={() => setInviteOpen(v => !v)}
              className="w-full flex items-center gap-3 px-4 py-3.5"
              aria-expanded={inviteOpen}
            >
              <div className="w-9 h-9 rounded-full bg-[#C7FF00]/15 flex items-center justify-center flex-shrink-0">
                <UserPlus className="w-4 h-4 text-[#C7FF00]" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className={`text-sm font-semibold ${tc.text}`}>Invite a teammate</p>
                <p className={`text-[11px] ${tc.textMuted}`}>
                  {seatsLeft === Infinity
                    ? 'Unlimited seats on your plan'
                    : `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} available`}
                </p>
              </div>
              <ChevronDown
                className={`w-4 h-4 ${tc.textMuted} transition-transform ${inviteOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {inviteOpen && (
              <form onSubmit={submitInvite} className={`px-4 pb-4 pt-1 border-t ${tc.borderLight}`}>
                <label className={`block text-[11px] font-semibold ${tc.textSecondary} mt-3 mb-1.5 uppercase tracking-wider`}>
                  Email
                </label>
                <div className={`flex items-center gap-2 rounded-xl border ${tc.cardBorder} ${tc.bgAlt} px-3 py-2`}>
                  <Mail className={`w-4 h-4 ${tc.textMuted}`} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teammate@company.com"
                    required
                    autoComplete="email"
                    className={`flex-1 bg-transparent ${tc.text} text-sm outline-none placeholder:${tc.textMuted}`}
                  />
                </div>
                <label className={`block text-[11px] font-semibold ${tc.textSecondary} mt-3 mb-1.5 uppercase tracking-wider`}>
                  Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['admin','member','viewer'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`px-2 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        role === r
                          ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                          : `${tc.bgAlt} ${tc.text} ${tc.cardBorder}`
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={inviting || !email.trim()}
                  className="mt-4 w-full h-11 rounded-xl bg-[#C7FF00] text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition active:scale-[0.98]"
                >
                  {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  {inviting ? 'Sending invite…' : 'Send invite'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className={`h-16 rounded-2xl ${tc.bgAlt} animate-pulse`} />)}
          </div>
        )}

        {/* Member list, grouped */}
        {!loading && roster && (
          <>
            <MemberGroup label="Active" rows={grouped.active} tc={tc} canManage={canManage} busyId={busyId} onRemove={submitRemove} />
            <MemberGroup label="Invited" rows={grouped.invited} tc={tc} canManage={canManage} busyId={busyId} onRemove={submitRemove} />
            <MemberGroup label="Suspended" rows={grouped.suspended} tc={tc} canManage={canManage} busyId={busyId} onRemove={submitRemove} />

            <div className={`flex items-center justify-center gap-1.5 pt-2 pb-4`}>
              <ShieldCheck className="w-3 h-3 text-[#C7FF00]" />
              <span className={`text-[10px] ${tc.textMuted}`}>
                Roles + seats enforced server-side on every action
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function MemberGroup({
  label, rows, tc, canManage, busyId, onRemove,
}: {
  label: string;
  rows: TeamMemberRow[];
  tc: ReturnType<typeof useThemeClasses>;
  canManage: boolean;
  busyId: string | null;
  onRemove: (id: string, email: string) => void;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <h3 className={`text-[11px] font-semibold ${tc.textSecondary} uppercase tracking-wider mb-2 px-1`}>
        {label} · {rows.length}
      </h3>
      <div className="space-y-2">
        {rows.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3 flex items-center gap-3`}
          >
            <div className={`w-9 h-9 rounded-full ${m.role === 'owner' ? 'bg-[#C7FF00] text-black' : 'bg-white/10 ' + tc.text} flex items-center justify-center font-bold text-xs flex-shrink-0`}>
              {m.role === 'owner'
                ? <Crown className="w-4 h-4" />
                : (m.invited_email[0] || '?').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${tc.text} truncate`}>{m.invited_email}</p>
              <p className={`text-[11px] ${tc.textMuted} flex items-center gap-1.5`}>
                <span>{ROLE_LABEL[m.role]}</span>
                <span>·</span>
                <span>{STATUS_LABEL[m.status]}</span>
              </p>
            </div>
            {canManage && m.role !== 'owner' && (
              <button
                type="button"
                onClick={() => onRemove(m.id, m.invited_email)}
                disabled={busyId === m.id}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-red-400 hover:bg-red-500/10 disabled:opacity-50 flex-shrink-0`}
                aria-label={`Remove ${m.invited_email}`}
              >
                {busyId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
function Header({
  tc, onBack, title,
}: { tc: ReturnType<typeof useThemeClasses>; onBack: () => void; title: string }) {
  return (
    <div className={`sticky top-0 z-10 ${tc.headerBg} border-b ${tc.borderLight}`}>
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className={`p-2 -ml-2 rounded-full ${tc.hoverBg}`}>
          <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
        </button>
        <h1 className={`text-base font-semibold ${tc.text}`}>{title}</h1>
      </div>
    </div>
  );
}

export default TeamScreen;
