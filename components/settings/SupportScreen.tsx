/**
 * BorderPay Africa - Support Screen
 * Ticket-based in-app support (shared backend for app + website + admin).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { HelpCircle, MessageSquare, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type SupportHealthStatus, type SupportTicket, type SupportTicketMessage } from '../../utils/api/backendAPI';

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
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicketMessages, setSelectedTicketMessages] = useState<SupportTicketMessage[]>([]);
  const [loadingTicketThread, setLoadingTicketThread] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTickets, setAdminTickets] = useState<SupportTicket[]>([]);
  const [loadingAdminTickets, setLoadingAdminTickets] = useState(false);
  const [selectedAdminTicketId, setSelectedAdminTicketId] = useState<string | null>(null);
  const [selectedAdminTicketMessages, setSelectedAdminTicketMessages] = useState<SupportTicketMessage[]>([]);
  const [loadingAdminThread, setLoadingAdminThread] = useState(false);
  const [adminReplyMessage, setAdminReplyMessage] = useState('');
  const [sendingAdminReply, setSendingAdminReply] = useState(false);
  const [adminStatusUpdating, setAdminStatusUpdating] = useState(false);
  const [draftingAI, setDraftingAI] = useState(false);
  const [supportHealth, setSupportHealth] = useState<SupportHealthStatus | null>(null);
  const [loadingSupportHealth, setLoadingSupportHealth] = useState(false);
  const [adminTargetEmail, setAdminTargetEmail] = useState('');
  const [adminControlBusy, setAdminControlBusy] = useState(false);
  const [adminControlResult, setAdminControlResult] = useState<string>('');
  const [adminControlDryRun, setAdminControlDryRun] = useState(true);

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

  const loadAdminTickets = useCallback(async () => {
    setLoadingAdminTickets(true);
    try {
      const res = await backendAPI.support.adminListTickets({ limit: 50 });
      if (res.success) {
        setIsAdmin(true);
        setAdminTickets(res.data?.tickets || []);
      } else {
        // Non-admin users get Forbidden from the gateway; keep user mode only.
        setIsAdmin(false);
      }
    } catch {
      setIsAdmin(false);
    } finally {
      setLoadingAdminTickets(false);
    }
  }, []);

  const loadSupportHealth = useCallback(async () => {
    setLoadingSupportHealth(true);
    try {
      const res = await backendAPI.support.health();
      if (res.success && res.data) {
        setSupportHealth(res.data);
      } else {
        setSupportHealth(null);
      }
    } catch {
      setSupportHealth(null);
    } finally {
      setLoadingSupportHealth(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
    void loadAdminTickets();
  }, [loadTickets, loadAdminTickets]);

  useEffect(() => {
    if (isAdmin) void loadSupportHealth();
  }, [isAdmin, loadSupportHealth]);


  const loadTicketThread = useCallback(async (ticketId: string) => {
    setLoadingTicketThread(true);
    try {
      const res = await backendAPI.support.getTicket(ticketId);
      if (!res.success) {
        toast.error(res.error || 'Could not load ticket');
        return;
      }
      setSelectedTicketId(ticketId);
      setSelectedTicketMessages(res.data?.messages || []);
    } catch {
      toast.error('Could not load ticket');
    } finally {
      setLoadingTicketThread(false);
    }
  }, []);

  const loadAdminTicketThread = useCallback(async (ticketId: string) => {
    setLoadingAdminThread(true);
    try {
      const res = await backendAPI.support.getTicket(ticketId);
      if (!res.success) {
        toast.error(res.error || 'Could not load ticket');
        return;
      }
      setSelectedAdminTicketId(ticketId);
      setSelectedAdminTicketMessages(res.data?.messages || []);
    } catch {
      toast.error('Could not load ticket');
    } finally {
      setLoadingAdminThread(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTicketId || tickets.length === 0) return;
    void loadTicketThread(tickets[0].id);
  }, [tickets, selectedTicketId, loadTicketThread]);

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

  const sendAdminReply = useCallback(async () => {
    if (!selectedAdminTicketId) return;
    if (!adminReplyMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }
    setSendingAdminReply(true);
    try {
      const res = await backendAPI.support.adminReply(selectedAdminTicketId, adminReplyMessage.trim());
      if (!res.success) {
        toast.error(res.error || 'Could not send admin reply');
        return;
      }
      setAdminReplyMessage('');
      await loadAdminTicketThread(selectedAdminTicketId);
      await loadAdminTickets();
      toast.success('Reply sent');
    } catch {
      toast.error('Could not send admin reply');
    } finally {
      setSendingAdminReply(false);
    }
  }, [adminReplyMessage, loadAdminTicketThread, loadAdminTickets, selectedAdminTicketId]);

  const updateAdminStatus = useCallback(async (status: SupportTicket['status']) => {
    if (!selectedAdminTicketId) return;
    setAdminStatusUpdating(true);
    try {
      const res = await backendAPI.support.adminUpdateStatus(selectedAdminTicketId, status);
      if (!res.success) {
        toast.error(res.error || 'Could not update status');
        return;
      }
      await loadAdminTickets();
      toast.success('Ticket updated');
    } catch {
      toast.error('Could not update status');
    } finally {
      setAdminStatusUpdating(false);
    }
  }, [loadAdminTickets, selectedAdminTicketId]);

  const generateAIDraft = useCallback(async () => {
    if (!selectedAdminTicketId) return;
    setDraftingAI(true);
    try {
      const res = await backendAPI.support.adminAIDraft(selectedAdminTicketId);
      if (res.success && res.data?.draft) {
        setAdminReplyMessage(res.data.draft);
        toast.success(`AI draft ready (${res.data.provider})`);
        return;
      }
      if ((res as any).code === 'human_handoff_required') {
        toast.error('This ticket requires human handling. AI draft blocked.');
        return;
      }
      toast.error(res.error || 'Could not generate AI draft');
    } catch {
      toast.error('Could not generate AI draft');
    } finally {
      setDraftingAI(false);
    }
  }, [selectedAdminTicketId]);

  const runAdminCustomerControl = useCallback(async (
    action: 'inspect_customer_assets' | 'revoke_virtual_accounts' | 'revoke_stablecoin_wallets' | 'revoke_external_accounts' | 'revoke_cards',
  ) => {
    const targetEmail = adminTargetEmail.trim().toLowerCase();
    if (!targetEmail) {
      toast.error('Enter a customer email first');
      return;
    }
    const isDestructive = action !== 'inspect_customer_assets';
    if (isDestructive && !adminControlDryRun) {
      const ok = window.confirm(`Confirm live revoke action: ${action} for ${targetEmail}`);
      if (!ok) return;
    }
    setAdminControlBusy(true);
    try {
      const res = await backendAPI.admin.customerControls({ action, target_email: targetEmail, dry_run: adminControlDryRun });
      if (!res.success) {
        const code = (res as any)?.code ? ` [${(res as any).code}]` : '';
        const msg = `${res.error || 'Admin action failed'}${code}`;
        toast.error(msg);
        setAdminControlResult(msg);
        return;
      }
      const summary = (res as any)?.code
        ? `${(res as any).code}${typeof (res as any)?.data?.processed === 'number' ? ` • processed ${(res as any).data.processed}` : ''}${(res as any)?.request_id ? ` • req ${(res as any).request_id}` : ''}`
        : 'Completed';
      setAdminControlResult(summary);
      toast.success('Admin action completed');
    } catch {
      toast.error('Admin action failed');
      setAdminControlResult('');
    } finally {
      setAdminControlBusy(false);
    }
  }, [adminTargetEmail]);

  const submitTicket = async () => {
    const body = message.trim();
    if (!body) {
      toast.error('Please type your message');
      return;
    }
    const issueLabel = ISSUE_TYPES.find((x) => x.key === issueType)?.label || 'General';
    const autoSubject = `${issueLabel}: ${body.slice(0, 56)}`;
    setCreating(true);
    try {
      const res = await backendAPI.support.createTicket({
        issue_type: issueType,
        subject: subject.trim() || autoSubject,
        message: body,
        source: 'app',
      });
      if (!res.success) {
        toast.error(res.error || 'Could not create support ticket');
        return;
      }
      toast.success('Chat started');
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
          <h1 className={`text-lg font-bold ${tc.text}`}>Support chat</h1>
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
            <p className={`text-sm font-semibold ${tc.text}`}>Live chat with support</p>
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

          <div className="hidden">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="hidden"
              aria-hidden="true"
            />
          </div>

          <div>
            <label className={`block text-xs ${tc.textSecondary} mb-1`}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Type your message…"
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
              Start chat
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
            <p className={`text-sm font-semibold ${tc.text}`}>Recent chats</p>
            {loadingTickets ? <Loader2 size={14} className="animate-spin text-[#C7FF00]" /> : null}
          </div>
          {tickets.length === 0 ? (
            <p className={`text-sm ${tc.textSecondary}`}>No chats yet. Start one below.</p>
          ) : (
            <div className="space-y-2">
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
                  <p className={`text-xs ${tc.textSecondary} mt-1`}>
                    {new Date(t.last_message_at).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedTicketId ? (
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-sm font-semibold ${tc.text}`}>Live conversation</p>
              {loadingTicketThread ? <Loader2 size={14} className="animate-spin text-[#C7FF00]" /> : null}
            </div>

            {selectedTicketMessages.length === 0 ? (
              <p className={`text-sm ${tc.textSecondary}`}>No messages yet.</p>
            ) : (
              <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
                {selectedTicketMessages.map((m) => {
                  const mine = m.sender_type === 'user';
                  return (
                    <div
                      key={m.id}
                      className={`rounded-xl px-3 py-2 text-sm ${
                        mine
                          ? 'bg-[#C7FF00]/12 border border-[#C7FF00]/25'
                          : `${tc.bgAlt} border ${tc.cardBorder}`
                      }`}
                    >
                      <p className={tc.text}>{m.body}</p>
                      <p className={`text-[11px] mt-1 ${tc.textSecondary}`}>
                        {m.sender_type === 'agent' ? 'Support' : (m.sender_type === 'assistant' ? 'Assistant' : 'You')} • {new Date(m.created_at).toLocaleString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2">
              <textarea
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                rows={3}
                placeholder="Type your reply…"
                className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bgAlt} ${tc.text} px-3 py-2 text-sm outline-none resize-none`}
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

        {isAdmin ? (
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-sm font-semibold ${tc.text}`}>Customer Support Queue</p>
              {loadingAdminTickets ? <Loader2 size={14} className="animate-spin text-[#C7FF00]" /> : null}
            </div>
            <div className={`mb-3 rounded-xl border ${tc.cardBorder} ${tc.bgAlt} px-3 py-2`}>
              <div className="flex items-center justify-between gap-3">
                <p className={`text-xs font-medium ${tc.text}`}>AI drafting status</p>
                {loadingSupportHealth ? (
                  <Loader2 size={13} className="animate-spin text-[#C7FF00]" />
                ) : (
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      supportHealth?.ready ? 'bg-[#C7FF00]/20 text-[#C7FF00]' : 'bg-orange-500/20 text-orange-300'
                    }`}
                  >
                    {supportHealth?.ready ? 'Ready' : 'Unavailable'}
                  </span>
                )}
              </div>
              <p className={`text-[11px] mt-1 ${tc.textSecondary}`}>
                {supportHealth
                  ? `${supportHealth.provider === 'none' ? 'No provider configured' : `${supportHealth.provider} • ${supportHealth.model || 'model unset'}`}`
                  : 'Health check unavailable'}
              </p>
            </div>

            <div className={`mb-3 rounded-xl border ${tc.cardBorder} ${tc.bgAlt} p-3`}>
              <p className={`text-xs font-medium ${tc.text} mb-2`}>Customer controls</p>
              <input
                value={adminTargetEmail}
                onChange={(e) => setAdminTargetEmail(e.target.value)}
                placeholder="customer@email.com"
                className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bg} ${tc.text} px-3 py-2 text-sm outline-none`}
              />
              <div className="grid grid-cols-1 gap-2 mt-2">
                <label className={`inline-flex items-center gap-2 text-xs ${tc.textSecondary}`}>
                  <input
                    type="checkbox"
                    checked={adminControlDryRun}
                    onChange={(e) => setAdminControlDryRun(e.target.checked)}
                    className="rounded border-white/20 bg-transparent"
                  />
                  Dry run (no provider/local revoke)
                </label>
                <button
                  onClick={() => void runAdminCustomerControl('inspect_customer_assets')}
                  disabled={adminControlBusy}
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-xl border ${tc.cardBorder} ${tc.text} text-sm px-3 py-2 disabled:opacity-60`}
                >
                  {adminControlBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Inspect assets
                </button>
                <button
                  onClick={() => void runAdminCustomerControl('revoke_virtual_accounts')}
                  disabled={adminControlBusy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-3 py-2 disabled:opacity-60"
                >
                  Revoke virtual accounts
                </button>
                <button
                  onClick={() => void runAdminCustomerControl('revoke_stablecoin_wallets')}
                  disabled={adminControlBusy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-3 py-2 disabled:opacity-60"
                >
                  Revoke stablecoin wallets
                </button>
                <button
                  onClick={() => void runAdminCustomerControl('revoke_external_accounts')}
                  disabled={adminControlBusy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-3 py-2 disabled:opacity-60"
                >
                  Revoke external accounts
                </button>
                <button
                  onClick={() => void runAdminCustomerControl('revoke_cards')}
                  disabled={adminControlBusy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 text-white font-semibold text-sm px-3 py-2 disabled:opacity-60"
                >
                  Revoke cards
                </button>
              </div>
              {adminControlResult ? (
                <p className={`text-[11px] mt-2 ${tc.textSecondary}`}>{adminControlResult}</p>
              ) : null}
            </div>

            {adminTickets.length === 0 ? (
              <p className={`text-sm ${tc.textSecondary}`}>No open tickets in queue.</p>
            ) : (
              <div className="space-y-2">
                {adminTickets.map((t) => (
                  <button
                    key={`admin-${t.id}`}
                    onClick={() => void loadAdminTicketThread(t.id)}
                    className={`w-full text-left rounded-xl border ${tc.cardBorder} ${tc.bgAlt} px-3 py-2.5`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm font-medium ${tc.text} truncate`}>{t.subject}</p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#C7FF00]/15 text-[#C7FF00]">
                        {statusLabel[t.status]}
                      </span>
                    </div>
                    <p className={`text-xs ${tc.textSecondary} mt-1`}>
                      {(t.requester_email || 'unknown')} • {new Date(t.last_message_at).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {selectedAdminTicketId ? (
              <div className={`mt-4 rounded-xl border ${tc.cardBorder} ${tc.bgAlt} p-3`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className={`text-xs ${tc.textSecondary}`}>Queue ticket thread</p>
                  <select
                    disabled={adminStatusUpdating}
                    onChange={(e) => void updateAdminStatus(e.target.value as SupportTicket['status'])}
                    defaultValue=""
                    className={`rounded-lg border ${tc.cardBorder} ${tc.bg} ${tc.text} text-xs px-2 py-1`}
                  >
                    <option value="" disabled>Set status</option>
                    <option value="pending_support">Pending support</option>
                    <option value="pending_user">Pending user</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                {loadingAdminThread ? (
                  <div className="py-3 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-[#C7FF00]" />
                    <p className={`text-xs ${tc.textSecondary}`}>Loading thread…</p>
                  </div>
                ) : (
                  <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
                    {selectedAdminTicketMessages.map((m) => (
                      <div
                        key={`admin-msg-${m.id}`}
                        className={`rounded-xl px-3 py-2 text-sm ${tc.bg} border ${tc.cardBorder}`}
                      >
                        <p className={tc.text}>{m.body}</p>
                        <p className={`text-[11px] mt-1 ${tc.textSecondary}`}>
                          {m.sender_type === 'agent' ? 'Agent' : (m.sender_type === 'assistant' ? 'Assistant' : m.sender_type === 'user' ? 'User' : 'System')} • {new Date(m.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <textarea
                    value={adminReplyMessage}
                    onChange={(e) => setAdminReplyMessage(e.target.value)}
                    rows={3}
                    placeholder="Reply as support agent..."
                    className={`w-full rounded-xl border ${tc.cardBorder} ${tc.bg} ${tc.text} px-3 py-2 text-sm outline-none resize-none`}
                  />
                  <button
                    onClick={() => void generateAIDraft()}
                    disabled={draftingAI || !supportHealth?.ready}
                    className={`w-full inline-flex items-center justify-center gap-2 rounded-xl border ${tc.cardBorder} ${tc.text} text-sm px-4 py-2.5 disabled:opacity-60`}
                  >
                    {draftingAI ? <Loader2 size={15} className="animate-spin" /> : null}
                    Draft with AI
                  </button>
                  <button
                    onClick={() => void sendAdminReply()}
                    disabled={sendingAdminReply}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm px-4 py-2.5 disabled:opacity-60"
                  >
                    {sendingAdminReply ? <Loader2 size={15} className="animate-spin" /> : null}
                    Send agent reply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
