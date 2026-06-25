import React, { useState } from 'react';
import { Send, TestTube2, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface IndividualBroadcastScreenProps {
  onBack: () => void;
}

export function IndividualBroadcastScreen({ onBack }: IndividualBroadcastScreenProps) {
  const tc = useThemeClasses();
  const [maxRecipients, setMaxRecipients] = useState(2000);
  const [running, setRunning] = useState<null | 'dry' | 'send'>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  const run = async (dryRun: boolean) => {
    setRunning(dryRun ? 'dry' : 'send');
    try {
      const res: any = await backendAPI.admin.broadcast('individual_platform_live', {
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

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <header className="max-w-2xl mx-auto px-5 pt-floating-back pb-2">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Admin Broadcast</p>
        <h1 className={`text-lg font-semibold ${tc.text} mt-1`}>Individual Users</h1>
      </header>

      <main className="max-w-2xl mx-auto px-5 pb-10 space-y-4">
        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
          <p className={`text-sm ${tc.text} font-medium mb-1`}>Campaign</p>
          <p className={`text-xs ${tc.textMuted}`}>Individual platform update message.</p>
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

export default IndividualBroadcastScreen;
