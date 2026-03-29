/**
 * BorderPay Africa - Wallet Screen
 * 3 sections:
 *   1. USD Virtual Account — ACH, FEDWIRE, ACH-ACCELERATED, routing number, FDIC-insured
 *   2. Local African Currencies (7) — NGN KES GHS UGX TZS XAF XOF, account number only
 *   3. Stablecoins (3) — USDT USDC PYUSD, generate Solana address
 *
 * Transfer info:
 *   - Local currencies use mobile money counterparty: full name, email, phone, reason
 *   - Only NGN supports bank account number AND mobile money
 *   - All 7 Africa currencies support mobile money
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, ChevronRight, Send, ArrowDownToLine, RefreshCw,
  Copy, Shield, Building2, Smartphone, Wallet, Coins,
  ExternalLink, Globe, Lock, CheckCircle, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import { isFullEnrollment } from '../../utils/config/environment';
import { friendlyError } from '../../utils/errors/friendlyError';

// ---------------------------------------------------------------------------
// Types & Config
// ---------------------------------------------------------------------------

interface WalletData {
  id: string;
  currency: string;
  balance: number;
  symbol: string;
  status: string;
  type: 'usd' | 'local' | 'stablecoin';
  account_number?: string;
  address?: string;
  momo_provider?: string;
  momo_phone?: string;
}

interface WalletScreenProps {
  userId: string;
  onBack: () => void;
  isVerified: boolean;
  onNavigate?: (screen: string) => void;
}

const USD_ACCOUNT = {
  accountNumber: '9800004567123',
  routingNumber: '091311229',
  bankName: 'Lead Bank',
  accountType: 'Checking',
  rails: [
    { id: 'ACH', label: 'ACH', desc: 'Standard 1-3 business days', color: 'text-blue-400', bg: 'bg-blue-500/15' },
    { id: 'ACH-ACCELERATED', label: 'ACH Accelerated', desc: 'Same / next day', color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
    { id: 'FEDWIRE', label: 'Fedwire', desc: 'Instant same-day', color: 'text-orange-400', bg: 'bg-orange-500/15' },
  ],
};

const CURRENCY_CONFIG: Record<string, { symbol: string; flag: string; name: string; color: string }> = {
  USD: { symbol: '$', flag: '🇺🇸', name: 'US Dollar', color: '#10B981' },
  NGN: { symbol: '₦', flag: '🇳🇬', name: 'Nigerian Naira', color: '#F59E0B' },
  KES: { symbol: 'KSh', flag: '🇰🇪', name: 'Kenyan Shilling', color: '#EC4899' },
  GHS: { symbol: '₵', flag: '🇬🇭', name: 'Ghanaian Cedi', color: '#06B6D4' },
  UGX: { symbol: 'USh', flag: '🇺🇬', name: 'Ugandan Shilling', color: '#EF4444' },
  TZS: { symbol: 'TSh', flag: '🇹🇿', name: 'Tanzanian Shilling', color: '#3B82F6' },
  XAF: { symbol: 'FCFA', flag: '🇨🇲', name: 'CFA Franc (Central)', color: '#A855F7' },
  XOF: { symbol: 'FCFA', flag: '🇧🇯', name: 'CFA Franc (West)', color: '#8B5CF6' },
  SLE: { symbol: 'Le', flag: '🇸🇱', name: 'Sierra Leonean Leone', color: '#22D3EE' },
  MZN: { symbol: 'MT', flag: '🇲🇿', name: 'Mozambican Metical', color: '#F97316' },
  MWK: { symbol: 'MK', flag: '🇲🇼', name: 'Malawian Kwacha', color: '#14B8A6' },
  USDT: { symbol: '$', flag: '₮', name: 'Tether USD', color: '#26A17B' },
  USDC: { symbol: '$', flag: '◈', name: 'USD Coin', color: '#2775CA' },
  PYUSD: { symbol: '$', flag: '◇', name: 'PayPal USD', color: '#0074D9' },
};


// Mobile Money providers by region (static metadata, not mock data)
const MOMO_PROVIDERS: Record<string, string> = {
  NGN: 'MTN MoMo',
  KES: 'M-Pesa',
  GHS: 'MTN MoMo',
  UGX: 'MTN MoMo',
  TZS: 'M-Pesa',
  XAF: 'Orange Money',
  XOF: 'Orange Money',
  SLE: 'Orange Money',
  MZN: 'M-Pesa',
  MWK: 'Airtel Money',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WalletScreen({ userId, onBack, onNavigate }: WalletScreenProps) {
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

  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null);
  const [generatingAddress, setGeneratingAddress] = useState<string | null>(null);

  useEffect(() => {
    loadWallets();
  }, []);

  const loadWallets = async () => {
    try {
      const result = await backendAPI.wallets.getWallets();
      if (result.success && result.data) {
        const raw = result.data.wallets || result.data || [];
        if (Array.isArray(raw) && raw.length > 0) {
          const mapped: WalletData[] = raw.map((w: any) => {
            const cur = w.currency;
            const isStable = ['USDT', 'USDC', 'PYUSD'].includes(cur);
            const isUsd = cur === 'USD';
            return {
              id: w.id,
              currency: cur,
              balance: parseFloat(w.balance) || 0,
              symbol: CURRENCY_CONFIG[cur]?.symbol || cur,
              status: w.status || 'active',
              type: isUsd ? 'usd' : isStable ? 'stablecoin' : 'local',
              account_number: w.account_number || w.nuban || undefined,
              address: w.address || w.deposit_address || undefined,
              momo_provider: w.momo_provider || MOMO_PROVIDERS[cur] || undefined,
              momo_phone: w.momo_phone || undefined,
            };
          });
          setWallets(mapped);
        } else {
          setWallets([]);
        }
      } else {
        setWallets([]);
      }
    } catch {
      setWallets([]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const handleGenerateAddress = async (currency: string) => {
    setGeneratingAddress(currency);
    try {
      const result = await backendAPI.address.generateAddress(userId, currency, 'solana');
      if (result.success && result.data?.address) {
        toast.success(`${currency} Solana address generated`);
        await loadWallets(); // Reload to get the new address
      } else {
        toast.error(friendlyError(result.error, 'Failed to generate address'));
      }
    } catch {
      toast.error('Failed to generate address');
    } finally {
      setGeneratingAddress(null);
    }
  };

  const usdWallet = wallets.find(w => w.type === 'usd');
  const localWallets = wallets.filter(w => w.type === 'local');
  const stablecoinWallets = wallets.filter(w => w.type === 'stablecoin');

  const totalBalance = wallets.reduce((sum, w) => {
    if (w.currency === 'USD' || ['USDT', 'USDC', 'PYUSD'].includes(w.currency)) return sum + w.balance;
    return sum; // skip non-USD for total
  }, 0);

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
          <h1 className="text-base font-bold">My Wallets</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-5 py-5 space-y-6">
        {/* ================================================================= */}
        {/* SECTION 1: USD VIRTUAL ACCOUNT                                     */}
        {/* ================================================================= */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <Building2 size={12} className="text-green-400" />
            </div>
            <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider`}>USD Virtual Account</h2>
            <div className="flex items-center gap-1 ml-auto px-2 py-0.5 bg-green-500/10 rounded-full">
              <Shield size={10} className="text-green-400" />
              <span className="text-[9px] font-bold text-green-400">FDIC INSURED</span>
            </div>
          </div>

          {usdWallet && (
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
              {/* USD Balance Row */}
              <button
                onClick={() => setExpandedWallet(expandedWallet === 'usd' ? null : 'usd')}
                className={`w-full px-4 py-4 flex items-center gap-3 ${tc.hoverBg} transition-colors`}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: '#10B98120' }}>
                  🇺🇸
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold">USD</p>
                  <p className={`text-xs ${tc.textMuted}`}>US Dollar • Virtual Account</p>
                </div>
                <div className="text-right mr-2">
                  <p className="text-base font-bold">${usdWallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <p className={`text-[10px] ${tc.textMuted}`}>Active</p>
                </div>
                <ChevronRight size={16} className={`${tc.textMuted} transition-transform ${expandedWallet === 'usd' ? 'rotate-90' : ''}`} />
              </button>

              {/* Expanded: Account Details */}
              <AnimatePresence>
                {expandedWallet === 'usd' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className={`border-t ${tc.borderLight}`}
                  >
                    <div className="px-4 py-4 space-y-3">
                      {/* Account Details */}
                      <div className={`${tc.card} rounded-xl p-3 space-y-2.5`}>
                        <div className="flex justify-between items-center">
                          <span className={`text-[10px] ${tc.textMuted} uppercase`}>Account Number</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-semibold">{USD_ACCOUNT.accountNumber}</span>
                            <button onClick={() => copyToClipboard(USD_ACCOUNT.accountNumber, 'Account number')}>
                              <Copy size={12} className={tc.textMuted} />
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`text-[10px] ${tc.textMuted} uppercase`}>Routing Number</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-semibold">{USD_ACCOUNT.routingNumber}</span>
                            <button onClick={() => copyToClipboard(USD_ACCOUNT.routingNumber, 'Routing number')}>
                              <Copy size={12} className={tc.textMuted} />
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`text-[10px] ${tc.textMuted} uppercase`}>Bank</span>
                          <span className="text-xs font-semibold">{USD_ACCOUNT.bankName}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`text-[10px] ${tc.textMuted} uppercase`}>Type</span>
                          <span className="text-xs font-semibold">{USD_ACCOUNT.accountType}</span>
                        </div>
                      </div>

                      {/* Payment Rails */}
                      <p className={`text-[10px] ${tc.textMuted} uppercase font-semibold`}>Supported Payment Rails</p>
                      <div className="space-y-1.5">
                        {USD_ACCOUNT.rails.map(rail => (
                          <div key={rail.id} className={`flex items-center gap-3 px-3 py-2.5 ${rail.bg} rounded-xl`}>
                            <div className={`w-2 h-2 rounded-full ${rail.color.replace('text-', 'bg-')}`} />
                            <div className="flex-1">
                              <p className={`text-xs font-bold ${rail.color}`}>{rail.label}</p>
                              <p className={`text-[10px] ${tc.textMuted}`}>{rail.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Quick Actions */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <button onClick={() => onNavigate?.('send-money')} className="flex flex-col items-center gap-1.5 py-2.5 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                          <Send size={16} className="text-[#C7FF00]" />
                          <span className="text-[10px] font-semibold text-[#C7FF00]">Send</span>
                        </button>
                        <button onClick={() => onNavigate?.('receive-money')} className="flex flex-col items-center gap-1.5 py-2.5 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                          <ArrowDownToLine size={16} className="text-[#C7FF00]" />
                          <span className="text-[10px] font-semibold text-[#C7FF00]">Receive</span>
                        </button>
                        <button onClick={() => onNavigate?.('exchange')} className="flex flex-col items-center gap-1.5 py-2.5 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                          <RefreshCw size={16} className="text-[#C7FF00]" />
                          <span className="text-[10px] font-semibold text-[#C7FF00]">Exchange</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* SECTION 2: LOCAL AFRICAN CURRENCIES                                */}
        {/* ================================================================= */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Globe size={12} className="text-purple-400" />
            </div>
            <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider`}>Local Currencies</h2>
            <span className={`text-[10px] ${tc.textMuted} ml-auto`}>{localWallets.length} wallets</span>
          </div>

          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
            {localWallets.map((wallet, idx) => {
              const config = CURRENCY_CONFIG[wallet.currency];
              const isExpanded = expandedWallet === wallet.id;
              const isNGN = wallet.currency === 'NGN';
              const acctNum = wallet.account_number;
              const momoProvider = wallet.momo_provider;

              return (
                <div key={wallet.id}>
                  {idx > 0 && <div className={`h-px ${tc.borderLight}`} />}
                  <button
                    onClick={() => setExpandedWallet(isExpanded ? null : wallet.id)}
                    className={`w-full px-4 py-3.5 flex items-center gap-3 ${tc.hoverBg} transition-colors`}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: `${config?.color}20` }}>
                      {config?.flag}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-bold">{wallet.currency}</p>
                        {isNGN && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded-full font-bold">BANK + MOMO</span>
                        )}
                      </div>
                      <p className={`text-xs ${tc.textMuted}`}>{config?.name}</p>
                    </div>
                    <div className="text-right mr-2">
                      <p className="text-sm font-bold">{config?.symbol}{wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    <ChevronRight size={14} className={`${tc.textMuted} transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className={`border-t ${tc.borderLight}`}
                      >
                        <div className="px-4 py-3 space-y-3">
                          {/* Account Number */}
                          {acctNum ? (
                            <div className={`${tc.card} rounded-xl p-3`}>
                              <div className="flex justify-between items-center">
                                <span className={`text-[10px] ${tc.textMuted} uppercase`}>Account Number</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-mono font-semibold">{acctNum}</span>
                                  <button onClick={() => copyToClipboard(acctNum, 'Account number')}>
                                    <Copy size={12} className={tc.textMuted} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className={`${tc.card} rounded-xl p-3`}>
                              <p className={`text-[10px] ${tc.textMuted} text-center`}>Account details loading from provider...</p>
                            </div>
                          )}

                          {/* Transfer Method Info */}
                          <div className="space-y-1.5">
                            {/* Mobile Money (all currencies) */}
                            <div className="flex items-center gap-3 px-3 py-2.5 bg-purple-500/10 rounded-xl">
                              <Smartphone size={14} className="text-purple-400" />
                              <div className="flex-1">
                                <p className="text-xs font-bold text-purple-400">Mobile Money</p>
                                <p className={`text-[10px] ${tc.textMuted}`}>{momoProvider}{wallet.momo_phone ? ` • ${wallet.momo_phone}` : ''}</p>
                              </div>
                            </div>

                            {/* Bank Transfer (NGN only) */}
                            {isNGN && (
                              <div className="flex items-center gap-3 px-3 py-2.5 bg-yellow-500/10 rounded-xl">
                                <Building2 size={14} className="text-yellow-400" />
                                <div className="flex-1">
                                  <p className="text-xs font-bold text-yellow-400">Bank Transfer (NUBAN)</p>
                                  <p className={`text-[10px] ${tc.textMuted}`}>3-digit bank code + account number</p>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Counterparty Info */}
                          <div className={`px-3 py-2.5 ${tc.card} rounded-xl`}>
                            <p className={`text-[10px] ${tc.textMuted} uppercase font-semibold mb-1.5`}>Transfer Requires</p>
                            <div className="flex flex-wrap gap-1.5">
                              {['Full Name', 'Email', 'Phone', 'Reason'].map(field => (
                                <span key={field} className={`text-[10px] px-2 py-1 rounded-lg ${tc.card} border ${tc.borderLight} ${tc.textMuted}`}>{field}</span>
                              ))}
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div className="grid grid-cols-3 gap-2">
                            <button onClick={() => onNavigate?.('send-money')} className="flex flex-col items-center gap-1 py-2 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                              <Send size={14} className="text-[#C7FF00]" />
                              <span className="text-[9px] font-semibold text-[#C7FF00]">Send</span>
                            </button>
                            <button onClick={() => onNavigate?.('receive-money')} className="flex flex-col items-center gap-1 py-2 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                              <ArrowDownToLine size={14} className="text-[#C7FF00]" />
                              <span className="text-[9px] font-semibold text-[#C7FF00]">Receive</span>
                            </button>
                            <button onClick={() => onNavigate?.('exchange')} className="flex flex-col items-center gap-1 py-2 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                              <RefreshCw size={14} className="text-[#C7FF00]" />
                              <span className="text-[9px] font-semibold text-[#C7FF00]">Exchange</span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* ================================================================= */}
        {/* SECTION 3: STABLECOINS                                             */}
        {/* ================================================================= */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#9945FF]/30 to-[#14F195]/30 flex items-center justify-center">
              <Coins size={12} className="text-[#14F195]" />
            </div>
            <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider`}>Stablecoins</h2>
            <div className="flex items-center gap-1 ml-auto px-2 py-0.5 bg-[#9945FF]/10 rounded-full">
              <span className="text-[9px] font-bold text-[#9945FF]">SOLANA</span>
            </div>
          </div>

          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
            {stablecoinWallets.map((wallet, idx) => {
              const config = CURRENCY_CONFIG[wallet.currency];
              const isExpanded = expandedWallet === wallet.id;
              const address = wallet.address;

              return (
                <div key={wallet.id}>
                  {idx > 0 && <div className={`h-px ${tc.borderLight}`} />}
                  <button
                    onClick={() => setExpandedWallet(isExpanded ? null : wallet.id)}
                    className={`w-full px-4 py-3.5 flex items-center gap-3 ${tc.hoverBg} transition-colors`}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold" style={{ backgroundColor: `${config?.color}20`, color: config?.color }}>
                      {config?.flag}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-bold">{wallet.currency}</p>
                      <p className={`text-xs ${tc.textMuted}`}>{config?.name} • Solana</p>
                    </div>
                    <div className="text-right mr-2">
                      <p className="text-sm font-bold">${wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    <ChevronRight size={14} className={`${tc.textMuted} transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className={`border-t ${tc.borderLight}`}
                      >
                        <div className="px-4 py-3 space-y-3">
                          {/* Solana Address */}
                          {address ? (
                            <div className={`${tc.card} rounded-xl p-3`}>
                              <div className="flex justify-between items-center mb-1">
                                <span className={`text-[10px] ${tc.textMuted} uppercase`}>Solana Address</span>
                                <button onClick={() => copyToClipboard(address, 'Address')}>
                                  <Copy size={12} className={tc.textMuted} />
                                </button>
                              </div>
                              <p className="text-xs font-mono break-all">{address}</p>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleGenerateAddress(wallet.currency)}
                              disabled={generatingAddress === wallet.currency}
                              className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-[#9945FF]/15 to-[#14F195]/15 border border-[#9945FF]/30 rounded-xl"
                            >
                              {generatingAddress === wallet.currency ? (
                                <Loader2 size={16} className="text-[#14F195] animate-spin" />
                              ) : (
                                <ExternalLink size={16} className="text-[#14F195]" />
                              )}
                              <span className="text-xs font-semibold text-[#14F195]">
                                {generatingAddress === wallet.currency ? 'Generating...' : 'Generate Solana Address'}
                              </span>
                            </button>
                          )}

                          {/* Chain info */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-[#9945FF]/10 rounded-xl">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center">
                              <span className="text-[8px] font-bold text-white">S</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-[#14F195]">Solana Network</p>
                              <p className={`text-[10px] ${tc.textMuted}`}>SPL Token • Fast & low fees</p>
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div className="grid grid-cols-3 gap-2">
                            <button onClick={() => onNavigate?.('send-money')} className="flex flex-col items-center gap-1 py-2 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                              <Send size={14} className="text-[#C7FF00]" />
                              <span className="text-[9px] font-semibold text-[#C7FF00]">Send</span>
                            </button>
                            <button onClick={() => onNavigate?.('stablecoin-deposit')} className="flex flex-col items-center gap-1 py-2 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                              <ArrowDownToLine size={14} className="text-[#C7FF00]" />
                              <span className="text-[9px] font-semibold text-[#C7FF00]">Receive</span>
                            </button>
                            <button onClick={() => onNavigate?.('exchange')} className="flex flex-col items-center gap-1 py-2 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-xl">
                              <RefreshCw size={14} className="text-[#C7FF00]" />
                              <span className="text-[9px] font-semibold text-[#C7FF00]">Exchange</span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-2 pb-4">
          <p className={`text-[10px] ${tc.textMuted}`}>All wallets powered by Maplerad • FDIC insured (USD)</p>
        </div>
      </div>
    </div>
  );
}
