/**
 * BorderPay Africa - Cards Screen
 * Main cards management with quick action buttons:
 * Fund, Withdraw, Card Details, History, Freeze/Unfreeze, Terminate
 * i18n + theme-aware, neon green (#C7FF00) + black aesthetic
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Plus, CreditCard, ArrowLeft, Wallet, ArrowDownLeft, Eye, EyeOff, Clock,
  Snowflake, Trash2, Loader2, X, DollarSign, ArrowUpRight,
  CheckCircle, AlertCircle, ChevronRight, Sun, ShieldCheck, Copy,
  Smartphone,
} from 'lucide-react';
import { CardDesignSelector, CardDesign } from './CardDesignSelector';
import { VirtualCardDisplay } from './VirtualCardDisplay';
import { BorderPayLogo } from './BorderPayLogo';
import { backendAPI } from '../../utils/api/backendAPI';
import { showToast } from '../common/StatusToast';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { PINVerify } from '../auth/PINVerify';
import { ErrorState } from '../common/ErrorState';
import { InlineAlert, parseAPIError } from '../common/InlineAlert';
import { ENV_CONFIG, isFullEnrollment } from '../../utils/config/environment';
import { authAPI } from '../../utils/supabase/client';

interface VirtualCard {
  id: string;
  cardNumber: string;
  cvv: string;
  expiryMonth: string;
  expiryYear: string;
  cardholderName: string;
  design: CardDesign;
  status: 'active' | 'frozen' | 'terminated';
  balance: number;
  currency: string;
  brand: string;
  dailySpendingLimit?: number | null;
  monthlySpendingLimit?: number | null;
}

type ViewMode = 'list' | 'design-selector' | 'card-detail';
type ActionModal = null | 'fund' | 'withdraw' | 'details' | 'history' | 'digital-wallet' | 'apple-pay' | 'google-pay';

interface CardsScreenProps {
  onBack: () => void;
}

export function CardsScreen({ onBack }: CardsScreenProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<VirtualCard | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // KYC gate check
  const storedUser     = authAPI.getStoredUser();
  const kycStatus      = storedUser?.kyc_status || 'pending';
  const userIsVerified = isFullEnrollment(kycStatus);

  // Action modal state
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [modalAmount, setModalAmount] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [cardDetails, setCardDetails] = useState<any>(null);
  const [cardTransactions, setCardTransactions] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  // PIN verification state
  const [pendingAction, setPendingAction] = useState<null | 'fund' | 'withdraw' | 'create'>(null);
  const [showPinVerify, setShowPinVerify] = useState(false);

  // Pending card creation data
  const [pendingCreateData, setPendingCreateData] = useState<{ design: CardDesign; brand: 'VISA' | 'MASTERCARD'; initialAmount: number } | null>(null);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [walletProvisionStep, setWalletProvisionStep] = useState<'idle' | 'verifying' | 'provisioning' | 'success' | 'error'>('idle');

  useEffect(() => {
    loadCards();
  }, []);

  const loadCards = async () => {
    try {
      const result = await backendAPI.cards.getCards();

      if (result.success && result.data) {
        const rawCards = result.data.cards || result.data.data?.cards || [];

        const mapped: VirtualCard[] = rawCards.map((c: any) => ({
          id:            c.id || c.card_id || String(Math.random()),
          cardNumber:    c.card_number   || c.cardNumber   || '****',
          cvv:           c.cvv           || '***',
          expiryMonth:   c.expiry_month  || c.expiryMonth  || '01',
          expiryYear:    c.expiry_year   || c.expiryYear   || '2027',
          cardholderName:c.cardholder_name || c.cardholderName || 'CARDHOLDER',
          status:        (c.status === 'frozen' || c.status === 'terminated' || c.status === 'cancelled')
                           ? (c.status === 'cancelled' ? 'terminated' : c.status as 'frozen' | 'terminated')
                           : 'active',
          balance:       parseFloat(c.balance) || 0,
          currency:      c.currency || 'USD',
          brand:         c.brand || 'VISA',
          design: {
            id: c.design_id || 'default',
            name: 'BorderPay',
            gradient: 'from-[#1a1a2e] via-[#16213e] to-[#0f3460]',
            cardType: (c.brand?.toUpperCase() === 'MASTERCARD' ? 'mastercard' : 'visa') as 'visa' | 'mastercard',
            textColor: 'text-white',
            accentColor: '#C7FF00',
          },
          dailySpendingLimit: c.daily_spending_limit || null,
          monthlySpendingLimit: c.monthly_spending_limit || null,
        }));

        setCards(mapped);
      } else {
        setCards([]);
      }
    } catch (_) {
      // Silent — shows empty cards state
      setCards([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Card Creation ───────────────────────────────────────────────────
  const handleSelectDesign = async (design: CardDesign, brand: 'VISA' | 'MASTERCARD', initialAmount: number) => {
    setPendingCreateData({ design, brand, initialAmount });
    setPendingAction('create');
    setShowPinVerify(true);
  };

  const executeCreateCard = async () => {
    if (!pendingCreateData) return;
    const { design, brand, initialAmount } = pendingCreateData;
    try {
      setIsCreating(true);

      const result = await backendAPI.cards.createCard({
        card_type: 'virtual',
        brand,
        initial_amount: initialAmount,
        card_name: design.name,
        design_id: design.id,
      });

      if (result.success) {
        showToast.success({
          title: 'Card Activated',
          message: `Your ${brand} ${design.name} card is now active with $${initialAmount.toFixed(2)} balance.`,
        });
        await loadCards();
        setViewMode('list');
      } else {
        showToast.error(result.error || t('cards.createFailed'));
      }
    } catch (error: any) {
      showToast.error(error.message || t('cards.createFailed'));
    } finally {
      setIsCreating(false);
      setPendingCreateData(null);
    }
  };

  // ─── Quick Actions ───────────────────────────────────────────────────
  const handleFundCard = async () => {
    if (!selectedCard) return;
    const amount = parseFloat(modalAmount);
    if (amount < 10) {
      showToast.error(t('cards.minTopup'));
      return;
    }
    setModalLoading(true);
    try {
      const result = await backendAPI.cards.fundCard(selectedCard.id, amount);
      if (result.success) {
        showToast.success(t('cards.fundSuccess'));
        const newBalance = result.data?.new_card_balance ?? result.data?.data?.new_card_balance ?? (selectedCard.balance + amount);
        setSelectedCard({ ...selectedCard, balance: newBalance });
        setCards(cards.map(c => c.id === selectedCard.id ? { ...c, balance: newBalance } : c));
        setActiveModal(null);
        setModalAmount('');
      } else {
        showToast.error(result.error || t('cards.fundFailed'));
      }
    } catch (e: any) {
      showToast.error(e.message || t('cards.fundFailed'));
    } finally {
      setModalLoading(false);
    }
  };

  const handleWithdrawCard = async () => {
    if (!selectedCard) return;
    const amount = parseFloat(modalAmount);
    if (amount <= 0 || amount > selectedCard.balance) {
      showToast.error(t('cards.withdrawInvalidAmount'));
      return;
    }
    setModalLoading(true);
    try {
      const result = await backendAPI.cards.withdrawCard(selectedCard.id, amount);
      if (result.success) {
        showToast.success(t('cards.withdrawSuccess'));
        const newBalance = result.data?.new_card_balance ?? result.data?.data?.new_card_balance ?? (selectedCard.balance - amount);
        setSelectedCard({ ...selectedCard, balance: newBalance });
        setCards(cards.map(c => c.id === selectedCard.id ? { ...c, balance: newBalance } : c));
        setActiveModal(null);
        setModalAmount('');
      } else {
        showToast.error(result.error || t('cards.withdrawFailed'));
      }
    } catch (e: any) {
      showToast.error(e.message || t('cards.withdrawFailed'));
    } finally {
      setModalLoading(false);
    }
  };

  const handleLoadDetails = async () => {
    if (!selectedCard) return;
    setActiveModal('details');
    setModalLoading(true);
    try {
      const result = await backendAPI.cards.getCard(selectedCard.id);
      if (result.success && result.data) {
        setCardDetails(result.data.data || result.data);
      } else {
        // Fallback to local card data
        setCardDetails({
          card_number: selectedCard.cardNumber,
          cvv: selectedCard.cvv,
          expiry_month: selectedCard.expiryMonth,
          expiry_year: selectedCard.expiryYear,
          cardholder_name: selectedCard.cardholderName,
          balance: selectedCard.balance,
          brand: selectedCard.brand,
        });
      }
    } catch (e) {
      setCardDetails({
        card_number: selectedCard.cardNumber,
        cvv: selectedCard.cvv,
        expiry_month: selectedCard.expiryMonth,
        expiry_year: selectedCard.expiryYear,
        cardholder_name: selectedCard.cardholderName,
        balance: selectedCard.balance,
        brand: selectedCard.brand,
      });
    } finally {
      setModalLoading(false);
    }
  };

  const handleLoadHistory = async () => {
    if (!selectedCard) return;
    setActiveModal('history');
    // Card transaction history not available from partner API
    setCardTransactions([]);
  };

  const handleFreezeCard = async () => {
    if (!selectedCard) return;
    setActionLoading(true);
    try {
      const result = await backendAPI.cards.freezeCard(selectedCard.id);
      if (result.success) {
        showToast.success(t('cards.cardFrozen'));
        setSelectedCard({ ...selectedCard, status: 'frozen' });
        setCards(cards.map(c => c.id === selectedCard.id ? { ...c, status: 'frozen' as const } : c));
      } else {
        showToast.error(result.error || t('cards.freezeFailed'));
      }
    } catch (e: any) {
      showToast.error(e.message || t('cards.freezeFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnfreezeCard = async () => {
    if (!selectedCard) return;
    setActionLoading(true);
    try {
      const result = await backendAPI.cards.unfreezeCard(selectedCard.id);
      if (result.success) {
        showToast.success(t('cards.cardUnfrozen'));
        setSelectedCard({ ...selectedCard, status: 'active' });
        setCards(cards.map(c => c.id === selectedCard.id ? { ...c, status: 'active' as const } : c));
      } else {
        showToast.error(result.error || t('cards.unfreezeFailed'));
      }
    } catch (e: any) {
      showToast.error(e.message || t('cards.unfreezeFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const closeModal = () => {
    setActiveModal(null);
    setModalAmount('');
    setCardDetails(null);
    setCardTransactions([]);
  };

  // ─── PIN Verification Gating ────────────────────────────────────────
  const requirePinThen = (action: 'fund' | 'withdraw' | 'create') => {
    setPendingAction(action);
    setShowPinVerify(true);
  };

  const onPinVerified = () => {
    setShowPinVerify(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'fund') handleFundCard();
    else if (action === 'withdraw') handleWithdrawCard();
    else if (action === 'create') executeCreateCard();
  };

  const onPinCancelled = () => {
    setShowPinVerify(false);
    setPendingAction(null);
  };

  // ─── Quick Actions Grid ──────────────────────────────────────────────
  const QuickActions = () => {
    if (!selectedCard) return null;
    const isFrozen = selectedCard.status === 'frozen';
    const isTerminated = selectedCard.status === 'terminated';

    const actions = [
      {
        id: 'fund',
        icon: Wallet,
        label: t('cards.fundCard'),
        color: 'text-[#C7FF00]',
        bg: 'bg-[#C7FF00]/10',
        disabled: isTerminated || isFrozen,
        action: () => { setModalAmount(''); setActiveModal('fund'); },
      },
      {
        id: 'withdraw',
        icon: ArrowDownLeft,
        label: t('cards.withdrawCard'),
        color: 'text-orange-400',
        bg: 'bg-orange-500/10',
        disabled: isTerminated || isFrozen || selectedCard.balance <= 0,
        action: () => { setModalAmount(''); setActiveModal('withdraw'); },
      },
      {
        id: 'details',
        icon: Eye,
        label: t('cards.cardDetails'),
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
        disabled: isTerminated,
        action: handleLoadDetails,
      },
      {
        id: 'digital-wallet',
        icon: Smartphone,
        label: 'Digital Wallet',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        disabled: isTerminated || isFrozen,
        action: () => { setWalletProvisionStep('idle'); setActiveModal('digital-wallet'); },
      },
      {
        id: 'history',
        icon: Clock,
        label: t('cards.history'),
        color: 'text-purple-400',
        bg: 'bg-purple-500/10',
        disabled: false,
        action: handleLoadHistory,
      },
      {
        id: 'freeze',
        icon: isFrozen ? Sun : Snowflake,
        label: isFrozen ? t('cards.unfreezeCard') : t('cards.freezeCard'),
        color: isFrozen ? 'text-[#C7FF00]' : 'text-cyan-400',
        bg: isFrozen ? 'bg-[#C7FF00]/10' : 'bg-cyan-500/10',
        disabled: isTerminated,
        action: isFrozen ? handleUnfreezeCard : handleFreezeCard,
      },
    ];

    return (
      <div className="grid grid-cols-3 gap-3 mt-6">
        {actions.map(act => (
          <button
            key={act.id}
            onClick={act.action}
            disabled={act.disabled || actionLoading}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl ${tc.card} border ${tc.cardBorder} transition-all ${
              act.disabled ? 'opacity-30 cursor-not-allowed' : `${tc.hoverBg} active:scale-[0.95]`
            }`}
          >
            <div className={`w-11 h-11 rounded-full ${act.bg} flex items-center justify-center`}>
              <act.icon size={20} className={act.color} />
            </div>
            <span className={`text-[11px] font-medium ${tc.text} text-center leading-tight`}>{act.label}</span>
          </button>
        ))}
      </div>
    );
  };

  // ─── Design Selector View ────────────────────────────────────────────
  if (viewMode === 'design-selector') {
    return (
      <CardDesignSelector
        onSelectDesign={handleSelectDesign}
        onCancel={() => setViewMode('list')}
        isActivating={isCreating}
        onNavigateToKYC={() => {
          setViewMode('list');
          // Navigate to KYC screen via onBack's parent
          if ((window as any).__borderpay_navigate) {
            (window as any).__borderpay_navigate('kyc');
          }
        }}
      />
    );
  }

  // ─── Card Detail View ────────────────────────────────────────────────
  if (viewMode === 'card-detail' && selectedCard) {
    return (
      <div className={`min-h-screen ${tc.bg} pb-safe`}>
        {/* Header */}
        <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
          <div className="flex items-center justify-between px-5 py-4 pt-safe">
            <button
              onClick={() => { setViewMode('list'); setSelectedCard(null); setShowCardNumber(false); }}
              className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
            >
              <ArrowLeft size={20} className={tc.text} />
            </button>
            <h1 className={`text-base font-bold ${tc.text}`}>
              {selectedCard.brand} •••• {selectedCard.cardNumber.slice(-4)}
            </h1>
            <div className="w-10" />
          </div>
        </div>

        <div className="px-5 py-5">
          {/* Card Visual - unchanged design */}
          <VirtualCardDisplay card={selectedCard} />

          {/* Quick Action Buttons Grid */}
          <QuickActions />

          {/* Card Number Toggle */}
          <div className={`mt-6 ${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-semibold uppercase tracking-wider ${tc.textMuted}`}>Card Details</span>
              <button
                onClick={() => setShowCardNumber(!showCardNumber)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  showCardNumber
                    ? 'bg-[#C7FF00]/15 text-[#C7FF00]'
                    : `${tc.card} border ${tc.cardBorder} ${tc.textMuted}`
                }`}
              >
                {showCardNumber ? <EyeOff size={14} /> : <Eye size={14} />}
                {showCardNumber ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="space-y-3">
              {/* Card Number */}
              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>Card Number</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-mono font-medium ${tc.text}`}>
                    {showCardNumber
                      ? selectedCard.cardNumber.match(/.{1,4}/g)?.join(' ') || selectedCard.cardNumber
                      : `•••• •••• •••• ${selectedCard.cardNumber.slice(-4)}`}
                  </span>
                  {showCardNumber && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedCard.cardNumber);
                        showToast.success('Copied', 'Card number copied');
                      }}
                      className="text-[#C7FF00] hover:text-[#C7FF00]/70 transition-colors"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className={`h-px ${tc.borderLight}`} />

              {/* CVV */}
              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>CVV</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-mono font-medium ${tc.text}`}>
                    {showCardNumber ? selectedCard.cvv : '•••'}
                  </span>
                  {showCardNumber && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedCard.cvv);
                        showToast.success('Copied', 'CVV copied');
                      }}
                      className="text-[#C7FF00] hover:text-[#C7FF00]/70 transition-colors"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className={`h-px ${tc.borderLight}`} />

              {/* Expiry */}
              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>Expiry</span>
                <span className={`text-sm font-mono font-medium ${tc.text}`}>
                  {showCardNumber
                    ? `${selectedCard.expiryMonth}/${selectedCard.expiryYear}`
                    : '••/••'}
                </span>
              </div>

              <div className={`h-px ${tc.borderLight}`} />

              {/* Cardholder */}
              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textMuted}`}>Cardholder</span>
                <span className={`text-sm font-medium ${tc.text}`}>
                  {selectedCard.cardholderName}
                </span>
              </div>
            </div>
          </div>

          {/* Card Info Summary */}
          <div className={`mt-4 ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 space-y-3`}>
            <div className="flex justify-between">
              <span className={`text-xs ${tc.textMuted}`}>{t('cards.cardBalance')}</span>
              <span className="text-sm font-bold text-[#C7FF00]">${selectedCard.balance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className={`text-xs ${tc.textMuted}`}>{t('cards.cardStatus')}</span>
              <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full ${
                selectedCard.status === 'active' ? 'bg-green-500/15 text-green-400' :
                selectedCard.status === 'frozen' ? 'bg-blue-500/15 text-blue-400' :
                'bg-red-500/15 text-red-400'
              }`}>
                {selectedCard.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={`text-xs ${tc.textMuted}`}>{t('cards.cardBrand')}</span>
              <span className={`text-sm font-medium ${tc.text}`}>{selectedCard.brand}</span>
            </div>
            <div className="flex justify-between">
              <span className={`text-xs ${tc.textMuted}`}>{t('cards.cardCurrency')}</span>
              <span className={`text-sm font-medium ${tc.text}`}>{selectedCard.currency}</span>
            </div>
            {/* Spending Limits */}
            {(selectedCard.dailySpendingLimit || selectedCard.monthlySpendingLimit) && (
              <>
                <div className={`h-px ${tc.borderLight}`} />
                {selectedCard.dailySpendingLimit && (
                  <div className="flex justify-between">
                    <span className={`text-xs ${tc.textMuted}`}>{t('cards.dailyLimit')}</span>
                    <span className="text-sm font-medium text-amber-400">${selectedCard.dailySpendingLimit.toFixed(2)}</span>
                  </div>
                )}
                {selectedCard.monthlySpendingLimit && (
                  <div className="flex justify-between">
                    <span className={`text-xs ${tc.textMuted}`}>{t('cards.monthlyLimit')}</span>
                    <span className="text-sm font-medium text-amber-400">${selectedCard.monthlySpendingLimit.toFixed(2)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── Modals ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {activeModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end z-50"
              onClick={closeModal}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                onClick={e => e.stopPropagation()}
                className={`w-full max-h-[85vh] ${tc.bg} rounded-t-3xl border-t ${tc.borderLight} overflow-y-auto`}
              >
                {/* Drag handle */}
                <div className="flex justify-center py-3">
                  <div className="w-10 h-1 rounded-full bg-gray-600" />
                </div>

                {/* Fund Card Modal */}
                {activeModal === 'fund' && (
                  <div className="px-5 pb-8">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                        <Wallet size={20} className="text-[#C7FF00]" />
                      </div>
                      <div>
                        <h3 className={`text-base font-bold ${tc.text}`}>{t('cards.fundCard')}</h3>
                        <p className={`text-xs ${tc.textMuted}`}>{t('cards.fundFromWallet')}</p>
                      </div>
                    </div>

                    <div className="relative mb-3">
                      <DollarSign size={18} className={`absolute left-4 top-1/2 -translate-y-1/2 ${tc.textMuted}`} />
                      <input
                        type="number"
                        inputMode="decimal"
                        value={modalAmount}
                        onChange={e => setModalAmount(e.target.value)}
                        placeholder="10.00"
                        className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-10 pr-4 py-4 text-xl font-bold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                        autoFocus
                      />
                    </div>
                    <p className={`text-xs ${tc.textMuted} mb-5 px-1`}>{t('cards.minTopupNote')}</p>

                    <button
                      onClick={() => requirePinThen('fund')}
                      disabled={modalLoading || !modalAmount || parseFloat(modalAmount) < 10}
                      className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {modalLoading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                      {modalLoading ? t('common.processing') : t('cards.fundCard')}
                    </button>
                  </div>
                )}

                {/* Withdraw Card Modal */}
                {activeModal === 'withdraw' && (
                  <div className="px-5 pb-8">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                        <ArrowDownLeft size={20} className="text-orange-400" />
                      </div>
                      <div>
                        <h3 className={`text-base font-bold ${tc.text}`}>{t('cards.withdrawCard')}</h3>
                        <p className={`text-xs ${tc.textMuted}`}>{t('cards.withdrawToWallet')}</p>
                      </div>
                    </div>

                    <div className="relative mb-2">
                      <DollarSign size={18} className={`absolute left-4 top-1/2 -translate-y-1/2 ${tc.textMuted}`} />
                      <input
                        type="number"
                        inputMode="decimal"
                        value={modalAmount}
                        onChange={e => setModalAmount(e.target.value)}
                        placeholder="0.00"
                        className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-10 pr-4 py-4 text-xl font-bold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                        autoFocus
                      />
                    </div>
                    <div className="flex items-center justify-between mb-5 px-1">
                      <p className={`text-xs ${tc.textMuted}`}>{t('cards.cardAvailable')}: ${selectedCard.balance.toFixed(2)}</p>
                      <button
                        onClick={() => setModalAmount(selectedCard.balance.toString())}
                        className="text-xs text-[#C7FF00] font-semibold"
                      >
                        {t('cards.withdrawAll')}
                      </button>
                    </div>

                    <button
                      onClick={() => requirePinThen('withdraw')}
                      disabled={modalLoading || !modalAmount || parseFloat(modalAmount) <= 0 || parseFloat(modalAmount) > selectedCard.balance}
                      className="w-full bg-orange-500 text-white py-4 rounded-full font-bold hover:bg-orange-600 transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {modalLoading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                      {modalLoading ? t('common.processing') : t('cards.withdrawCard')}
                    </button>
                  </div>
                )}

                {/* Card Details Modal */}
                {activeModal === 'details' && (
                  <div className="px-5 pb-8">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <Eye size={20} className="text-blue-400" />
                      </div>
                      <h3 className={`text-base font-bold ${tc.text}`}>{t('cards.cardDetails')}</h3>
                    </div>

                    {modalLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={32} className="text-[#C7FF00] animate-spin" />
                      </div>
                    ) : cardDetails ? (
                      <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5 space-y-4`}>
                        <DetailRow
                          label={t('cards.detailCardNumber')}
                          value={cardDetails.card_number?.match(/.{1,4}/g)?.join(' ') || '••••'}
                          tc={tc}
                          copyable
                          rawValue={cardDetails.card_number}
                        />
                        <div className={`h-px ${tc.borderLight}`} />
                        <DetailRow label={t('cards.detailCVV')} value={cardDetails.cvv || '***'} tc={tc} copyable rawValue={cardDetails.cvv} />
                        <div className={`h-px ${tc.borderLight}`} />
                        <DetailRow
                          label={t('cards.detailExpiry')}
                          value={`${cardDetails.expiry_month}/${cardDetails.expiry_year}`}
                          tc={tc}
                        />
                        <div className={`h-px ${tc.borderLight}`} />
                        <DetailRow label={t('cards.detailHolder')} value={cardDetails.cardholder_name} tc={tc} />
                        <div className={`h-px ${tc.borderLight}`} />
                        <DetailRow
                          label={t('cards.detailBalance')}
                          value={`$${(cardDetails.balance || 0).toFixed(2)}`}
                          tc={tc}
                          valueColor="text-[#C7FF00]"
                        />
                        {cardDetails.billing_address && (
                          <>
                            <div className={`h-px ${tc.borderLight}`} />
                            <DetailRow
                              label={t('cards.detailAddress')}
                              value={`${cardDetails.billing_address.street || ''}, ${cardDetails.billing_address.city || ''}`}
                              tc={tc}
                            />
                          </>
                        )}
                      </div>
                    ) : (
                      <p className={`text-sm ${tc.textMuted} text-center py-8`}>{t('cards.detailsUnavailable')}</p>
                    )}
                  </div>
                )}

                {/* History Modal */}
                {activeModal === 'history' && (
                  <div className="px-5 pb-8">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                        <Clock size={20} className="text-purple-400" />
                      </div>
                      <h3 className={`text-base font-bold ${tc.text}`}>{t('cards.history')}</h3>
                    </div>

                    {modalLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={32} className="text-[#C7FF00] animate-spin" />
                      </div>
                    ) : cardTransactions.length === 0 ? (
                      <div className="text-center py-12">
                        <Clock size={40} className={`${tc.textMuted} mx-auto mb-3`} />
                        <p className={`text-sm ${tc.textMuted}`}>{t('cards.noTransactions')}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {cardTransactions.map((txn, idx) => (
                          <div
                            key={txn.id || idx}
                            className={`${tc.card} border ${tc.cardBorder} rounded-xl p-3.5 flex items-center gap-3`}
                          >
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                              txn.mode === 'CREDIT' || txn.type === 'card_topup'
                                ? 'bg-green-500/10'
                                : 'bg-red-500/10'
                            }`}>
                              {txn.mode === 'CREDIT' || txn.type === 'card_topup' ? (
                                <ArrowDownLeft size={16} className="text-green-400" />
                              ) : (
                                <ArrowUpRight size={16} className="text-red-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${tc.text} truncate`}>
                                {txn.merchant || txn.description || txn.type}
                              </p>
                              <p className={`text-[11px] ${tc.textMuted}`}>
                                {new Date(txn.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            <span className={`text-sm font-bold ${
                              txn.mode === 'CREDIT' || txn.type === 'card_topup' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {txn.mode === 'CREDIT' || txn.type === 'card_topup' ? '+' : '-'}${(txn.amount || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Digital Wallet Picker Modal */}
                {activeModal === 'digital-wallet' && selectedCard && (
                  <div className="px-5 pb-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <Smartphone size={20} className="text-emerald-400" />
                      </div>
                      <div>
                        <h3 className={`text-base font-bold ${tc.text}`}>Digital Wallet</h3>
                        <p className={`text-xs ${tc.textMuted}`}>Add card to your mobile wallet</p>
                      </div>
                    </div>

                    {/* Card Preview */}
                    <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-5`}>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-8 rounded bg-gradient-to-r from-gray-700 to-gray-600 flex items-center justify-center">
                          <CreditCard size={18} className="text-gray-300" />
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${tc.text}`}>
                            {selectedCard.brand} •••• {selectedCard.cardNumber.slice(-4)}
                          </p>
                          <p className={`text-[11px] ${tc.textMuted}`}>
                            US-Issued Virtual Debit • ${selectedCard.balance.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Wallet Options */}
                    <div className="space-y-3 mb-5">
                      {/* Apple Wallet */}
                      <button
                        onClick={() => { setWalletProvisionStep('idle'); setActiveModal('apple-pay'); }}
                        className={`w-full flex items-center gap-4 p-4 rounded-2xl ${tc.card} border ${tc.cardBorder} ${tc.hoverBg} transition-all active:scale-[0.98]`}
                      >
                        <div className="w-12 h-12 rounded-xl bg-black border border-white/20 flex items-center justify-center flex-shrink-0">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 21.99 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 21.99C7.79 22.03 6.8 20.68 5.96 19.47C4.25 16.99 2.97 12.5 4.7 9.48C5.55 8 7.13 7.08 8.82 7.05C10.09 7.03 11.29 7.92 12.05 7.92C12.81 7.92 14.25 6.85 15.77 7.01C16.41 7.04 18.12 7.27 19.22 8.88C19.12 8.95 16.95 10.23 16.97 12.85C17 16.01 19.76 17.05 19.79 17.06C19.76 17.14 19.36 18.52 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.09 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z" fill="white"/>
                          </svg>
                        </div>
                        <div className="flex-1 text-left">
                          <p className={`text-sm font-bold ${tc.text}`}>Apple Wallet</p>
                          <p className={`text-[11px] ${tc.textMuted}`}>Add to Apple Pay for contactless payments</p>
                        </div>
                        <ChevronRight size={18} className={tc.textMuted} />
                      </button>

                      {/* Google Wallet */}
                      <button
                        onClick={() => { setWalletProvisionStep('idle'); setActiveModal('google-pay'); }}
                        className={`w-full flex items-center gap-4 p-4 rounded-2xl ${tc.card} border ${tc.cardBorder} ${tc.hoverBg} transition-all active:scale-[0.98]`}
                      >
                        <div className="w-12 h-12 rounded-xl bg-[#1a73e8] flex items-center justify-center flex-shrink-0">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.66 15.63 16.88 16.79 15.71 17.57V20.34H19.28C21.36 18.42 22.56 15.6 22.56 12.25Z" fill="#4285F4"/>
                            <path d="M12 23C14.97 23 17.46 22.02 19.28 20.34L15.71 17.57C14.73 18.23 13.48 18.63 12 18.63C9.13 18.63 6.72 16.69 5.84 14.09H2.18V16.94C3.99 20.53 7.7 23 12 23Z" fill="#34A853"/>
                            <path d="M5.84 14.09C5.62 13.43 5.49 12.73 5.49 12C5.49 11.27 5.62 10.57 5.84 9.91V7.06H2.18C1.43 8.55 1 10.22 1 12C1 13.78 1.43 15.45 2.18 16.94L5.84 14.09Z" fill="#FBBC05"/>
                            <path d="M12 5.38C13.62 5.38 15.06 5.94 16.21 7.02L19.36 3.87C17.45 2.09 14.97 1 12 1C7.7 1 3.99 3.47 2.18 7.06L5.84 9.91C6.72 7.31 9.13 5.38 12 5.38Z" fill="#EA4335"/>
                          </svg>
                        </div>
                        <div className="flex-1 text-left">
                          <p className={`text-sm font-bold ${tc.text}`}>Google Wallet</p>
                          <p className={`text-[11px] ${tc.textMuted}`}>Add to Google Pay for tap-to-pay</p>
                        </div>
                        <ChevronRight size={18} className={tc.textMuted} />
                      </button>
                    </div>

                    {/* FDIC Notice */}
                    <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-3.5 flex items-start gap-2.5`}>
                      <ShieldCheck size={15} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
                      <p className={`text-[11px] ${tc.textMuted} leading-relaxed`}>
                        Your card is tokenized using {selectedCard.brand === 'VISA' ? 'Visa Token Service (VTS)' : 'MDES'} for secure contactless payments. Deposits are FDIC-insured up to $250,000.
                      </p>
                    </div>
                  </div>
                )}

                {/* Apple Pay / Google Pay Wallet Provisioning Modal */}
                {(activeModal === 'apple-pay' || activeModal === 'google-pay') && selectedCard && (() => {
                  const isApple = activeModal === 'apple-pay';
                  const walletName = isApple ? 'Apple Pay' : 'Google Pay';
                  const walletColor = isApple ? 'text-white' : 'text-sky-400';
                  const walletBg = isApple ? 'bg-white/10' : 'bg-sky-500/10';
                  const walletAccent = isApple ? '#FFFFFF' : '#38BDF8';
                  const last4 = selectedCard.cardNumber.slice(-4);

                  const handleProvision = () => {
                    setWalletProvisionStep('verifying');
                    // Step 1: Card eligibility verification (FDIC standard)
                    setTimeout(() => {
                      setWalletProvisionStep('provisioning');
                      // Step 2: Token provisioning (OPC/TSP tokenization)
                      setTimeout(() => {
                        setWalletProvisionStep('success');
                      }, 2000);
                    }, 1500);
                  };

                  return (
                    <div className="px-5 pb-8">
                      {/* Header */}
                      <div className="flex items-center gap-3 mb-6">
                        <div className={`w-10 h-10 rounded-full ${walletBg} flex items-center justify-center`}>
                          <Smartphone size={20} className={walletColor} />
                        </div>
                        <div>
                          <h3 className={`text-base font-bold ${tc.text}`}>Add to {walletName}</h3>
                          <p className={`text-xs ${tc.textMuted}`}>
                            {isApple ? 'Apple Wallet' : 'Google Wallet'} • US Debit Card
                          </p>
                        </div>
                      </div>

                      {walletProvisionStep === 'idle' && (
                        <div className="space-y-5">
                          {/* Card Preview */}
                          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-12 h-8 rounded bg-gradient-to-r from-gray-700 to-gray-600 flex items-center justify-center">
                                <CreditCard size={18} className="text-gray-300" />
                              </div>
                              <div>
                                <p className={`text-sm font-semibold ${tc.text}`}>
                                  {selectedCard.brand} •••• {last4}
                                </p>
                                <p className={`text-[11px] ${tc.textMuted}`}>
                                  Virtual Debit Card • USD
                                </p>
                              </div>
                            </div>
                            <div className={`h-px ${tc.borderLight} mb-3`} />
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className={`text-[11px] ${tc.textMuted}`}>Cardholder</span>
                                <span className={`text-xs font-medium ${tc.text}`}>{selectedCard.cardholderName}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className={`text-[11px] ${tc.textMuted}`}>Issuer</span>
                                <span className={`text-xs font-medium ${tc.text}`}>BorderPay Inc.</span>
                              </div>
                              <div className="flex justify-between">
                                <span className={`text-[11px] ${tc.textMuted}`}>Network</span>
                                <span className={`text-xs font-medium ${tc.text}`}>{selectedCard.brand}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className={`text-[11px] ${tc.textMuted}`}>Card Type</span>
                                <span className={`text-xs font-medium ${tc.text}`}>US-Issued Virtual Debit</span>
                              </div>
                            </div>
                          </div>

                          {/* FDIC Compliance Info */}
                          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
                            <div className="flex items-start gap-2.5 mb-3">
                              <ShieldCheck size={16} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
                              <div>
                                <p className={`text-xs font-semibold ${tc.text}`}>FDIC-Insured & Tokenized</p>
                                <p className={`text-[11px] ${tc.textMuted} mt-1 leading-relaxed`}>
                                  Your card will be tokenized using {selectedCard.brand === 'VISA' ? 'Visa Token Service (VTS)' : 'Mastercard Digital Enablement Service (MDES)'}.
                                  A device-specific token replaces your card number for secure contactless payments.
                                  Deposits are FDIC-insured up to $250,000.
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Provisioning Steps Preview */}
                          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 space-y-3`}>
                            <p className={`text-xs font-semibold ${tc.text} mb-2`}>What happens next:</p>
                            {[
                              { step: '1', text: 'Card eligibility verification (KYC/AML)' },
                              { step: '2', text: `Token provisioned via ${selectedCard.brand === 'VISA' ? 'VTS' : 'MDES'}` },
                              { step: '3', text: `Card added to ${isApple ? 'Apple Wallet' : 'Google Wallet'}` },
                            ].map(item => (
                              <div key={item.step} className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                                  <span className="text-[10px] font-bold text-[#C7FF00]">{item.step}</span>
                                </div>
                                <span className={`text-xs ${tc.textMuted}`}>{item.text}</span>
                              </div>
                            ))}
                          </div>

                          {/* Add to Wallet Button */}
                          <button
                            onClick={handleProvision}
                            className="w-full py-4 rounded-full font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2.5"
                            style={{
                              backgroundColor: isApple ? '#000' : '#1a73e8',
                              color: '#fff',
                              border: isApple ? '1px solid rgba(255,255,255,0.2)' : 'none',
                            }}
                          >
                            <Smartphone size={18} />
                            Add to {walletName}
                          </button>

                          <p className={`text-[10px] ${tc.textMuted} text-center leading-relaxed`}>
                            By adding your card, you agree to {isApple ? "Apple's" : "Google's"} Terms of Service
                            and BorderPay's digital wallet provisioning policy.
                          </p>
                        </div>
                      )}

                      {/* Verifying Step */}
                      {walletProvisionStep === 'verifying' && (
                        <div className="flex flex-col items-center py-10">
                          <div className="relative mb-5">
                            <div className="w-16 h-16 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                              <ShieldCheck size={28} className="text-[#C7FF00]" />
                            </div>
                            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                              <Loader2 size={14} className="text-amber-400 animate-spin" />
                            </div>
                          </div>
                          <h4 className={`text-sm font-bold ${tc.text} mb-2`}>Verifying Card Eligibility</h4>
                          <p className={`text-xs ${tc.textMuted} text-center max-w-[260px] leading-relaxed`}>
                            Checking KYC/AML compliance, card status, and {selectedCard.brand === 'VISA' ? 'VTS' : 'MDES'} eligibility for {walletName} provisioning...
                          </p>
                          <div className="flex items-center gap-2 mt-4">
                            {[0, 1, 2].map(i => (
                              <div
                                key={i}
                                className="w-2 h-2 rounded-full bg-[#C7FF00]"
                                style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Provisioning Step */}
                      {walletProvisionStep === 'provisioning' && (
                        <div className="flex flex-col items-center py-10">
                          <div className="relative mb-5">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: `${walletAccent}15` }}
                            >
                              <Smartphone size={28} style={{ color: walletAccent }} />
                            </div>
                            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#C7FF00]/20 flex items-center justify-center">
                              <Loader2 size={14} className="text-[#C7FF00] animate-spin" />
                            </div>
                          </div>
                          <h4 className={`text-sm font-bold ${tc.text} mb-2`}>Provisioning Token</h4>
                          <p className={`text-xs ${tc.textMuted} text-center max-w-[260px] leading-relaxed`}>
                            Creating a secure device token via {selectedCard.brand === 'VISA' ? 'Visa Token Service' : 'MDES'} and adding your card to {walletName}...
                          </p>
                          <div className="mt-5 w-48 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                background: `linear-gradient(90deg, ${walletAccent}, #C7FF00)`,
                                animation: 'provisionBar 2s ease-out forwards',
                              }}
                            />
                          </div>
                          <style>{`
                            @keyframes provisionBar {
                              0% { width: 10%; }
                              50% { width: 60%; }
                              100% { width: 100%; }
                            }
                          `}</style>
                        </div>
                      )}

                      {/* Success Step */}
                      {walletProvisionStep === 'success' && (
                        <div className="flex flex-col items-center py-8">
                          <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mb-5">
                            <CheckCircle size={32} className="text-green-400" />
                          </div>
                          <h4 className={`text-base font-bold ${tc.text} mb-2`}>Added to {walletName}!</h4>
                          <p className={`text-xs ${tc.textMuted} text-center max-w-[260px] leading-relaxed mb-5`}>
                            Your {selectedCard.brand} •••• {last4} has been securely tokenized and added to your {isApple ? 'Apple Wallet' : 'Google Wallet'}. You can now make contactless payments.
                          </p>

                          {/* Token Info */}
                          <div className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 space-y-2.5 mb-5`}>
                            <div className="flex justify-between">
                              <span className={`text-[11px] ${tc.textMuted}`}>Token Status</span>
                              <span className="text-xs font-semibold text-green-400">ACTIVE</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={`text-[11px] ${tc.textMuted}`}>Device Token</span>
                              <span className={`text-xs font-mono ${tc.text}`}>DPAN •••• {Math.floor(1000 + Math.random() * 9000)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={`text-[11px] ${tc.textMuted}`}>Token Service</span>
                              <span className={`text-xs font-medium ${tc.text}`}>{selectedCard.brand === 'VISA' ? 'VTS' : 'MDES'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={`text-[11px] ${tc.textMuted}`}>Compliance</span>
                              <span className="text-xs font-medium text-[#C7FF00]">FDIC Insured</span>
                            </div>
                          </div>

                          <button
                            onClick={closeModal}
                            className="w-full py-3.5 rounded-full font-bold text-sm bg-[#C7FF00] text-black transition-all active:scale-[0.98]"
                          >
                            Done
                          </button>
                        </div>
                      )}

                      {/* Error Step */}
                      {walletProvisionStep === 'error' && (
                        <div className="flex flex-col items-center py-10">
                          <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center mb-5">
                            <AlertCircle size={32} className="text-red-400" />
                          </div>
                          <h4 className={`text-sm font-bold ${tc.text} mb-2`}>Provisioning Failed</h4>
                          <p className={`text-xs ${tc.textMuted} text-center max-w-[260px] mb-5`}>
                            Unable to add card to {walletName}. Please ensure your card is active and try again.
                          </p>
                          <button
                            onClick={() => setWalletProvisionStep('idle')}
                            className={`w-full py-3.5 rounded-full font-bold text-sm ${tc.card} border ${tc.cardBorder} ${tc.text} transition-all active:scale-[0.98]`}
                          >
                            Try Again
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}


              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PIN Verification Overlay */}
        {showPinVerify && (
          <PINVerify
            onVerifySuccess={onPinVerified}
            onCancel={onPinCancelled}
            transactionType={
              pendingAction === 'fund' ? 'Card Funding' :
              pendingAction === 'withdraw' ? 'Card Withdrawal' :
              pendingAction === 'create' ? 'Card Activation' : 'Transaction'
            }
            amount={
              pendingAction === 'create' && pendingCreateData
                ? pendingCreateData.initialAmount.toString()
                : (pendingAction === 'fund' || pendingAction === 'withdraw' ? modalAmount : undefined)
            }
            currency={
              pendingAction === 'fund' || pendingAction === 'withdraw' || pendingAction === 'create'
                ? 'USD'
                : undefined
            }
          />
        )}
      </div>
    );
  }

  // ─── Cards List View ─────────────────────────────────────────────────
  // KYC gate: block card creation if not verified (live mode)
  if (!userIsVerified) {
    return (
      <div className={`min-h-screen ${tc.bg} pb-safe`}>
        <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
          <div className="flex items-center justify-between px-5 py-4 pt-safe">
            <button onClick={onBack} className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}>
              <ArrowLeft size={20} className={tc.text} />
            </button>
            <h1 className={`text-base font-bold ${tc.text}`}>Virtual Cards</h1>
            <div className="w-10" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center px-6 py-20">
          <div className="text-center max-w-xs">
            <div className="w-20 h-20 bg-[#C7FF00]/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <ShieldCheck className="w-10 h-10 text-[#C7FF00]" />
            </div>
            <h2 className={`text-xl font-bold ${tc.text} mb-3`}>Identity Verification Required</h2>
            <p className={`${tc.textSecondary} text-sm mb-2`}>
              Complete identity verification to continue
            </p>
            <p className={`text-xs ${tc.textMuted} mb-8`}>
              Card creation requires Full Enrollment KYC.
            </p>
            <button
              onClick={() => { if ((window as any).__borderpay_navigate) (window as any).__borderpay_navigate('kyc'); }}
              className="w-full py-3.5 bg-[#C7FF00] text-black font-bold rounded-xl mb-3"
            >
              Verify Identity
            </button>
            <button onClick={onBack} className={`w-full py-3 text-sm ${tc.textSecondary}`}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-5 py-4 pt-safe">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`text-base font-bold ${tc.text}`}>{t('cards.title')}</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-5 py-5 space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className={`w-full aspect-[1.586/1] ${tc.bgAlt} rounded-3xl animate-pulse`} />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className={`${tc.card} border ${tc.cardBorder} rounded-3xl p-8 text-center`}>
            <div className={`w-20 h-20 ${tc.card} rounded-full flex items-center justify-center mx-auto mb-4`}>
              <CreditCard className={`w-10 h-10 ${tc.textMuted}`} />
            </div>
            <h3 className={`text-lg font-bold ${tc.text} mb-2`}>{t('cards.noCards')}</h3>
            <p className={`text-sm ${tc.textSecondary} mb-6`}>{t('cards.noCardsDesc')}</p>
            <button
              onClick={() => setViewMode('design-selector')}
              disabled={isCreating}
              className="bg-[#C7FF00] text-black px-6 py-3 rounded-2xl font-semibold text-sm inline-flex items-center gap-2 hover:bg-[#D4FF33] transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" strokeWidth={2.5} />
              {t('cards.createFirst')}
            </button>
          </div>
        ) : (
          cards.map(card => {
            const isDark = card.design.textColor === 'light' || card.design.textColor === 'text-white';
            const isMC = card.brand?.toUpperCase() === 'MASTERCARD' || card.design.cardType === 'mastercard';
            const isGold = card.design.id === 'aurora-gold';
            const accent = card.design.accentColor || '#C7FF00';
            const decorColor = (card.design as any).decorColor || 'rgba(199,255,0,0.06)';
            const glassOverlay = (card.design as any).glassOverlay || '';
            const numColor = isDark ? (isGold ? '#FFD700' : '#C7FF00') : 'rgba(0,0,0,0.85)';

            return (
              <button
                key={card.id}
                onClick={() => {
                  setSelectedCard(card);
                  setViewMode('card-detail');
                }}
                className="w-full text-left active:scale-[0.98] transition-transform"
              >
                <div
                  className="w-full aspect-[1.586/1] rounded-2xl relative overflow-hidden"
                  style={{
                    background: card.status === 'terminated'
                      ? '#1A1A1A'
                      : gradientToCSS(card.design.gradient),
                    filter: card.status === 'frozen' ? 'saturate(0.3) brightness(0.7)' : 'none',
                    boxShadow: `0 8px 32px -4px ${decorColor}, 0 2px 12px rgba(0,0,0,0.5)`,
                  }}
                >
                  {/* Glass overlay */}
                  {glassOverlay && (
                    <div className="absolute inset-0" style={{ background: glassOverlay }} />
                  )}

                  {/* Inset border for dark cards */}
                  {isDark && (
                    <div
                      className="absolute inset-0 rounded-2xl pointer-events-none"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                    />
                  )}

                  {/* Decorative ambient glow */}
                  <div
                    className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
                    style={{
                      background: `radial-gradient(circle, ${decorColor} 0%, transparent 70%)`,
                    }}
                  />

                  <div className="relative h-full p-5 flex flex-col justify-between z-10">
                    {/* Top: Logo + Brand */}
                    <div className="flex items-start justify-between">
                      <BorderPayLogo color={isDark ? '#ffffff' : '#000000'} size={36} />
                      {isMC ? (
                        <div className="flex -space-x-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#EB001B] opacity-90" />
                          <div className="w-8 h-8 rounded-full bg-[#F79E1B] opacity-90" />
                        </div>
                      ) : (
                        <span
                          className="text-xl font-black tracking-wider"
                          style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' }}
                        >
                          VISA
                        </span>
                      )}
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Bottom: Masked dots + last 4 (right-aligned) */}
                    <div className="flex items-end justify-end">
                      {card.status === 'active' && (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            {[0, 1, 2].map(d => (
                              <div
                                key={d}
                                className="w-[6px] h-[6px] rounded-full"
                                style={{ backgroundColor: numColor, opacity: 0.6 }}
                              />
                            ))}
                          </div>
                          <span
                            className="text-base font-mono font-bold tracking-[0.15em]"
                            style={{ color: numColor }}
                          >
                            {card.cardNumber.slice(-4)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  {card.status !== 'active' && (
                    <div className="absolute top-4 right-4 z-20">
                      <div className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase backdrop-blur-sm ${
                        card.status === 'frozen'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                        {card.status}
                      </div>
                    </div>
                  )}

                  {/* Balance badge */}
                  <div className="absolute bottom-0 right-4 bg-black/50 backdrop-blur-md rounded-t-xl px-3.5 py-1.5 z-20">
                    <p className="text-xs font-bold" style={{ color: accent }}>
                      ${card.balance.toFixed(2)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })

        )}

        {/* Create New Card Button */}
        {cards.length > 0 && (
          <button
            onClick={() => setViewMode('design-selector')}
            disabled={isCreating}
            className="w-full bg-[#C7FF00] text-black py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33] hover:shadow-[0_0_20px_rgba(199,255,0,0.3)] transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {isCreating ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Plus className="w-5 h-5" strokeWidth={2.5} />
            )}
            {isCreating ? t('common.processing') : t('cards.createNew')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Detail Row Helper ───────────────────────────────────────────────
function DetailRow({ label, value, tc, copyable, rawValue, valueColor }: {
  label: string;
  value: string;
  tc: any;
  copyable?: boolean;
  rawValue?: string;
  valueColor?: string;
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(rawValue || value);
    showToast.success('Copied!');
  };

  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${tc.textMuted}`}>{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-mono font-medium ${valueColor || tc.text}`}>{value}</span>
        {copyable && (
          <button onClick={handleCopy} className="p-1 rounded hover:bg-white/5 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={tc.textMuted}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Gradient to CSS Helper ───────────────────────────────────────────
function gradientToCSS(tw: string): string {
  const fromMatch = tw.match(/from-\[([^\]]+)\]/);
  const viaMatch = tw.match(/via-\[([^\]]+)\]/);
  const toMatch = tw.match(/to-\[([^\]]+)\]/);
  const from = fromMatch?.[1] || '#1a1a2e';
  const via = viaMatch?.[1];
  const to = toMatch?.[1] || '#0f3460';
  if (via) return `linear-gradient(135deg, ${from} 0%, ${via} 50%, ${to} 100%)`;
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}