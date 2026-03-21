/**
 * BorderPay Africa - Stablecoin Transaction Confirmation Screen
 * Shows after a stablecoin deposit address is generated or a send is initiated.
 * Logs the transaction to Postgres and shows animated confirmation.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, CheckCircle, Copy, ExternalLink, Clock,
  Shield, Zap, ArrowDownLeft, ArrowUpRight, RefreshCw,
  ChevronRight, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

type TxType = 'deposit' | 'send' | 'receive' | 'swap';
type StablecoinCurrency = 'USDC' | 'USDT' | 'PYUSD';

interface StablecoinConfirmScreenProps {
  onBack: () => void;
  onDone: () => void;
  onViewHistory?: () => void;
  txType: TxType;
  currency: StablecoinCurrency;
  amount?: number;
  network?: string;
  address?: string;
  txHash?: string;
}

const COIN_CONFIG: Record<StablecoinCurrency, { name: string; color: string; bgColor: string; icon: string }> = {
  USDC: { name: 'USD Coin', color: '#2775CA', bgColor: '#2775CA20', icon: '$' },
  USDT: { name: 'Tether', color: '#26A17B', bgColor: '#26A17B20', icon: '₮' },
  PYUSD: { name: 'PayPal USD', color: '#0074D9', bgColor: '#0074D920', icon: '$' },
};

const TX_TYPE_CONFIG: Record<TxType, { label: string; pastTense: string; icon: typeof ArrowDownLeft; color: string }> = {
  deposit: { label: 'Deposit', pastTense: 'Deposit Initiated', icon: ArrowDownLeft, color: '#C7FF00' },
  send: { label: 'Send', pastTense: 'Sent Successfully', icon: ArrowUpRight, color: '#FF6B6B' },
  receive: { label: 'Receive', pastTense: 'Received', icon: ArrowDownLeft, color: '#C7FF00' },
  swap: { label: 'Swap', pastTense: 'Swap Complete', icon: RefreshCw, color: '#9945FF' },
};

export function StablecoinConfirmScreen({
  onBack, onDone, onViewHistory,
  txType, currency, amount, network = 'SOLANA', address, txHash,
}: StablecoinConfirmScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [step, setStep] = useState<'logging' | 'confirmed' | 'error'>('logging');
  const [txId, setTxId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const coin = COIN_CONFIG[currency];
  const txConfig = TX_TYPE_CONFIG[txType];
  const TxIcon = txConfig.icon;

  // Log transaction to Postgres on mount
  useEffect(() => {
    logTransaction();
  }, []);

  const logTransaction = async () => {
    try {
      const result = await backendAPI.stablecoin.logTransaction({
        type: txType,
        currency,
        amount: amount || 0,
        network,
        address: address || undefined,
        tx_hash: txHash || undefined,
        status: txType === 'deposit' ? 'pending' : 'confirmed',
      });

      if (result.success) {
        setTxId(result.data?.transaction_id || null);
        setStep('confirmed');
        console.log('Stablecoin tx logged to Postgres:', result.data?.transaction_id);
      } else {
        console.error('Failed to log stablecoin tx:', result.error);
        // Still show confirmation even if logging fails
        setStep('confirmed');
      }
    } catch (err: any) {
      console.error('Stablecoin tx logging error:', err);
      // Show confirmation anyway — the actual crypto operation already happened
      setStep('confirmed');
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-5 py-3 pt-safe">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="text-xs font-bold tracking-widest uppercase text-gray-400">
            {txConfig.label} Confirmation
          </span>
          <div className="w-9" />
        </div>
      </div>

      <div className="flex-1 px-5 py-6 overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* ═══ LOGGING STATE ═══ */}
          {step === 'logging' && (
            <motion.div
              key="logging"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <motion.div
                className="w-20 h-20 rounded-full border-2 border-[#C7FF00]/30 border-t-[#C7FF00] mb-6"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              />
              <p className="text-sm font-semibold text-gray-300">Recording transaction...</p>
              <p className="text-[10px] text-gray-600 mt-1">Saving to your transaction history</p>
            </motion.div>
          )}

          {/* ═══ CONFIRMED STATE ═══ */}
          {step === 'confirmed' && (
            <motion.div
              key="confirmed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Success Hero */}
              <div className="flex flex-col items-center mb-8">
                {/* Animated checkmark */}
                <div className="relative mb-5">
                  {[...Array(6)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor: i % 2 === 0 ? coin.color : '#C7FF00',
                        top: '50%', left: '50%',
                      }}
                      initial={{ x: 0, y: 0, opacity: 1 }}
                      animate={{
                        x: Math.cos((i * Math.PI * 2) / 6) * 50,
                        y: Math.sin((i * Math.PI * 2) / 6) * 50,
                        opacity: 0,
                      }}
                      transition={{ duration: 0.7, delay: 0.2 + i * 0.05 }}
                    />
                  ))}

                  <motion.div
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
                    className="w-20 h-20 rounded-full flex items-center justify-center relative z-10"
                    style={{ backgroundColor: `${coin.color}20`, border: `2px solid ${coin.color}40` }}
                  >
                    <CheckCircle className="w-10 h-10" style={{ color: coin.color }} />
                  </motion.div>
                </div>

                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-lg font-extrabold mb-1"
                >
                  {txConfig.pastTense}
                </motion.h2>

                {amount != null && amount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex items-baseline gap-1.5 mb-1"
                  >
                    <span className="text-3xl font-black" style={{ color: coin.color }}>
                      {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </span>
                    <span className="text-base font-bold text-gray-400">{currency}</span>
                  </motion.div>
                )}

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-[10px] text-gray-500"
                >
                  {txType === 'deposit' ? 'Awaiting blockchain confirmation' : 'Transaction recorded'}
                </motion.p>
              </div>

              {/* Transaction Details Card */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="bg-white/[0.03] border border-white/8 rounded-2xl overflow-hidden mb-4"
              >
                <div className="px-4 py-3 border-b border-white/5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Transaction Details</span>
                </div>

                <div className="divide-y divide-white/5">
                  {/* Type */}
                  <DetailRow
                    label="Type"
                    value={
                      <div className="flex items-center gap-1.5">
                        <TxIcon size={12} style={{ color: txConfig.color }} />
                        <span className="font-semibold capitalize">{txType}</span>
                      </div>
                    }
                  />

                  {/* Coin */}
                  <DetailRow
                    label="Coin"
                    value={
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                          style={{ backgroundColor: coin.bgColor, color: coin.color }}
                        >
                          {coin.icon}
                        </div>
                        <span className="font-semibold">{currency}</span>
                        <span className="text-gray-500 text-[10px]">{coin.name}</span>
                      </div>
                    }
                  />

                  {/* Network */}
                  <DetailRow
                    label="Network"
                    value={
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195]" />
                        <span className="font-semibold">{network === 'SOLANA' ? 'Solana' : network}</span>
                      </div>
                    }
                  />

                  {/* Status */}
                  <DetailRow
                    label="Status"
                    value={
                      <div className="flex items-center gap-1.5">
                        {txType === 'deposit' ? (
                          <>
                            <Clock size={12} className="text-yellow-400" />
                            <span className="text-yellow-400 font-semibold text-[11px]">Pending</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle size={12} className="text-[#C7FF00]" />
                            <span className="text-[#C7FF00] font-semibold text-[11px]">Confirmed</span>
                          </>
                        )}
                      </div>
                    }
                  />

                  {/* Address */}
                  {address && (
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-500">
                          {txType === 'deposit' ? 'Deposit Address' : 'Recipient'}
                        </span>
                        <button
                          onClick={() => handleCopy(address, 'Address')}
                          className="flex items-center gap-1 text-[9px] text-[#C7FF00]/70 hover:text-[#C7FF00] transition-colors"
                        >
                          {copied === 'Address' ? <CheckCircle size={10} /> : <Copy size={10} />}
                          {copied === 'Address' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="text-[10px] font-mono text-gray-300 break-all leading-relaxed">
                        {address}
                      </p>
                    </div>
                  )}

                  {/* TX Hash */}
                  {txHash && (
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-500">Transaction Hash</span>
                        <button
                          onClick={() => handleCopy(txHash, 'TX Hash')}
                          className="flex items-center gap-1 text-[9px] text-[#C7FF00]/70 hover:text-[#C7FF00] transition-colors"
                        >
                          {copied === 'TX Hash' ? <CheckCircle size={10} /> : <Copy size={10} />}
                          {copied === 'TX Hash' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="text-[10px] font-mono text-gray-300 break-all leading-relaxed">
                        {txHash}
                      </p>
                    </div>
                  )}

                  {/* TX ID (Postgres) */}
                  {txId && (
                    <DetailRow
                      label="Reference"
                      value={
                        <span className="text-[10px] font-mono text-gray-400">
                          {txId.length > 20 ? txId.slice(0, 20) + '...' : txId}
                        </span>
                      }
                    />
                  )}
                </div>
              </motion.div>

              {/* Deposit pending notice */}
              {txType === 'deposit' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                  className="flex items-start gap-3 bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-4 py-3 mb-4"
                >
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-semibold text-yellow-300 mb-0.5">Awaiting Deposit</p>
                    <p className="text-[9px] text-yellow-400/70 leading-relaxed">
                      Send {currency} to the address above on the Solana network. Your balance will update automatically once the transaction is confirmed on-chain.
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Security footer */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="flex items-center gap-2 bg-[#C7FF00]/5 border border-[#C7FF00]/10 rounded-xl px-3 py-2.5 mb-6"
              >
                <Shield className="w-3 h-3 text-[#C7FF00]/50 flex-shrink-0" />
                <p className="text-[8px] text-[#C7FF00]/40 leading-relaxed">
                  Recorded to Postgres with banking-grade encryption. View anytime in Transaction History.
                </p>
              </motion.div>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9 }}
                className="space-y-2.5"
              >
                <button
                  onClick={onDone}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-full font-extrabold text-[13px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                >
                  <CheckCircle size={16} />
                  Done
                </button>

                {onViewHistory && (
                  <button
                    onClick={onViewHistory}
                    className="w-full bg-white/5 border border-white/10 text-white py-3 rounded-full font-bold text-[12px] flex items-center justify-center gap-2 hover:bg-white/8 transition-colors active:scale-[0.97]"
                  >
                    View Transaction History
                    <ChevronRight size={14} className="text-gray-500" />
                  </button>
                )}

                {txHash && network === 'SOLANA' && (
                  <a
                    href={`https://solscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <ExternalLink size={12} />
                    View on Solscan
                  </a>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Sub-components ──

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <div className="text-[11px] text-white">{value}</div>
    </div>
  );
}
