/**
 * BorderPay Africa - Support Screen
 * Ticket-based in-app support (shared backend for app + website + admin).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { HelpCircle, MessageSquare, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type SupportTicket } from '../../utils/api/backendAPI';

interface SupportScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const ISSUE_TYPES = [
  { key: 'account_access', label: 'Account access' },
  { key: 'verification', label: 'Verification' },
  { key: 'wallet_balances', label: 'Wallet / balances' },
  { key: 'send_receive', label: 'Send / receive' },
  { key: 'general', label: 'General' },
] as const;

export function SupportScreen({ onBack, onNavigate }: SupportScreenProps) {
  const tc = useThemeClasses();
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPES)[number]['key']>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [creating, setCreating] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const statusLabel = useMemo<Record<SupportTicket['status'], string>>(
    () => ({
      open: 'Open',
      pending_support: 'Pending support',
      pending_user: 'Action needed',
      resolved: 'Resolved',
      closed: 'Closed',
    }),
    [],
  );

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const res = await backendAPI.support.listTickets(20);
      if (res.success) setTickets(res.data?.tickets || []);
      else toast.error(res.error || 'Could not load support tickets');
    } catch {
      toast.error('Could not load support tickets');
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const submitTicket = async () => {
    if (!subject.trim()) {
      toast.error('Please add a subject');
      return;
    }
    if (!message.trim()) {
      toast.error('Please describe your issue');
      return;
    }
    setCreating(true);
    try {
      const res = await backendAPI.support.createTicket({
        issue_type: issueType,
        subject: subject.trim(),
        message: message.trim(),
        source: 'app',
      });
      if (!res.success) {
        toast.error(res.error || 'Could not create support ticket');
        return;
      }
      toast.success('Support ticket created');
      setSubject('');
      setMessage('');
      await loadTickets();
    } catch {
      toast.error('Could not create support ticket');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      <FloatingBackButton onBack={onBack} />

      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <div className="w-10" />
          <h1 className={`text-lg font-bold ${tc.text}`}>Support</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-6 py-6 space-y-4">
        <button
          onClick={() => onNavigate?.('help-center')}
          className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 flex items-center gap-3 active:opacity-80 transition-opacity`}
        >
          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
            <HelpCircle size={18} className="text-blue-400" />
          </div>
          <div className="flex-1 text-left">
            <p className={`text-sm font-semibold ${tc.text}`}>Help Center</p>
            <p className={`text-xs ${tc.textSecondary}`}>Find quick answers and product guidance</p>
          </div>
          <ChevronRight size={16} className={tc.textSecondary} />
        </button>

        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 space-y-3`}>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-[#C7FF00]" />
            <p className={`text-sm font-semibold ${tc.text}`}>Contact support</p>
          </div>

          <div>
            <label className={`block text-xs ${tc.textSecondary} mb-1`}>Issue type</label>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as (typeof ISSUE_TYPES)[number]['key'])}
              className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none`}
            >
              {ISSUE_TYPES.map((type) => (
                <option key={type.key} value={type.key}>{type.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-xs ${tc.textSecondary} mb-1`}>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short title for your issue"
              className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none`}
            />
          </div>

          <div>
            <label className={`block text-xs ${tc.textSecondary} mb-1`}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe your issue briefly..."
              className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none resize-none`}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={submitTicket}
              disabled={creating}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-4 py-2.5 disabled:opacity-60"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : null}
              Submit ticket
            </button>
            <button
              onClick={() => void loadTickets()}
              disabled={loadingTickets}
              className={`rounded-xl border ${tc.cardBorder} ${tc.text} text-sm px-4 py-2.5 disabled:opacity-60`}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
          <div className="flex items-center justify-between mb-3">
            <p className={`text-sm font-semibold ${tc.text}`}>Your tickets</p>
            {loadingTickets ? <Loader2 size={14} className="animate-spin text-[#C7FF00]" /> : null}
          </div>
          {tickets.length === 0 ? (
            <p className={`text-sm ${tc.textSecondary}`}>No support tickets yet.</p>
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <div key={t.id} className={`rounded-xl border ${tc.cardBorder} ${tc.bgAlt} px-3 py-2.5`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-sm font-medium ${tc.text} truncate`}>{t.subject}</p>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#C7FF00]/15 text-[#C7FF00]">
                      {statusLabel[t.status]}
                    </span>
                  </div>
                  <p className={`text-xs ${tc.textSecondary} mt-1`}>
                    {new Date(t.last_message_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
