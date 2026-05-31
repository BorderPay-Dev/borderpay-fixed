/**
 * NotificationsScreen — full-page notification inbox.
 *
 * Reads via `backendAPI.notifications.getNotifications`. Each row supports
 * mark-as-read on tap and per-row delete. A "Mark all as read" header
 * action calls `mark-all-notifications-read`.
 *
 * AppShell owns the top chrome on top-level routes; this renders body-only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, CheckCheck, Trash2, AlertCircle, Loader2, ChevronLeft,
  ArrowDownLeft, ArrowUpRight, ShieldCheck, Sparkles, Info,
} from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface NotificationRow {
  id:           string;
  user_id?:     string;
  title?:       string | null;
  body?:        string | null;
  message?:     string | null;        // legacy field
  type?:        string | null;        // 'transaction' | 'security' | 'kyc' | ...
  category?:    string | null;
  read?:        boolean;
  read_at?:     string | null;
  created_at:   string;
  metadata?:    Record<string, any>;
}

interface NotificationsScreenProps {
  onBack: () => void;
}

function notifIcon(type?: string | null) {
  const t = (type || '').toLowerCase();
  if (t.includes('credit') || t.includes('deposit') || t.includes('received')) return ArrowDownLeft;
  if (t.includes('debit') || t.includes('send') || t.includes('transfer')) return ArrowUpRight;
  if (t.includes('kyc') || t.includes('verify') || t.includes('identity')) return ShieldCheck;
  if (t.includes('plan') || t.includes('subscription') || t.includes('upgrade')) return Sparkles;
  if (t.includes('security') || t.includes('login') || t.includes('pin') || t.includes('2fa')) return ShieldCheck;
  return Info;
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now  = Date.now();
    const sec  = Math.max(1, Math.floor((now - then) / 1000));
    if (sec < 60)  return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `${min}m ago`;
    const hr  = Math.floor(min / 60);
    if (hr  < 24)  return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7)   return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

export function NotificationsScreen({ onBack }: NotificationsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [rows, setRows]       = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r: any = await backendAPI.notifications.getNotifications(50);
      // The edge function may return either `{ data: { notifications: [...] } }`
      // or `{ data: [...] }` — handle both shapes defensively.
      const data: any =
          Array.isArray(r?.data?.notifications) ? r.data.notifications
        : Array.isArray(r?.data)                 ? r.data
        : Array.isArray(r?.notifications)        ? r.notifications
        : [];
      setRows(data);
      if (!r?.success && r?.error) setError(r.error);
    } catch (e: any) {
      setError(e?.message || 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unreadCount = useMemo(() => rows.filter(n => !n.read).length, [rows]);

  const handleMarkRead = async (n: NotificationRow) => {
    if (n.read) return;
    setBusyId(n.id);
    setRows(prev => prev.map(r => r.id === n.id ? { ...r, read: true } : r));
    try {
      await backendAPI.notifications.markAsRead(n.id);
    } catch { /* keep optimistic */ }
    finally { setBusyId(null); }
  };

  const handleMarkAllRead = async () => {
    setRows(prev => prev.map(r => ({ ...r, read: true })));
    try { await backendAPI.notifications.markAllAsRead(); } catch { /* ignore */ }
  };

  const handleDelete = async (n: NotificationRow) => {
    setBusyId(n.id);
    setRows(prev => prev.filter(r => r.id !== n.id));
    try { await backendAPI.notifications.deleteNotification(n.id); } catch { /* ignore */ }
    finally { setBusyId(null); }
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                aria-label="Back"
                className={`-ml-2 p-2 rounded-full ${tc.hoverBg} transition-colors`}
              >
                <ChevronLeft className={`w-5 h-5 ${tc.text}`} />
              </button>
            )}
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
              {tt('notifications.title', 'Notifications')}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#C7FF00] hover:underline"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${tc.text}`}>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-16 rounded-2xl ${tc.bgAlt} animate-pulse`} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} px-6 py-12 text-center`}>
            <div className={`w-14 h-14 rounded-2xl ${tc.bgAlt} flex items-center justify-center mx-auto mb-4`}>
              <Bell className={`w-6 h-6 ${tc.textMuted}`} />
            </div>
            <p className={`text-sm font-semibold ${tc.text} mb-1`}>You're all caught up</p>
            <p className={`text-xs ${tc.textMuted}`}>
              Transaction updates, security alerts, and plan changes will appear here.
            </p>
          </div>
        ) : (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
            <AnimatePresence initial={false}>
              {rows.map((n, i) => {
                const Icon = notifIcon(n.type);
                const message = (n.body || n.message || '').toString();
                return (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`px-4 py-3.5 flex items-start gap-3 cursor-pointer ${tc.hoverBg} ${i > 0 ? `border-t ${tc.borderLight}` : ''} ${!n.read ? 'bg-white/[0.02]' : ''}`}
                    onClick={() => handleMarkRead(n)}
                  >
                    <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${tc.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm font-semibold ${tc.text} truncate`}>
                          {n.title || (n.type ? n.type.replace(/_/g, ' ') : 'Notification')}
                        </p>
                        {!n.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF00] flex-shrink-0" aria-label="Unread" />
                        )}
                      </div>
                      {message && (
                        <p className={`text-[12px] ${tc.textSecondary} leading-snug line-clamp-2`}>
                          {message}
                        </p>
                      )}
                      <p className={`text-[10px] ${tc.textMuted} mt-1`}>{relativeTime(n.created_at)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDelete(n); }}
                      disabled={busyId === n.id}
                      aria-label="Delete notification"
                      className={`p-1.5 rounded-full ${tc.hoverBg} text-red-400 flex-shrink-0`}
                    >
                      {busyId === n.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <button
          onClick={onBack}
          className={`mt-6 text-[11px] font-semibold ${tc.textMuted} hover:${tc.text}`}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default NotificationsScreen;
