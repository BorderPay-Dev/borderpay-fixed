/**
 * BorderPay Africa - Currency Exchange Screen
 * 3-tab layout: Swap | FX History | Live Rates
 *
 * Swap: wallet selectors, native number input, animated SVG rate chart with period selector
 * FX History: 30-day volume bar chart + expandable history list
 * Live Rates: currency pairs with mini sparkline charts
 * PIN verification for executing swaps
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, RefreshCw, ArrowDownUp, TrendingUp, TrendingDown,
  Lock, Check, X, AlertCircle, Info, ChevronDown, ChevronRight,
  Wallet as WalletIcon, Clock, BarChart3, Activity, Shield,
} from 'lucide-react';
import { isFullEnrollment } from '../../utils/config/environment';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { toast } from 'sonner';
import { PINManager, BiometricManager } from '../../utils/security/SecurityManager';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';
import { friendlyError } from '../../utils/errors/friendlyError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Wallet {
  id: string;
  currency: string;
  balance: number;
  symbol: string;
}

type Tab = 'swap' | 'history' | 'rates';
type SwapStep = 'form' | 'review' | 'pin' | 'processing' | 'success' | 'error';
type ChartPeriod = '7D' | '1M' | '3M';

interface ExchangeScreenProps {
  onBack: () => void;
  preSelectedWalletId?: string;
}

// ---------------------------------------------------------------------------
// Chart visualization data generators (placeholder until live rate history API)
// ---------------------------------------------------------------------------

function generateRateHistory(days: number, base = 1550, volatility = 80): number[] {
  const points: number[] = [];
  let val = base;
  for (let i = 0; i < days; i++) {
    val += (Math.random() - 0.48) * volatility;
    val = Math.max(base * 0.85, Math.min(base * 1.15, val));
    points.push(Math.round(val * 100) / 100);
  }
  return points;
}

function generateVolumeData(days: number): number[] {
  return Array.from({ length: days }, () => Math.round(500 + Math.random() * 4500));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', NGN: '₦', KES: 'KSh', GHS: '₵', UGX: 'USh',
  XAF: 'FCFA', XOF: 'FCFA', TZS: 'TSh', EUR: '€', GBP: '£',
  USDT: '$', USDC: '$', PYUSD: '$',
};

function sym(c: string) { return CURRENCY_SYMBOLS[c] || c; }

// ---------------------------------------------------------------------------
// SVG chart components
// ---------------------------------------------------------------------------

function RateChart({ data, period, isPositive }: { data: number[]; period: ChartPeriod; isPositive: boolean }) {
  const W = 340, H = 140, PAD = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const fillPath = `${linePath} L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`;
  const color = isPositive ? '#22c55e' : '#ef4444';
  const gradId = `grad-${period}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <animate attributeName="stroke-dasharray" from="0,2000" to="2000,0" dur="1.2s" fill="freeze" />
      </path>
      {/* Last point dot */}
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="4" fill={color}>
        <animate attributeName="opacity" from="0" to="1" dur="1.2s" fill="freeze" />
      </circle>
    </svg>
  );
}

