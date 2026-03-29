/**
 * BorderPay Africa - Receive Money Screen
 * Mobile-optimized with neon green aesthetic
 * 
 * Features:
 * - Wallet selection
 * - Account details display (account number, bank name, etc.)
 * - QR code generation
 * - Share options (WhatsApp, SMS, Email, Copy)
 * - Payment request creation with amount
 * - Payment link generation
 * - Multi-currency support
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Wallet as WalletIcon,
  Copy,
  Check,
  Share2,
  QrCode,
  Download,
  DollarSign,
  ChevronDown,
  MessageCircle,
  Mail,
  Link as LinkIcon,
  AlertCircle,
  Info,
  Shield,
} from 'lucide-react';
import { isFullEnrollment } from '../../utils/config/environment';
import { supabase, authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface Wallet {
  id: string;
  currency: string;
  balance: number;
  symbol: string;
  account_number?: string;
  bank_name?: string;
  bank_code?: string;
  routing_number?: string;
}

interface ReceiveMoneyScreenProps {
  onBack: () => void;
  preSelectedWalletId?: string;
}

type Tab = 'details' | 'qr' | 'request';

export function ReceiveMoneyScreen({ onBack, preSelectedWalletId }: ReceiveMoneyScreenProps) {
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

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWalletDropdown, setShowWalletDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  
  // QR Code
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Payment Request
  const [requestAmount, setRequestAmount] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [paymentLink, setPaymentLink] = useState('');
  
  // Copy states
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    loadWallets();
  }, []);

  useEffect(() => {
    if (selectedWallet && activeTab === 'qr') {
      generateQRCode();
    }
  }, [selectedWallet, activeTab]);

  const loadWallets = async () => {
    try {
      const user = authAPI.getStoredUser();
      if (!user) return;

      // Use backend API instead of direct Supabase query
      const result = await backendAPI.wallets.getWallets();
      if (!result.success) throw new Error(result.error || 'Failed to load wallets');

      const walletsList = result.data?.wallets || result.data || [];
      const formattedWallets: Wallet[] = walletsList.map((w: any) => ({
        id: w.id,
        currency: w.currency,
        balance: parseFloat(w.balance) || 0,
        symbol: getCurrencySymbol(w.currency),
        account_number: w.account_number,
        bank_name: getBankName(w.currency),
        bank_code: getBankCode(w.currency),
        routing_number: getRoutingNumber(w.currency),
      }));

      if (formattedWallets.length > 0) {
        setWallets(formattedWallets);
        if (preSelectedWalletId) {
          const preSelected = formattedWallets.find((w) => w.id === preSelectedWalletId);
          if (preSelected) setSelectedWallet(preSelected);
          else setSelectedWallet(formattedWallets[0]);
        } else {
          setSelectedWallet(formattedWallets[0]);
        }
      } else {
        setWallets([]);
      }
    } catch (error) {
      setWallets([]);
    } finally {
      setLoading(false);
    }
  };

  const getCurrencySymbol = (currency: string): string => {
    const symbols: Record<string, string> = {
      USD: '$', NGN: '₦', KES: 'KSh', GHS: '₵',
      TZS: 'TSh', UGX: 'USh', USDT: '$', USDC: '$',
      XOF: 'FCFA', XAF: 'FCFA',
      SLE: 'Le', MZN: 'MT', MWK: 'MK',
      PYUSD: '$',
    };
    return symbols[currency] || currency;
  };

  const getBankName = (currency: string): string => {
    const bankNames: Record<string, string> = {
      USD: 'BorderPay US',
      NGN: 'BorderPay Nigeria',
      KES: 'BorderPay Kenya',
      GHS: 'BorderPay Ghana',
      TZS: 'BorderPay Tanzania',
      UGX: 'BorderPay Uganda',
      USDT: 'BorderPay Crypto',
      USDC: 'BorderPay Crypto',
      XOF: 'BorderPay UEMOA',
      XAF: 'BorderPay CEMAC',
      SLE: 'BorderPay Sierra Leone',
      MZN: 'BorderPay Mozambique',
      MWK: 'BorderPay Malawi',
    };
    return bankNames[currency] || 'BorderPay Africa';
  };

  const getBankCode = (currency: string): string => {
    const bankCodes: Record<string, string> = {
      USD: 'BPUS',
      NGN: 'BPNG',
      KES: 'BPKE',
      GHS: 'BPGH',
      TZS: 'BPTZ',
      UGX: 'BPUG',
      USDT: 'BPCT',
      USDC: 'BPCT',
      XOF: 'BPXO',
      XAF: 'BPXA',
      SLE: 'BPSL',
      MZN: 'BPMZ',
      MWK: 'BPMW',
    };
    return bankCodes[currency] || 'BPAF';
  };

  const getRoutingNumber = (currency: string): string | undefined => {
    // Only USD typically has routing numbers
    if (currency === 'USD') {
      return '021000021'; // Example routing number
    }
    return undefined;
  };

  const generateQRCode = async () => {
    if (!selectedWallet) return;

    try {
      const user = authAPI.getStoredUser();
      if (!user) return;

      // Create payment data object
      const paymentData = {
        account_number: selectedWallet.account_number,
        bank_name: selectedWallet.bank_name,
        bank_code: selectedWallet.bank_code,
        currency: selectedWallet.currency,
        beneficiary_name: user.full_name || user.email,
        app: 'BorderPay Africa',
      };

      // Generate QR code
      const qrDataString = JSON.stringify(paymentData);
      const qrUrl = await QRCode.toDataURL(qrDataString, {
        width: 300,
        margin: 2,
        color: {
          dark: '#C7FF00',
          light: '#000000',
        },
      });

      setQrCodeUrl(qrUrl);
    } catch (error) {
      toast.error('Failed to generate QR code');
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`${field} copied!`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleShare = async (method: 'whatsapp' | 'sms' | 'email' | 'link') => {
    if (!selectedWallet) return;

    const user = authAPI.getStoredUser();
    const userName = user?.full_name || user?.email || 'User';

    const message = `
💰 Send money to my BorderPay ${selectedWallet.currency} wallet:

Bank: ${selectedWallet.bank_name}
Account: ${selectedWallet.account_number}
Currency: ${selectedWallet.currency}
Beneficiary: ${userName}

Fast, secure, and instant!
    `.trim();

    try {
      if (method === 'whatsapp') {
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
      } else if (method === 'sms') {
        const smsUrl = `sms:?body=${encodeURIComponent(message)}`;
        window.location.href = smsUrl;
      } else if (method === 'email') {
        const emailUrl = `mailto:?subject=My BorderPay Account Details&body=${encodeURIComponent(message)}`;
        window.location.href = emailUrl;
      } else if (method === 'link') {
        handleCopy(message, 'Account details');
      }
    } catch (error) {
      toast.error('Failed to share');
    }
  };

  const handleGeneratePaymentLink = () => {
    if (!selectedWallet || !requestAmount) {
      toast.error('Please enter an amount');
      return;
    }

    const amount = parseFloat(requestAmount);
    if (amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Generate payment link (this would be a real deep link in production)
    const link = `https://app.borderpayafrica.com/pay?wallet=${selectedWallet.id}&amount=${amount}&note=${encodeURIComponent(requestNote || '')}`;
    setPaymentLink(link);
    toast.success('Payment link generated!');
  };

  const handleDownloadQR = () => {
    if (!qrCodeUrl) return;

    const link = document.createElement('a');
    link.download = `borderpay-${selectedWallet?.currency}-qr.png`;
    link.href = qrCodeUrl;
    link.click();
    toast.success('QR code downloaded!');
  };

  if (!loading && wallets.length === 0) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        <div className={`sticky top-0 z-20 pt-safe ${tc.bg} border-b ${tc.border}`}>
          <div className="flex items-center justify-between p-4">
            <button onClick={onBack} className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold">{t('receive.title')}</h1>
            <div className="w-9" />
          </div>
        </div>

        <div className="flex items-center justify-center min-h-[70vh] p-6">
          <div className="text-center">
            <WalletIcon className={`w-16 h-16 ${tc.textMuted} mx-auto mb-4`} />
            <h2 className="text-xl font-bold mb-2">{t('receive.noWallets')}</h2>
            <p className={`text-sm ${tc.textMuted}`}>{t('receive.createWallet')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-8 relative`}>
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
      <div className={`sticky top-0 z-20 ${tc.bg} border-b ${tc.border}`}>
        <div className="flex items-center justify-between p-4">
          <button onClick={onBack} className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-bold">{t('receive.title')}</h1>
          <div className="w-9" />
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Wallet Selector */}
        <div>
          <label className={`block text-xs font-semibold ${tc.textMuted} mb-2`}>{t('receive.selectWallet')}</label>
          <div className="relative">
            <button
              onClick={() => setShowWalletDropdown(!showWalletDropdown)}
              className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 flex items-center justify-between ${tc.hoverBg} transition-colors`}
            >
              {selectedWallet ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#C7FF00]/10 rounded-full flex items-center justify-center">
                    <WalletIcon className="w-5 h-5 text-[#C7FF00]" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold">{selectedWallet.currency} {t('receive.wallet')}</p>
                    <p className={`text-xs ${tc.textMuted}`}>
                      {selectedWallet.symbol}
                      {selectedWallet.balance.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                <span className={tc.textMuted}>{t('exchange.selectWallet')}</span>
              )}
              <ChevronDown className="w-5 h-5 text-white/40" />
            </button>

            {/* Wallet Dropdown */}
            <AnimatePresence>
              {showWalletDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full mt-2 w-full bg-[#0B0E11]/80 backdrop-blur-2xl border border-white/[0.08] rounded-2xl shadow-xl overflow-hidden z-10 max-h-60 overflow-y-auto"
                >
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      onClick={() => {
                        setSelectedWallet(wallet);
                        setShowWalletDropdown(false);
                        setPaymentLink(''); // Reset payment link
                      }}
                      className={`w-full p-4 flex items-center gap-3 hover:bg-white/5 transition-colors ${
                        selectedWallet?.id === wallet.id ? 'bg-[#C7FF00]/10' : ''
                      }`}
                    >
                      <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                        <WalletIcon className="w-5 h-5 text-white/60" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-semibold text-sm">{wallet.currency}</p>
                        <p className="text-xs text-white/60">
                          {wallet.symbol}
                          {wallet.balance.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Tabs */}
        {selectedWallet && (
          <>
            <div className={`flex gap-1.5 ${tc.card} rounded-2xl p-1`}>
              <button
                onClick={() => setActiveTab('details')}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all ${
                  activeTab === 'details'
                    ? 'bg-[#C7FF00] text-black'
                    : `${tc.textMuted} ${tc.isLight ? 'hover:text-gray-900' : 'hover:text-white'}`
                }`}
              >
                {t('receive.accountDetails')}
              </button>
              <button
                onClick={() => setActiveTab('qr')}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all ${
                  activeTab === 'qr'
                    ? 'bg-[#C7FF00] text-black'
                    : `${tc.textMuted} ${tc.isLight ? 'hover:text-gray-900' : 'hover:text-white'}`
                }`}
              >
                {t('receive.qrCode')}
              </button>
              <button
                onClick={() => setActiveTab('request')}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all ${
                  activeTab === 'request'
                    ? 'bg-[#C7FF00] text-black'
                    : `${tc.textMuted} ${tc.isLight ? 'hover:text-gray-900' : 'hover:text-white'}`
                }`}
              >
                {t('receive.request')}
              </button>
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
              {/* Account Details Tab */}
              {activeTab === 'details' && (
                <motion.div
                  key="details"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  {/* Account Info Card */}
                  <div className={`bg-gradient-to-br ${tc.isLight ? 'from-gray-50 to-gray-100 border-gray-200' : 'from-[#1A1A1A] to-[#0A0A0A] border-white/10'} rounded-3xl p-6 border space-y-4`}>
                    {/* Bank Name */}
                    <div>
                      <p className={`text-xs ${tc.textMuted} mb-1`}>{t('receive.bankName')}</p>
                      <div className={`flex items-center justify-between ${tc.card} rounded-xl p-3`}>
                        <p className="font-semibold">{selectedWallet.bank_name}</p>
                        <button
                          onClick={() => handleCopy(selectedWallet.bank_name!, 'Bank name')}
                          className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
                        >
                          {copiedField === 'Bank name' ? (
                            <Check className="w-4 h-4 text-[#C7FF00]" />
                          ) : (
                            <Copy className={`w-4 h-4 ${tc.textMuted}`} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Account Number */}
                    <div>
                      <p className={`text-xs ${tc.textMuted} mb-1`}>{t('receive.accountNumber')}</p>
                      <div className={`flex items-center justify-between ${tc.card} rounded-xl p-3`}>
                        <p className="font-semibold font-mono text-lg">
                          {selectedWallet.account_number || t('receive.notAvailable')}
                        </p>
                        {selectedWallet.account_number && (
                          <button
                            onClick={() =>
                              handleCopy(selectedWallet.account_number!, 'Account number')
                            }
                            className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
                          >
                            {copiedField === 'Account number' ? (
                              <Check className="w-4 h-4 text-[#C7FF00]" />
                            ) : (
                              <Copy className={`w-4 h-4 ${tc.textMuted}`} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bank Code */}
                    <div>
                      <p className={`text-xs ${tc.textMuted} mb-1`}>{t('receive.bankCode')}</p>
                      <div className={`flex items-center justify-between ${tc.card} rounded-xl p-3`}>
                        <p className="font-semibold font-mono">{selectedWallet.bank_code}</p>
                        <button
                          onClick={() => handleCopy(selectedWallet.bank_code!, 'Bank code')}
                          className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
                        >
                          {copiedField === 'Bank code' ? (
                            <Check className="w-4 h-4 text-[#C7FF00]" />
                          ) : (
                            <Copy className={`w-4 h-4 ${tc.textMuted}`} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Routing Number (USD only) */}
                    {selectedWallet.routing_number && (
                      <div>
                        <p className={`text-xs ${tc.textMuted} mb-1`}>{t('receive.routingNumber')}</p>
                        <div className={`flex items-center justify-between ${tc.card} rounded-xl p-3`}>
                          <p className="font-semibold font-mono">
                            {selectedWallet.routing_number}
                          </p>
                          <button
                            onClick={() =>
                              handleCopy(selectedWallet.routing_number!, 'Routing number')
                            }
                            className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}
                          >
                            {copiedField === 'Routing number' ? (
                              <Check className="w-4 h-4 text-[#C7FF00]" />
                            ) : (
                              <Copy className={`w-4 h-4 ${tc.textMuted}`} />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Currency */}
                    <div>
                      <p className={`text-xs ${tc.textMuted} mb-1`}>{t('receive.currency')}</p>
                      <div className={`${tc.card} rounded-xl p-3`}>
                        <p className="font-semibold">{selectedWallet.currency}</p>
                      </div>
                    </div>
                  </div>

                  {/* Share Options */}
                  <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
                    <h3 className="text-sm font-bold mb-3">{t('receive.shareDetails')}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => handleShare('whatsapp')}
                        className="flex items-center justify-center gap-2 bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/20 rounded-xl py-3 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 text-[#25D366]" />
                        <span className="text-sm font-semibold text-[#25D366]">WhatsApp</span>
                      </button>

                      <button
                        onClick={() => handleShare('sms')}
                        className="flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl py-3 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-semibold text-blue-500">SMS</span>
                      </button>

                      <button
                        onClick={() => handleShare('email')}
                        className="flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-xl py-3 transition-colors"
                      >
                        <Mail className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-semibold text-orange-500">Email</span>
                      </button>

                      <button
                        onClick={() => handleShare('link')}
                        className="flex items-center justify-center gap-2 bg-[#C7FF00]/10 hover:bg-[#C7FF00]/20 border border-[#C7FF00]/20 rounded-xl py-3 transition-colors"
                      >
                        <Copy className="w-4 h-4 text-[#C7FF00]" />
                        <span className="text-sm font-semibold text-[#C7FF00]">Copy</span>
                      </button>
                    </div>
                  </div>

                  {/* Info Box */}
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                    <div className="flex gap-3">
                      <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-blue-400 font-semibold mb-1">
                          {t('receive.fastSecure')}
                        </p>
                        <p className={`text-xs ${tc.textMuted}`}>
                          {t('receive.fastSecureDesc')}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* QR Code Tab */}
              {activeTab === 'qr' && (
                <motion.div
                  key="qr"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  {/* QR Code Card */}
                  <div className={`bg-gradient-to-br ${tc.isLight ? 'from-gray-50 to-gray-100 border-gray-200' : 'from-[#1A1A1A] to-[#0A0A0A] border-white/10'} rounded-3xl p-8 border`}>
                    <div className="text-center mb-6">
                      <QrCode className="w-12 h-12 text-[#C7FF00] mx-auto mb-3" />
                      <h3 className="text-lg font-bold mb-1">{t('receive.scanToPay')}</h3>
                      <p className={`text-xs ${tc.textMuted}`}>
                        {t('receive.scanDesc')} {selectedWallet.currency}
                      </p>
                    </div>

                    {/* QR Code */}
                    <div className="bg-white rounded-3xl p-6 mb-6">
                      {qrCodeUrl ? (
                        <img
                          src={qrCodeUrl}
                          alt="QR Code"
                          className="w-full h-auto max-w-xs mx-auto"
                        />
                      ) : (
                        <div className="w-64 h-64 mx-auto flex items-center justify-center">
                          <div className="w-12 h-12 border-4 border-[#C7FF00] border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* Download Button */}
                    <button
                      onClick={handleDownloadQR}
                      disabled={!qrCodeUrl}
                      className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      {t('receive.downloadQR')}
                    </button>
                  </div>

                  {/* Share QR */}
                  <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
                    <h3 className="text-sm font-bold mb-3">{t('receive.shareQR')}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => handleShare('whatsapp')}
                        className="flex items-center justify-center gap-2 bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/20 rounded-xl py-3 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 text-[#25D366]" />
                        <span className="text-sm font-semibold text-[#25D366]">WhatsApp</span>
                      </button>

                      <button
                        onClick={() => handleShare('email')}
                        className="flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-xl py-3 transition-colors"
                      >
                        <Mail className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-semibold text-orange-500">Email</span>
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                    <div className="flex gap-3">
                      <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-blue-400 font-semibold mb-1">
                          {t('receive.universalQR')}
                        </p>
                        <p className={`text-xs ${tc.textMuted}`}>
                          {t('receive.universalQRDesc')}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Request Payment Tab */}
              {activeTab === 'request' && (
                <motion.div
                  key="request"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  {/* Request Form */}
                  <div className={`bg-gradient-to-br ${tc.isLight ? 'from-gray-50 to-gray-100 border-gray-200' : 'from-[#1A1A1A] to-[#0A0A0A] border-white/10'} rounded-3xl p-6 border space-y-4`}>
                    <div className="text-center mb-4">
                      <DollarSign className="w-12 h-12 text-[#C7FF00] mx-auto mb-3" />
                      <h3 className="text-lg font-bold mb-1">{t('receive.requestPayment')}</h3>
                      <p className={`text-xs ${tc.textMuted}`}>
                        {t('receive.requestDesc')}
                      </p>
                    </div>

                    {/* Amount Input */}
                    <div>
                      <label className={`block text-xs font-semibold ${tc.textMuted} mb-2`}>
                        {t('receive.amount')}
                      </label>
                      <div className="relative">
                        <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold ${tc.textMuted}`}>
                          {selectedWallet.symbol}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={requestAmount}
                          onChange={(e) => setRequestAmount(e.target.value)}
                          placeholder="0.00"
                          className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl py-4 pl-12 pr-4 text-xl font-bold ${tc.text} placeholder:${tc.isLight ? 'text-gray-300' : 'text-white/20'} focus:outline-none focus:border-[#C7FF00] transition-colors`}
                        />
                      </div>
                    </div>

                    {/* Note Input */}
                    <div>
                      <label className={`block text-xs font-semibold ${tc.textMuted} mb-2`}>
                        {t('receive.noteOptional')}
                      </label>
                      <textarea
                        value={requestNote}
                        onChange={(e) => setRequestNote(e.target.value)}
                        placeholder={t('receive.notePlaceholder')}
                        rows={3}
                        className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 text-sm ${tc.text} placeholder:${tc.isLight ? 'text-gray-400' : 'text-white/40'} focus:outline-none focus:border-[#C7FF00] transition-colors resize-none`}
                      />
                    </div>

                    {/* Generate Link Button */}
                    <button
                      onClick={handleGeneratePaymentLink}
                      disabled={!requestAmount || parseFloat(requestAmount) <= 0}
                      className="w-full bg-[#C7FF00] text-black font-bold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('receive.generateLink')}
                    </button>
                  </div>

                  {/* Payment Link */}
                  {paymentLink && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl p-4 space-y-3"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <LinkIcon className="w-5 h-5 text-[#C7FF00]" />
                        <h4 className="font-bold text-sm">{t('receive.linkReady')}</h4>
                      </div>

                      <div className="bg-black/50 rounded-xl p-3 break-all">
                        <p className="text-xs font-mono text-white/80">{paymentLink}</p>
                      </div>

                      {/* Share Payment Link */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            const message = `💰 Payment Request\n\nAmount: ${selectedWallet.symbol}${parseFloat(
                              requestAmount
                            ).toLocaleString()}\nCurrency: ${selectedWallet.currency}\n${
                              requestNote ? `Note: ${requestNote}\n` : ''
                            }\nPay here: ${paymentLink}`;
                            const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
                              message
                            )}`;
                            window.open(whatsappUrl, '_blank');
                          }}
                          className="flex items-center justify-center gap-2 bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/20 rounded-xl py-2 transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-[#25D366]" />
                          <span className="text-xs font-semibold text-[#25D366]">WhatsApp</span>
                        </button>

                        <button
                          onClick={() => handleCopy(paymentLink, 'Payment link')}
                          className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl py-2 transition-colors"
                        >
                          {copiedField === 'Payment link' ? (
                            <>
                              <Check className="w-4 h-4 text-[#C7FF00]" />
                              <span className="text-xs font-semibold text-[#C7FF00]">{t('receive.copied')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className={`w-4 h-4 ${tc.textMuted}`} />
                              <span className="text-xs font-semibold">{t('receive.copyLink')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Info */}
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                    <div className="flex gap-3">
                      <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-blue-400 font-semibold mb-1">
                          Payment Requests
                        </p>
                        <p className="text-xs text-white/60">
                          Share this link with anyone. When they click it, they'll be able to pay
                          you the exact amount you specified.
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}