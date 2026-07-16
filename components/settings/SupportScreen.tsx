/**
 * BorderPay Africa - Support Screen
 * User-only in-app support for borderpay-fixed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { HelpCircle, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type SupportTicket, type SupportTicketMessage } from '../../utils/api/backendAPI';

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

const SUPPORT_TICKETS_CACHE_KEY = 'borderpay_support_tickets_v1';
const SUPPORT_TICKETS_REFRESH_TS_KEY = 'borderpay_support_tickets_refresh_ts_v1';
const SUPPORT_LOAD_TIMEOUT_MS = 1400;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function SupportScreen({ onBack, onNavigate }: SupportScreenProps) {
  const tc = useThemeClasses();
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPES)[number]['key']>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>(() => {
    try {
      const raw = localStorage.getItem(SUPPORT_TICKETS_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicketMessages, setSelectedTicketMessages] = useState<SupportTicketMessage[]>([]);
  const [ticketThreadCache, setTicketThreadCache] = useState<Record<string, SupportTicketMessage[]>>({});
  const [loadingTicketThread, setLoadingTicketThread] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

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
    try {
      const last = Number(localStorage.getItem(SUPPORT_TICKETS_REFRESH_TS_KEY) || '0');
      if (tickets.length > 0 && Number.isFinite(last) && Date.now() - last < 45_000) return;
    } catch {
      // noop
    }

    if (tickets.length === 0) setLoadingTickets(true);
    try {
      const res: any = await withTimeout(
        backendAPI.support.listTickets(20),
        SUPPORT_LOAD_TIMEOUT_MS,
        { success: false, error: 'request_timeout', data: { tickets: [] } } as any,
      );
      if (res.success) {
        const next = res.data?.tickets || [];
        setTickets(next);
        try { localStorage.setItem(SUPPORT_TICKETS_CACHE_KEY, JSON.stringify(next)); } catch {}
        try { localStorage.setItem(SUPPORT_TICKETS_REFRESH_TS_KEY, String(Date.now())); } catch {}
      } else if (tickets.length === 0) {
        toast.error(res.error || 'Could not load support tickets');
      }
    } catch {
      if (tickets.length === 0) toast.error('Could not load support tickets');
    } finally {
      setLoadingTickets(false);
    }
  }, [tickets.length]);

  const loadTicketThread = useCallback(async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    const cached = ticketThreadCache[ticketId];
    if (cached) setSelectedTicketMessages(cached);
    setLoadingTicketThread(true);
    try {
      const res: any = await withTimeout(
        backendAPI.support.getTicket(ticketId),
        SUPPORT_LOAD_TIMEOUT_MS,
        { success: false, error: 'request_timeout', data: { messages: cached || [] } } as any,
      );
      if (!res.success) {
        if (!cached && res.error !== 'request_timeout') toast.error(res.error || 'Could not load ticket');
        return;
      }
      const rows = res.data?.messages || [];
      setSelectedTicketMessages(rows);
      setTicketThreadCache((prev) => ({ ...prev, [ticketId]: rows }));
    } catch {
      toast.error('Could not load ticket');
    } finally {
      setLoadingTicketThread(false);
    }
  }, [ticketThreadCache]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (selectedTicketId || tickets.length === 0) return;
    void loadTicketThread(tickets[0].id);
  }, [tickets, selectedTicketId, loadTicketThread]);

  const createTicket = useCallback(async () => {
    if (!subject.trim()) {
      toast.error('Please add a subject');
      return;
    }
    if (!message.trim()) {
      toast.error('Please describe the issue');
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
      if (!res.success || !res.data?.ticket_id) {
        toast.error(res.error || 'Could not submit ticket');
        return;
      }
      setSubject('');
      setMessage('');
      await loadTickets();
      await loadTicketThread(res.data.ticket_id);
      toast.success('Support ticket created');
    } catch {
      toast.error('Could not submit ticket');
    } finally {
      setCreating(false);
    }
  }, [issueType, loadTicketThread, loadTickets, message, subject]);

  const sendReply = useCallback(async () => {
    if (!selectedTicketId) return;
    if (!replyMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    setSendingReply(true);
    try {
      const res = await backendAPI.support.addMessage(selectedTicketId, replyMessage.trim());
      if (!res.success) {
        toast.error(res.error || 'Could not send message');
        return;
      }
      setReplyMessage('');
      await loadTicketThread(selectedTicketId);
      await loadTickets();
      toast.success('Message sent');
    } catch {
      toast.error('Could not send message');
    } finally {
      setSendingReply(false);
    }
  }, [loadTicketThread, loadTickets, replyMessage, selectedTicketId]);

  return (
    <div className={`min-h-screen ${tc.bg} pb-24`}>
      <div className="max-w-5xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-3 mb-4">
          <FloatingBackButton onBack={onBack} />
          <div>
            <h1 className={`text-2xl font-bold ${tc.text}`}>Support</h1>
            <p className={`text-sm ${tc.textSecondary}`}>Open a ticket and chat with BorderPay support.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <div className="flex items-center gap-2 mb-3">
              <HelpCircle size={16} className="text-[#C7FF00]" />
              <p className={`text-sm font-semibold ${tc.text}`}>Create ticket</p>
            </div>

            <div className="space-y-2">
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as (typeof ISSUE_TYPES)[number]['key'])}
                className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none`}
              >
                {ISSUE_TYPES.map((it) => (
                  <option key={it.key} value={it.key}>{it.label}</option>
                ))}
              </select>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none`}
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="Describe your issue"
                className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none resize-none`}
              />
              <button
                onClick={() => void createTicket()}
                disabled={creating}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-4 py-2.5 disabled:opacity-60"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : null}
                Submit ticket
              </button>
            </div>
          </div>

          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-[#C7FF00]" />
                <p className={`text-sm font-semibold ${tc.text}`}>Your tickets</p>
              </div>
              {loadingTickets ? <Loader2 size={14} className="animate-spin text-[#C7FF00]" /> : null}
            </div>

            {tickets.length === 0 ? (
              <p className={`text-sm ${tc.textSecondary}`}>No chats yet. Start one on the left.</p>
            ) : (
              <div className="space-y-2 mb-3 max-h-56 overflow-y-auto">
                {tickets.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => void loadTicketThread(t.id)}
                    className={`w-full text-left rounded-xl border ${tc.cardBorder} ${tc.bgAlt} px-3 py-2.5`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm font-medium ${tc.text} truncate`}>{t.subject}</p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#C7FF00]/15 text-[#C7FF00]">
                        {statusLabel[t.status]}
                      </span>
                    </div>
                    <p className={`text-xs ${tc.textSecondary} mt-1`}>{new Date(t.last_message_at).toLocaleString()}</p>
                  </button>
                ))}
              </div>
            )}

            {selectedTicketId ? (
              <div className={`rounded-xl border ${tc.cardBorder} ${tc.bgAlt} p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-xs ${tc.textSecondary}`}>Conversation</p>
                  {loadingTicketThread ? <Loader2 size={13} className="animate-spin text-[#C7FF00]" /> : null}
                </div>

                <div className="space-y-2 mb-3 max-h-56 overflow-y-auto">
                  {selectedTicketMessages.length === 0 ? (
                    <p className={`text-sm ${tc.textSecondary}`}>No messages yet.</p>
                  ) : selectedTicketMessages.map((m) => {
                    const mine = m.sender_type === 'user';
                    return (
                      <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${mine ? 'bg-[#C7FF00]/12 border border-[#C7FF00]/25' : `${tc.bg} border ${tc.cardBorder}`}`}>
                        <p className={tc.text}>{m.body}</p>
                        <p className={`text-[11px] mt-1 ${tc.textSecondary}`}>
                          {m.sender_type === 'agent' ? 'Support' : m.sender_type === 'assistant' ? 'Assistant' : 'You'} • {new Date(m.created_at).toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <textarea
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={3}
                    placeholder="Type your reply…"
                    className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bg} ${tc.text} px-3 py-2 text-sm outline-none resize-none`}
                  />
                  <button
                    onClick={() => void sendReply()}
                    disabled={sendingReply}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-4 py-2.5 disabled:opacity-60"
                  >
                    {sendingReply ? <Loader2 size={15} className="animate-spin" /> : null}
                    Send
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <button
          onClick={() => onNavigate?.('help-center')}
          className={`mt-4 w-full rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3 text-left`}
        >
          <p className={`text-sm font-medium ${tc.text}`}>Help center</p>
          <p className={`text-xs ${tc.textSecondary}`}>See onboarding, verification, and transfer guidance.</p>
        </button>
      </div>
    </div>
  );
}