function MiniSparkline({ positive }: { positive: boolean }) {
  const pts = Array.from({ length: 20 }, () => Math.random());
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const color = positive ? '#22c55e' : '#ef4444';
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * 60;
    const y = 20 - ((v - min) / range) * 16;
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 60 22" width="60" height="22">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function VolumeBarChart({ data }: { data: number[] }) {
  const W = 340, H = 100, PAD = 4;
  const max = Math.max(...data);
  const barW = (W - PAD * 2) / data.length - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 100 }}>
      {data.map((v, i) => {
        const barH = (v / max) * (H - PAD * 2);
        const x = PAD + i * (barW + 1);
        const y = H - PAD - barH;
        return (
          <rect key={i} x={x} y={y} width={barW} height={barH} rx="1.5"
            fill={i >= data.length - 3 ? '#C7FF00' : '#C7FF0040'}
          >
            <animate attributeName="height" from="0" to={barH} dur="0.6s" fill="freeze" />
            <animate attributeName="y" from={H - PAD} to={y} dur="0.6s" fill="freeze" />
          </rect>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExchangeScreen({ onBack, preSelectedWalletId }: ExchangeScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // KYC gate
  const [kycStatus, setKycStatus] = useState<string>('pending');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) {
        const user = JSON.parse(stored);
        setKycStatus(user.kyc_status || 'pending');
      }
    } catch {}
  }, []);

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>('swap');

  // Wallets
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  // Swap state
  const [swapStep, setSwapStep] = useState<SwapStep>('form');
  const [sourceWallet, setSourceWallet] = useState<Wallet | null>(null);
  const [destinationWallet, setDestinationWallet] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [fee, setFee] = useState(0);
  const [convertedAmount, setConvertedAmount] = useState(0);
  const [loadingRate, setLoadingRate] = useState(false);
  const [quoteReference, setQuoteReference] = useState<string | null>(null);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);

  // PIN
  const [pin, setPin] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const userId = authAPI.getStoredUser()?.id || '';

  // Chart
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('7D');

  // History
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [exchangeHistory, setExchangeHistory] = useState<any[]>([]);
  const [liveRates, setLiveRates] = useState<any[]>([]);

  // Volume data
  const volumeData = useMemo(() => generateVolumeData(30), []);

  // Rate chart data per period
  const rateData = useMemo(() => ({
    '7D': generateRateHistory(7, 1550, 30),
    '1M': generateRateHistory(30, 1550, 60),
    '3M': generateRateHistory(90, 1550, 100),
  }), [sourceWallet?.currency, destinationWallet?.currency]);

  const currentRateData = rateData[chartPeriod];
  const rateChange = currentRateData.length > 1
    ? ((currentRateData[currentRateData.length - 1] - currentRateData[0]) / currentRateData[0]) * 100
    : 0;
  const isPositive = rateChange >= 0;
  const low = Math.min(...currentRateData);
  const high = Math.max(...currentRateData);
  const avg = currentRateData.reduce((s, v) => s + v, 0) / currentRateData.length;

  // Load wallets
  useEffect(() => {
    (async () => {
      try {
        const result = await backendAPI.wallets.getWallets();
        if (result.success) {
          const raw = result.data?.wallets || result.data || [];
          const list: Wallet[] = (Array.isArray(raw) ? raw : []).map((w: any) => ({
            id: w.id,
            currency: w.currency,
            balance: parseFloat(w.balance) || 0,
            symbol: sym(w.currency),
          }));
          setWallets(list);
          if (preSelectedWalletId) {
            const pre = list.find(w => w.id === preSelectedWalletId);
            if (pre) setSourceWallet(pre);
          }
        }
      } catch (e) {
        setWallets([]);
      } finally {
        setLoading(false);
      }
    })();

    // Load exchange history
    (async () => {
      try {
        const result = await backendAPI.fx.getHistory();
        if (result.success && Array.isArray(result.data)) {
          setExchangeHistory(result.data);
        }
      } catch { /* no history available */ }
    })();

    // Load live rates
    (async () => {
      try {
        const result = await backendAPI.fx.getLiveRates();
        if (result.success && Array.isArray(result.data)) {
          setLiveRates(result.data);
        }
      } catch { /* no live rates available */ }
    })();
  }, []);

  // Fetch rate when source/dest/amount changes
  useEffect(() => {
    if (!sourceWallet || !destinationWallet || !amount || parseFloat(amount) <= 0) return;
    if (sourceWallet.currency === destinationWallet.currency) return;
    const timer = setTimeout(() => fetchRate(), 600);
    return () => clearTimeout(timer);
  }, [sourceWallet, destinationWallet, amount]);

  const fetchRate = async () => {
    if (!sourceWallet || !destinationWallet) return;
    setLoadingRate(true);
    try {
      const result = await backendAPI.fx.getQuote(sourceWallet.currency, destinationWallet.currency, parseFloat(amount));
      if (result.success) {
        setExchangeRate(result.data.rate);
        setConvertedAmount(result.data.converted_amount);
        setFee(result.data.fee || 0);
        setQuoteReference(result.data.quote_reference || null);
      } else throw new Error(result.error);
    } catch (err) {
      toast.error(friendlyError(err, 'Failed to fetch exchange rate. Please try again.'));
      setExchangeRate(null);
      setConvertedAmount(0);
      setFee(0);
      setQuoteReference(null);
    } finally {
      setLoadingRate(false);
    }
  };

  const handleSwap = () => {
    const tmp = sourceWallet;
    setSourceWallet(destinationWallet);
    setDestinationWallet(tmp);
    setAmount('');
    setExchangeRate(null);
    setConvertedAmount(0);
  };

  const canReview = () => {
    const n = parseFloat(amount);
    return sourceWallet && destinationWallet && n > 0 && sourceWallet.id !== destinationWallet.id
      && n <= sourceWallet.balance && exchangeRate !== null && !loadingRate;
  };

  const handlePinComplete = async (value: string) => {
    setPin(value);
    if (value.length !== 6) return;

    // Verify PIN locally
    if (PINManager.hasPIN(userId)) {
      const ok = await PINManager.verifyPIN(userId, value);
      if (!ok) { toast.error('Incorrect PIN'); setPin(''); return; }
    }

    setSwapStep('processing');
    try {
      const result = await backendAPI.fx.convert({
        quote_reference: quoteReference || '',
        source_wallet_id: sourceWallet!.id,
        destination_wallet_id: destinationWallet!.id,
        amount: parseFloat(amount),
        transaction_pin: value,
      });
      if (result.success) {
        setTransactionId(result.data?.transaction_id || 'TX-' + Date.now());
        setSwapStep('success');
        toast.success('Exchange successful!');
      } else throw new Error(result.error);
    } catch (e: any) {
      setErrorMessage(e.message || 'Exchange failed. Please try again.');
      setSwapStep('error');
      toast.error(friendlyError(e, 'Exchange failed'));
    }
  };

  const resetSwap = () => {
    setSwapStep('form');
    setAmount('');
    setExchangeRate(null);
    setConvertedAmount(0);
    setFee(0);
    setPin('');
    setTransactionId('');
    setErrorMessage('');
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  // PIN / Processing / Success / Error overlays
  if (swapStep === 'pin') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        <div className={`sticky top-0 z-20 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
          <div className="flex items-center justify-between px-5 py-4 pt-safe">
            <button onClick={() => setSwapStep('review')} className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center`}>
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-base font-bold">Verify Exchange</h1>
            <div className="w-10" />
          </div>
        </div>
        <div className="px-5 py-8 text-center">
          <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-10 h-10 text-[#C7FF00]" />
          </div>
          <h2 className="text-lg font-bold mb-2">Enter PIN to Confirm</h2>
          <p className={`text-sm ${tc.textSecondary} mb-1`}>
            {sym(sourceWallet?.currency || '')}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} → {sym(destinationWallet?.currency || '')}{convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className={`text-xs ${tc.textMuted} mb-8`}>
            Rate: 1 {sourceWallet?.currency} = {exchangeRate?.toFixed(4)} {destinationWallet?.currency}
          </p>
          <div className="flex justify-center mb-8">
            <InputOTP maxLength={6} value={pin} onChange={handlePinComplete} inputMode="numeric" pattern="[0-9]*">
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          {BiometricManager.isEnrolled(userId) && (
            <button
              onClick={async () => {
                const r = await BiometricManager.verify(userId);
                if (r.success) handlePinComplete('__biometric__');
                else toast.error('Biometric failed');
              }}
              className={`w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl ${tc.card} border ${tc.borderLight} ${tc.hoverBg} transition-all`}
            >
              <Lock size={20} className="text-[#C7FF00]" />
              <span className="text-sm font-semibold">Use Biometric</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (swapStep === 'processing') {
    return (
      <div className={`min-h-screen ${tc.bg} flex items-center justify-center`}>
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#C7FF00] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className={`text-base font-semibold ${tc.text}`}>Processing Exchange...</p>
          <p className={`text-sm ${tc.textMuted}`}>Please wait</p>
        </div>
      </div>
    );
  }

  if (swapStep === 'success') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex flex-col items-center justify-center px-6`}>
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.4 }}
          className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6"
        >
          <Check className="w-12 h-12 text-green-500" />
        </motion.div>
        <h2 className="text-xl font-bold mb-2">Exchange Successful!</h2>
        <p className="text-2xl font-bold text-[#C7FF00] mb-1">
          {sym(destinationWallet?.currency || '')}{convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </p>
        <p className={`text-sm ${tc.textMuted} mb-6`}>
          {sym(sourceWallet?.currency || '')}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} exchanged
        </p>
        <div className={`w-full max-w-sm ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-8 space-y-2`}>
          <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>Rate</span><span className="text-sm font-mono">1 {sourceWallet?.currency} = {exchangeRate?.toFixed(4)} {destinationWallet?.currency}</span></div>
          {transactionId && <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>ID</span><span className="text-xs font-mono">{transactionId}</span></div>}
        </div>
        <div className="w-full max-w-sm space-y-3">
          <button onClick={resetSwap} className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-full hover:bg-[#B8F000] transition-all">New Exchange</button>
          <button onClick={onBack} className={`w-full ${tc.card} border ${tc.borderLight} ${tc.text} font-bold py-4 rounded-full ${tc.hoverBg} transition-all`}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (swapStep === 'error') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex flex-col items-center justify-center px-6`}>
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
          <X className="w-12 h-12 text-red-500" />
        </div>
        <h2 className="text-xl font-bold mb-2">Exchange Failed</h2>
        <p className={`text-sm ${tc.textMuted} mb-8`}>{errorMessage}</p>
        <div className="w-full max-w-sm space-y-3">
          <button onClick={() => { setPin(''); setSwapStep('pin'); }} className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-full">Try Again</button>
          <button onClick={onBack} className={`w-full ${tc.card} ${tc.text} font-bold py-4 rounded-full`}>Cancel</button>
        </div>
      </div>
    );
  }

  // Review overlay
  if (swapStep === 'review') {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        <div className={`sticky top-0 z-20 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
          <div className="flex items-center justify-between px-5 py-4 pt-safe">
            <button onClick={() => setSwapStep('form')} className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center`}>
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-base font-bold">Review Exchange</h1>
            <div className="w-10" />
          </div>
        </div>
        <div className="px-5 py-6 space-y-5">
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
            <div className="text-center mb-4">
              <p className={`text-xs ${tc.textMuted} mb-1`}>You Send</p>
              <p className="text-3xl font-bold">{sourceWallet?.symbol}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <p className={`text-xs ${tc.textMuted}`}>{sourceWallet?.currency}</p>
            </div>
            <div className="flex justify-center my-3">
              <div className="w-10 h-10 bg-[#C7FF00] rounded-full flex items-center justify-center"><ArrowDownUp size={18} className="text-black" /></div>
            </div>
            <div className="text-center mb-4">
              <p className={`text-xs ${tc.textMuted} mb-1`}>You Receive</p>
              <p className="text-3xl font-bold text-[#C7FF00]">{destinationWallet?.symbol}{convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <p className={`text-xs ${tc.textMuted}`}>{destinationWallet?.currency}</p>
            </div>
            <div className={`h-px ${tc.border} my-4`} />
            <div className="space-y-2.5">
              <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>Rate</span><span className="text-sm font-semibold">1 {sourceWallet?.currency} = {exchangeRate?.toFixed(4)} {destinationWallet?.currency}</span></div>
              {fee > 0 && <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>Fee</span><span className="text-sm">{sourceWallet?.symbol}{fee.toFixed(2)}</span></div>}
            </div>
          </div>
          <div className="flex items-start gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
            <AlertCircle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-400">Exchange rates are locked for 30 seconds. Review carefully before confirming.</p>
          </div>
          <button onClick={() => setSwapStep('pin')} className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]">
            Confirm & Enter PIN
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // MAIN TAB VIEW
  // =========================================================================
  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe relative`}>
      {!isFullEnrollment(kycStatus) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0B0E11]/95 backdrop-blur-sm px-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-yellow-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Verification Required</h2>
            <p className="text-sm text-gray-400 mb-6">Complete identity verification to access this feature.</p>
            <button
              onClick={onBack}
              className="w-full h-12 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-sm"
            >
              Go Back
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className={`sticky top-0 z-20 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-5 py-4 pt-safe">
          <button onClick={onBack} className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}>
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className="text-base font-bold">Exchange</h1>
          <div className="w-10" />
        </div>

        {/* Tabs */}
        <div className="flex px-5 gap-1 pb-3">
          {([
            { id: 'swap' as Tab, label: 'Swap', icon: RefreshCw },
            { id: 'history' as Tab, label: 'FX History', icon: Clock },
            { id: 'rates' as Tab, label: 'Live Rates', icon: Activity },
          ]).map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  active ? 'bg-[#C7FF00] text-black' : `${tc.card} ${tc.textMuted} ${tc.hoverBg}`
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ================================================================= */}
        {/* SWAP TAB                                                          */}
        {/* ================================================================= */}
        {activeTab === 'swap' && (
          <motion.div key="swap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-5 py-5 space-y-5">
            {/* Source Wallet */}
            <div>
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>From</label>
              <div className="relative">
                <button
                  onClick={() => { setShowSourceDropdown(!showSourceDropdown); setShowDestDropdown(false); }}
                  className={`w-full ${tc.card} border ${sourceWallet ? 'border-[#C7FF00]/50' : tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
                >
                  {sourceWallet ? (
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-[#C7FF00]/10 rounded-full flex items-center justify-center">
                        <WalletIcon size={18} className="text-[#C7FF00]" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold">{sourceWallet.currency}</p>
                        <p className={`text-xs ${tc.textMuted}`}>Bal: {sourceWallet.symbol}{sourceWallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                  ) : <span className={`text-sm ${tc.textMuted}`}>Select source wallet</span>}
                  <ChevronDown size={18} className={tc.textMuted} />
                </button>
                {showSourceDropdown && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className={`absolute top-full mt-2 w-full ${tc.card} border ${tc.cardBorder} rounded-2xl shadow-xl overflow-hidden z-30 max-h-56 overflow-y-auto`}
                  >
                    {wallets.map(w => (
                      <button key={w.id} onClick={() => { setSourceWallet(w); setShowSourceDropdown(false); }}
                        className={`w-full px-4 py-3 flex items-center gap-3 ${tc.hoverBg} transition-colors text-left ${sourceWallet?.id === w.id ? 'bg-[#C7FF00]/10' : ''}`}
                      >
                        <span className="text-sm font-semibold">{w.currency}</span>
                        <span className={`text-xs ${tc.textMuted} ml-auto`}>{w.symbol}{w.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Swap Button */}
            {sourceWallet && destinationWallet && (
              <div className="flex justify-center -my-2 relative z-10">
                <button onClick={handleSwap}
                  className="w-11 h-11 bg-[#C7FF00] rounded-full flex items-center justify-center hover:bg-[#B8F000] transition-colors shadow-lg active:scale-95"
                >
                  <ArrowDownUp size={18} className="text-black" />
                </button>
              </div>
            )}

            {/* Destination Wallet */}
            <div>
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>To</label>
              <div className="relative">
                <button
                  onClick={() => { setShowDestDropdown(!showDestDropdown); setShowSourceDropdown(false); }}
                  className={`w-full ${tc.card} border ${destinationWallet ? 'border-blue-500/50' : tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
                >
                  {destinationWallet ? (
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-500/10 rounded-full flex items-center justify-center">
                        <WalletIcon size={18} className="text-blue-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold">{destinationWallet.currency}</p>
                        <p className={`text-xs ${tc.textMuted}`}>Bal: {destinationWallet.symbol}{destinationWallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                  ) : <span className={`text-sm ${tc.textMuted}`}>Select destination wallet</span>}
                  <ChevronDown size={18} className={tc.textMuted} />
                </button>
                {showDestDropdown && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className={`absolute top-full mt-2 w-full ${tc.card} border ${tc.cardBorder} rounded-2xl shadow-xl overflow-hidden z-30 max-h-56 overflow-y-auto`}
                  >
                    {wallets.filter(w => w.id !== sourceWallet?.id).map(w => (
                      <button key={w.id} onClick={() => { setDestinationWallet(w); setShowDestDropdown(false); }}
                        className={`w-full px-4 py-3 flex items-center gap-3 ${tc.hoverBg} transition-colors text-left ${destinationWallet?.id === w.id ? 'bg-[#C7FF00]/10' : ''}`}
                      >
                        <span className="text-sm font-semibold">{w.currency}</span>
                        <span className={`text-xs ${tc.textMuted} ml-auto`}>{w.symbol}{w.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Amount Input — native number */}
            <div>
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Amount</label>
              <div className="relative">
                <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold ${tc.textMuted}`}>
                  {sourceWallet?.symbol || '$'}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-14 pr-4 py-5 text-2xl font-bold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text} placeholder:${tc.textMuted}`}
                />
              </div>
              {sourceWallet && (
                <div className="flex items-center justify-between mt-2 px-1">
                  <p className={`text-xs ${tc.textMuted}`}>Available: {sourceWallet.symbol}{sourceWallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <button onClick={() => setAmount(sourceWallet.balance.toString())} className="text-xs text-[#C7FF00] font-semibold">MAX</button>
                </div>
              )}
              {/* Quick % buttons */}
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[25, 50, 75, 100].map(p => (
                  <button key={p} onClick={() => sourceWallet && setAmount(((sourceWallet.balance * p) / 100).toFixed(2))}
                    className={`${tc.card} border ${tc.borderLight} rounded-xl py-2 text-xs font-semibold ${tc.hoverBg} transition-colors`}
                  >{p}%</button>
                ))}
              </div>
            </div>

            {/* Conversion preview */}
            {loadingRate && amount && parseFloat(amount) > 0 && (
              <div className={`${tc.card} rounded-2xl p-4 flex items-center justify-center gap-2`}>
                <div className="w-4 h-4 border-2 border-[#C7FF00] border-t-transparent rounded-full animate-spin" />
                <span className={`text-sm ${tc.textMuted}`}>Getting rate...</span>
              </div>
            )}
            {!loadingRate && exchangeRate && convertedAmount > 0 && (
              <div className="bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl p-4 space-y-2">
                <div className="flex justify-between"><span className={`text-sm ${tc.textMuted}`}>Rate</span><span className="text-sm font-bold">1 {sourceWallet?.currency} = {exchangeRate.toFixed(4)} {destinationWallet?.currency}</span></div>
                <div className="flex justify-between"><span className={`text-sm ${tc.textMuted}`}>You receive</span><span className="text-lg font-bold text-[#C7FF00]">{destinationWallet?.symbol}{convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                {fee > 0 && <div className={`flex justify-between pt-2 border-t border-white/10`}><span className={`text-xs ${tc.textMuted}`}>Fee</span><span className="text-xs">{sourceWallet?.symbol}{fee.toFixed(2)}</span></div>}
              </div>
            )}

            {/* Rate Chart */}
            {sourceWallet && destinationWallet && (
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold">{sourceWallet.currency}/{destinationWallet.currency}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isPositive ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                      <span className={`text-xs font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? '+' : ''}{rateChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {(['7D', '1M', '3M'] as ChartPeriod[]).map(p => (
                      <button key={p} onClick={() => setChartPeriod(p)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${chartPeriod === p ? 'bg-[#C7FF00] text-black' : `${tc.card} ${tc.textMuted}`}`}
                      >{p}</button>
                    ))}
                  </div>
                </div>

                <RateChart data={currentRateData} period={chartPeriod} isPositive={isPositive} />

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {[
                    { label: 'Low', value: low.toFixed(2) },
                    { label: 'High', value: high.toFixed(2) },
                    { label: 'Avg', value: avg.toFixed(2) },
                    { label: 'Change', value: `${isPositive ? '+' : ''}${rateChange.toFixed(2)}%` },
                  ].map(s => (
                    <div key={s.label} className={`${tc.card} rounded-xl p-2 text-center`}>
                      <p className={`text-[9px] ${tc.textMuted} uppercase`}>{s.label}</p>
                      <p className={`text-xs font-bold ${s.label === 'Change' ? (isPositive ? 'text-green-400' : 'text-red-400') : tc.text}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Swap Button */}
            <button
              onClick={() => setSwapStep('review')}
              disabled={!canReview()}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Review Exchange
            </button>
          </motion.div>
        )}

        {/* ================================================================= */}
        {/* FX HISTORY TAB                                                    */}
        {/* ================================================================= */}
        {activeTab === 'history' && (
          <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-5 py-5 space-y-5">
            {/* Volume Chart */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold">30-Day Volume</p>
                  <p className={`text-xs ${tc.textMuted}`}>Exchange activity</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-[#C7FF00]">${(volumeData.reduce((s, v) => s + v, 0)).toLocaleString()}</p>
                  <p className={`text-[10px] ${tc.textMuted}`}>Total volume</p>
                </div>
              </div>
              <VolumeBarChart data={volumeData} />
            </div>

            {/* History List */}
            <div>
              <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider mb-3`}>Recent Exchanges</h3>
              <div className="space-y-2">
                {exchangeHistory.map(tx => {
                  const expanded = expandedHistoryId === tx.id;
                  return (
                    <motion.div key={tx.id} layout className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
                      <button
                        onClick={() => setExpandedHistoryId(expanded ? null : tx.id)}
                        className={`w-full px-4 py-3.5 flex items-center gap-3 ${tc.hoverBg} transition-colors`}
                      >
                        <div className="w-9 h-9 rounded-full bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                          <RefreshCw size={16} className="text-[#C7FF00]" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-semibold">{tx.from} → {tx.to}</p>
                          <p className={`text-xs ${tc.textMuted}`}>{tx.date}</p>
                        </div>
                        <div className="text-right mr-2">
                          <p className="text-sm font-bold text-[#C7FF00]">+{sym(tx.to)}{tx.received.toLocaleString()}</p>
                          <p className={`text-xs ${tc.textMuted}`}>-{sym(tx.from)}{tx.amount.toLocaleString()}</p>
                        </div>
                        <ChevronRight size={16} className={`${tc.textMuted} transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      </button>
                      <AnimatePresence>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className={`border-t ${tc.borderLight}`}
                          >
                            <div className="px-4 py-3 space-y-2">
                              <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>Rate</span><span className="text-xs font-mono">1 {tx.from} = {tx.rate} {tx.to}</span></div>
                              <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>Status</span><span className="text-xs font-semibold text-green-400 capitalize">{tx.status}</span></div>
                              <div className="flex justify-between"><span className={`text-xs ${tc.textMuted}`}>ID</span><span className="text-xs font-mono">{tx.id}</span></div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* ================================================================= */}
        {/* LIVE RATES TAB                                                    */}
        {/* ================================================================= */}
        {activeTab === 'rates' && (
          <motion.div key="rates" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-5 py-5 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider`}>Market Rates</h3>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className={`text-[10px] ${tc.textMuted}`}>Live</span>
              </div>
            </div>

            {liveRates.map((pair, i) => {
              const positive = pair.change >= 0;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center gap-3`}
                >
                  <div className="flex-1">
                    <p className="text-sm font-bold">{pair.from}/{pair.to}</p>
                    <p className={`text-lg font-bold ${tc.text} mt-0.5`}>
                      {pair.rate < 10 ? pair.rate.toFixed(4) : pair.rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  {/* Mini sparkline */}
                  <div className="flex-shrink-0">
                    <MiniSparkline positive={positive} />
                  </div>

                  {/* Change badge */}
                  <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg ${positive ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                    {positive ? <TrendingUp size={12} className="text-green-400" /> : <TrendingDown size={12} className="text-red-400" />}
                    <span className={`text-xs font-bold ${positive ? 'text-green-400' : 'text-red-400'}`}>
                      {positive ? '+' : ''}{pair.change.toFixed(2)}%
                    </span>
                  </div>
                </motion.div>
              );
            })}

            <div className={`text-center mt-4 py-3`}>
              <p className={`text-[10px] ${tc.textMuted}`}>Rates refresh automatically • Powered by Maplerad FX</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
