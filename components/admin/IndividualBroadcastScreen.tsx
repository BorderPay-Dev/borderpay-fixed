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
  const [startIndex, setStartIndex] = useState(0);
  const [previewedStartIndex, setPreviewedStartIndex] = useState<number | null>(null);
  const [running, setRunning] = useState<null | 'dry' | 'send'>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  const run = async (dryRun: boolean) => {
    setRunning(dryRun ? 'dry' : 'send');
    try {
      const res: any = await backendAPI.admin.broadcastIndividualPolicyNotice({
        dry_run: dryRun,
        start_index: startIndex,
        ...(!dryRun ? { confirmation: 'SEND_INDIVIDUAL_POLICY_NOTICE' as const } : {}),
      });
      if (!res?.success) {
        toast.error(res?.error || 'Broadcast request failed');
        return;
      }
      setLastResult(res.data || null);
      if (dryRun) {
        setPreviewedStartIndex(startIndex);
        toast.success(`Dry run complete. This batch: ${res.data?.selected_recipients ?? 0}`);
      } else {
        setPreviewedStartIndex(null);
        if ((res.data?.failed_count ?? 0) === 0 && res.data?.has_more) {
          setStartIndex(res.data.next_start_index);
        }
        toast.success(`Broadcast sent. Sent: ${res.data?.sent_count ?? 0}, Failed: ${res.data?.failed_count ?? 0}`);
      }
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
          <p className={`text-xs ${tc.textMuted}`}>
            Business-only signup notice for existing Individual customers. Existing accounts remain available.
          </p>
          <p className={`mt-2 text-xs ${tc.textMuted}`}>
            Fixed batch size: 30. Effective date: August 24, 2026. A dry run is required before each batch.
          </p>
          <div className="mt-4">
            <label className={`text-xs ${tc.textMuted}`}>Batch start index</label>
            <input
              type="number"
              min={0}
              value={startIndex}
              onChange={(e) => {
                setStartIndex(Math.max(0, Math.floor(Number(e.target.value || 0))));
                setPreviewedStartIndex(null);
              }}
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
              disabled={!!running || previewedStartIndex !== startIndex}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#C7FF00] text-black font-semibold"
            >
              {running === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send This Batch
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
