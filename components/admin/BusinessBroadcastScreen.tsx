import React, { useState } from 'react';
import { Send, TestTube2, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface BusinessBroadcastScreenProps {
  onBack: () => void;
}

export function BusinessBroadcastScreen({ onBack }: BusinessBroadcastScreenProps) {
  const tc = useThemeClasses();
  const [maxRecipients, setMaxRecipients] = useState(2000);
  const [running, setRunning] = useState<null | 'dry' | 'send'>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [eurStartIndex, setEurStartIndex] = useState(0);
  const [eurConfirmation, setEurConfirmation] = useState('');

  const run = async (dryRun: boolean) => {
    setRunning(dryRun ? 'dry' : 'send');
    try {
      const res: any = await backendAPI.admin.broadcast('business_verification_delay', {
        dry_run: dryRun,
        max_recipients: maxRecipients,
      });
      if (!res?.success) {
        toast.error(res?.error || 'Broadcast request failed');
        return;
      }
      setLastResult(res.data || null);
      if (dryRun) toast.success(`Dry run complete. Eligible: ${res.data?.eligible_recipients ?? 0}`);
      else toast.success(`Broadcast sent. Sent: ${res.data?.sent_count ?? 0}, Failed: ${res.data?.failed_count ?? 0}`);
    } catch (e: any) {
      toast.error(e?.message || 'Broadcast request failed');
    } finally {
      setRunning(null);
    }
  };

  const runEurNotice = async (dryRun: boolean) => {
    if (!dryRun && eurConfirmation !== 'SEND_EUR_NAMED_ACCOUNT_NOTICE') {
      toast.error('Type the exact confirmation before sending.');
      return;
    }
    setRunning(dryRun ? 'dry' : 'send');
    try {
      const res: any = await backendAPI.admin.broadcastEurNamedAccountNotice({
        dry_run: dryRun,
        start_index: eurStartIndex,
        ...(dryRun ? {} : { confirmation: 'SEND_EUR_NAMED_ACCOUNT_NOTICE' as const }),
      });
      if (!res?.success && !res?.data) {
        toast.error(res?.error || 'EUR notice request failed');
        return;
      }
      setLastResult(res.data || null);
      if (Number.isInteger(res.data?.next_start_index)) setEurStartIndex(res.data.next_start_index);
      if (dryRun) toast.success(`Dry run complete. Eligible EUR customers: ${res.data?.eligible_recipients ?? 0}`);
      else toast.success(`EUR notice batch sent: ${res.data?.sent_count ?? 0}; failed: ${res.data?.failed_count ?? 0}`);
    } catch (e: any) {
      toast.error(e?.message || 'EUR notice request failed');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <header className="max-w-2xl mx-auto px-5 pt-floating-back pb-2">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Admin Broadcast</p>
        <h1 className={`text-lg font-semibold ${tc.text} mt-1`}>Business Users</h1>
      </header>

      <main className="max-w-2xl mx-auto px-5 pb-10 space-y-4">
        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
          <p className={`text-sm ${tc.text} font-medium mb-1`}>EUR named account-holder update</p>
          <p className={`text-xs ${tc.textMuted}`}>
            September 2 notice. Targets only non-admin customers with an active EUR virtual account. Sends at most 30 recipients per batch.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={`text-xs ${tc.textMuted}`}>
              Start index
              <input
                type="number"
                min={0}
                value={eurStartIndex}
                onChange={(e) => setEurStartIndex(Math.max(0, Number(e.target.value || 0)))}
                className={`mt-1 w-full ${tc.inputBg} border ${tc.cardBorder} rounded-xl px-3 py-2 text-sm ${tc.text}`}
              />
            </label>
            <label className={`text-xs ${tc.textMuted}`}>
              Send confirmation
              <input
                value={eurConfirmation}
                onChange={(e) => setEurConfirmation(e.target.value)}
                placeholder="SEND_EUR_NAMED_ACCOUNT_NOTICE"
                className={`mt-1 w-full ${tc.inputBg} border ${tc.cardBorder} rounded-xl px-3 py-2 text-sm ${tc.text}`}
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => runEurNotice(true)}
              disabled={!!running}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.text} ${tc.hoverBg}`}
            >
              {running === 'dry' ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
              Preview batch
            </button>
            <button
              onClick={() => runEurNotice(false)}
              disabled={!!running || eurConfirmation !== 'SEND_EUR_NAMED_ACCOUNT_NOTICE'}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#C7FF00] text-black font-semibold disabled:opacity-50"
            >
              {running === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send 30 max
            </button>
          </div>
        </div>

        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
          <p className={`text-sm ${tc.text} font-medium mb-1`}>Campaign</p>
          <p className={`text-xs ${tc.textMuted}`}>Business verification update (10 business day approval notice).</p>
          <div className="mt-4">
            <label className={`text-xs ${tc.textMuted}`}>Max recipients</label>
            <input
              type="number"
              min={1}
              max={10000}
              value={maxRecipients}
              onChange={(e) => setMaxRecipients(Math.max(1, Math.min(10000, Number(e.target.value || 1))))}
              className={`mt-1 w-full ${tc.inputBg} border ${tc.cardBorder} rounded-xl px-3 py-2 text-sm ${tc.text}`}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => run(true)}
              disabled={!!running}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.text} ${tc.hoverBg}`}
            >
              {running === 'dry' ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
              Dry Run
            </button>
            <button
              onClick={() => run(false)}
              disabled={!!running}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#C7FF00] text-black font-semibold"
            >
              {running === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send Broadcast
            </button>
          </div>
        </div>

        {lastResult && (
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <p className={`text-sm font-medium ${tc.text} mb-2 inline-flex items-center gap-2`}>
              <Users className="w-4 h-4" /> Last Result
            </p>
            <pre className={`text-[11px] ${tc.textMuted} whitespace-pre-wrap break-all`}>{JSON.stringify(lastResult, null, 2)}</pre>
          </div>
        )}
      </main>
    </div>
  );
}

export default BusinessBroadcastScreen;
