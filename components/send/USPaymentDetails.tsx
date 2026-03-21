/**
 * BorderPay Africa - US Payment Details (ACH/Wire)
 * Sub-component for counterparty selection/creation and payment rail selection.
 * Used inside SendMoneyFlow when method === 'us_ach_wire'.
 *
 * Now includes:
 * - Restricted jurisdiction check (beneficiary country)
 * - Country field in quick counterparty form
 * - Link to full counterparty creation wizard
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown, CheckCircle, Loader2, Plus, Building2, User, Briefcase, Zap, Shield,
  AlertTriangle, ExternalLink, Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import {
  isCountryRestricted,
  getRestrictionReason,
} from '../../utils/compliance/restrictedJurisdictions';

interface USPaymentDetailsProps {
  tc: any;
  t: (key: string) => string;
  usCounterparties: any[];
  selectedCounterparty: any;
  setSelectedCounterparty: (cp: any) => void;
  loadingCounterparties: boolean;
  setLoadingCounterparties: (v: boolean) => void;
  showCounterpartyList: boolean;
  setShowCounterpartyList: (v: boolean) => void;
  showNewCounterparty: boolean;
  setShowNewCounterparty: (v: boolean) => void;
  paymentRail: 'ACH' | 'ACH-ACCELERATED' | 'FEDWIRE';
  setPaymentRail: (v: 'ACH' | 'ACH-ACCELERATED' | 'FEDWIRE') => void;
  setUsCounterparties: (cps: any[]) => void;
  setSelectedCurrency: (c: string) => void;
  selectedWallet: any;
  cpFirstName: string; setCpFirstName: (v: string) => void;
  cpLastName: string; setCpLastName: (v: string) => void;
  cpIsCorporate: boolean; setCpIsCorporate: (v: boolean) => void;
  cpBusinessName: string; setCpBusinessName: (v: string) => void;
  cpAccountNumber: string; setCpAccountNumber: (v: string) => void;
  cpRoutingNumber: string; setCpRoutingNumber: (v: string) => void;
  cpInstitutionName: string; setCpInstitutionName: (v: string) => void;
  cpAccountType: 'CHECKING' | 'SAVINGS'; setCpAccountType: (v: 'CHECKING' | 'SAVINGS') => void;
  cpStreet: string; setCpStreet: (v: string) => void;
  cpCity: string; setCpCity: (v: string) => void;
  cpState: string; setCpState: (v: string) => void;
  cpPostalCode: string; setCpPostalCode: (v: string) => void;
  creatingCounterparty: boolean;
  setCreatingCounterparty: (v: boolean) => void;
  wallets: any[];
  onNavigateToFullForm?: () => void;
}

const PAYMENT_RAILS = [
  { id: 'ACH' as const, label: 'ACH', desc: 'Standard (1-3 business days)', color: 'text-blue-400', bg: 'bg-blue-500/15' },
  { id: 'ACH-ACCELERATED' as const, label: 'ACH Accelerated', desc: 'Same/next day', color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
  { id: 'FEDWIRE' as const, label: 'Fedwire', desc: 'Instant (same day)', color: 'text-orange-400', bg: 'bg-orange-500/15' },
];

export function USPaymentDetails(props: USPaymentDetailsProps) {
  const {
    tc, t,
    usCounterparties, selectedCounterparty, setSelectedCounterparty,
    loadingCounterparties, setLoadingCounterparties,
    showCounterpartyList, setShowCounterpartyList,
    showNewCounterparty, setShowNewCounterparty,
    paymentRail, setPaymentRail,
    setUsCounterparties, setSelectedCurrency, selectedWallet,
    cpFirstName, setCpFirstName, cpLastName, setCpLastName,
    cpIsCorporate, setCpIsCorporate, cpBusinessName, setCpBusinessName,
    cpAccountNumber, setCpAccountNumber, cpRoutingNumber, setCpRoutingNumber,
    cpInstitutionName, setCpInstitutionName, cpAccountType, setCpAccountType,
    cpStreet, setCpStreet, cpCity, setCpCity, cpState, setCpState,
    cpPostalCode, setCpPostalCode,
    creatingCounterparty, setCreatingCounterparty,
    wallets,
    onNavigateToFullForm,
  } = props;

  // Country field for quick form (defaults to US)
  const [cpCountry, setCpCountry] = useState('US');
  const [countryRestricted, setCountryRestricted] = useState(false);

  // Auto-set currency to USD on mount
  useEffect(() => {
    setSelectedCurrency('USD');
    loadCounterparties();
  }, []);

  // Check restriction when country changes
  useEffect(() => {
    if (cpCountry.length === 2) {
      const restricted = isCountryRestricted(cpCountry);
      setCountryRestricted(restricted);
      if (restricted) {
        const reason = getRestrictionReason(cpCountry);
        toast.error(`${cpCountry} is a restricted jurisdiction${reason ? `: ${reason}` : ''}`);
      }
    } else {
      setCountryRestricted(false);
    }
  }, [cpCountry]);

  const loadCounterparties = async () => {
    setLoadingCounterparties(true);
    try {
      const res = await backendAPI.usPayments.getCounterparties();
      if (res.success && res.data?.counterparties) {
        setUsCounterparties(res.data.counterparties);
      }
    } catch (e) {
      console.error('Failed to load US counterparties:', e);
    } finally {
      setLoadingCounterparties(false);
    }
  };

  const handleCreateCounterparty = async () => {
    // Check restricted country before even calling the API
    if (countryRestricted) {
      toast.error(t('send.usRestrictedCountry'));
      return;
    }

    // Find user's USD virtual account ID
    const usdWallet = wallets.find((w: any) => w.currency === 'USD');
    if (!usdWallet?.id) {
      toast.error(t('send.usNoUsdWallet'));
      return;
    }

    setCreatingCounterparty(true);
    try {
      const payload: any = {
        account_id: usdWallet.id,
        is_corporate: cpIsCorporate,
        account_information: {
          account_number: cpAccountNumber,
          routing_number: cpRoutingNumber,
          institution_name: cpInstitutionName,
          type: cpAccountType,
          payment_rails: ['ACH'],
        },
        beneficiary_address: {
          street: cpStreet,
          city: cpCity,
          state: cpState,
          postal_code: cpPostalCode,
          country: cpCountry.toUpperCase() || 'US',
        },
      };

      if (cpIsCorporate) {
        payload.business_name = cpBusinessName;
      } else {
        payload.first_name = cpFirstName;
        payload.last_name = cpLastName;
        payload.account_information.account_name = `${cpFirstName} ${cpLastName}`;
      }

      const res = await backendAPI.usPayments.createCounterparty(payload);

      if (res.success && res.data) {
        toast.success(t('send.usCounterpartyCreated'));
        setSelectedCounterparty(res.data);
        setShowNewCounterparty(false);
        // Refresh list
        await loadCounterparties();
      } else {
        // Check if it was a restricted country error from the backend
        if (res.restricted) {
          toast.error(t('send.usRestrictedCountry'));
        } else {
          toast.error(res.error || t('send.usCounterpartyFailed'));
        }
      }
    } catch (e: any) {
      console.error('Failed to create counterparty:', e);
      toast.error(e.message || t('send.usCounterpartyFailed'));
    } finally {
      setCreatingCounterparty(false);
    }
  };

  const canCreateCounterparty = () => {
    if (countryRestricted) return false;
    const hasAddress = cpStreet.trim().length > 0 && cpCity.trim().length > 0 && cpState.trim().length > 0 && cpPostalCode.trim().length > 0 && cpCountry.trim().length === 2;
    const hasBanking = cpAccountNumber.trim().length > 0 && cpRoutingNumber.trim().length >= 9 && cpInstitutionName.trim().length > 0;
    if (cpIsCorporate) {
      return cpBusinessName.trim().length > 0 && hasBanking && hasAddress;
    }
    return cpFirstName.trim().length > 0 && cpLastName.trim().length > 0 && hasBanking && hasAddress;
  };

  return (
    <div className="space-y-5">
      {/* USD Currency badge */}
      <div className="flex items-center gap-2">
        <span className="text-xl">🇺🇸</span>
        <div>
          <p className={`text-sm font-semibold ${tc.text}`}>USD - US Dollar</p>
          <p className={`text-xs ${tc.textMuted}`}>{t('send.usPaymentsOnly')}</p>
        </div>
      </div>

      {/* Select Counterparty */}
      <div>
        <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.usSelectCounterparty')}</label>
        <button
          onClick={() => setShowCounterpartyList(!showCounterpartyList)}
          className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
        >
          <span className={`text-sm ${selectedCounterparty ? `font-semibold ${tc.text}` : tc.textMuted}`}>
            {selectedCounterparty
              ? `${selectedCounterparty.account_name || selectedCounterparty.business_name || `${selectedCounterparty.first_name} ${selectedCounterparty.last_name}`} - ****${selectedCounterparty.account_number_last4}`
              : t('send.usChooseCounterparty')}
          </span>
          {loadingCounterparties ? (
            <Loader2 size={16} className="text-[#C7FF00] animate-spin" />
          ) : (
            <ChevronDown size={18} className={`${tc.textMuted} transition-transform ${showCounterpartyList ? 'rotate-180' : ''}`} />
          )}
        </button>

        {showCounterpartyList && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-2 ${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden shadow-xl max-h-64 overflow-y-auto`}
          >
            {usCounterparties.length === 0 && !loadingCounterparties ? (
              <p className={`text-sm ${tc.textMuted} text-center py-6`}>{t('send.usNoCounterparties')}</p>
            ) : (
              usCounterparties.map((cp, idx) => (
                <button
                  key={cp.id || idx}
                  onClick={() => {
                    setSelectedCounterparty(cp);
                    setShowCounterpartyList(false);
                  }}
                  className={`w-full text-left px-4 py-3 ${tc.hoverBg} transition-colors border-b ${tc.borderLight} last:border-0 ${
                    selectedCounterparty?.id === cp.id ? 'bg-[#C7FF00]/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {cp.is_corporate ? <Briefcase size={14} className={tc.textMuted} /> : <User size={14} className={tc.textMuted} />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${tc.text} truncate`}>
                        {cp.account_name || cp.business_name || `${cp.first_name} ${cp.last_name}`}
                      </p>
                      <p className={`text-xs ${tc.textMuted}`}>{cp.institution_name} • ****{cp.account_number_last4}</p>
                    </div>
                    {selectedCounterparty?.id === cp.id && <CheckCircle size={16} className="text-[#C7FF00]" />}
                  </div>
                </button>
              ))
            )}

            {/* Add New button */}
            <button
              onClick={() => {
                setShowCounterpartyList(false);
                setShowNewCounterparty(true);
              }}
              className={`w-full flex items-center gap-2 px-4 py-3 text-[#C7FF00] ${tc.hoverBg} transition-colors border-t ${tc.borderLight}`}
            >
              <Plus size={16} />
              <span className="text-sm font-semibold">{t('send.usAddNewCounterparty')}</span>
            </button>
          </motion.div>
        )}
      </div>

      {/* New Counterparty Form — Bottom-Sheet Modal */}
      <AnimatePresence>
      {showNewCounterparty && (
        <div className="fixed inset-0 z-[200] flex flex-col justify-end">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowNewCounterparty(false)}
          />
          {/* Sheet */}
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={`relative w-full max-h-[88vh] overflow-y-auto rounded-t-3xl p-5 space-y-3`}
            style={{ background: '#0B0E11', borderTop: '1px solid rgba(199,255,0,0.15)' }}
          >
          {/* Drag handle */}
          <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-white">{t('send.usNewCounterparty')}</p>
            <div className="flex items-center gap-3">
              {onNavigateToFullForm && (
                <button
                  onClick={onNavigateToFullForm}
                  className="flex items-center gap-1 text-[10px] font-semibold text-[#C7FF00] hover:underline"
                >
                  <ExternalLink size={10} />
                  {t('send.usFullForm')}
                </button>
              )}
              <button
                onClick={() => setShowNewCounterparty(false)}
                className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center"
              >
                <span className="text-white text-xs">✕</span>
              </button>
            </div>
          </div>

          {/* Personal / Corporate toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setCpIsCorporate(false)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                !cpIsCorporate ? 'bg-[#C7FF00] text-black' : `${tc.card} border ${tc.borderLight} ${tc.text}`
              }`}
            >
              {t('send.usPersonal')}
            </button>
            <button
              onClick={() => setCpIsCorporate(true)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                cpIsCorporate ? 'bg-[#C7FF00] text-black' : `${tc.card} border ${tc.borderLight} ${tc.text}`
              }`}
            >
              {t('send.usCorporate')}
            </button>
          </div>

          {/* Name fields */}
          {cpIsCorporate ? (
            <input
              type="text"
              value={cpBusinessName}
              onChange={e => setCpBusinessName(e.target.value)}
              placeholder={t('send.usBusinessName')}
              className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
            />
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={cpFirstName}
                onChange={e => setCpFirstName(e.target.value)}
                placeholder={t('send.usFirstName')}
                className={`flex-1 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
              />
              <input
                type="text"
                value={cpLastName}
                onChange={e => setCpLastName(e.target.value)}
                placeholder={t('send.usLastName')}
                className={`flex-1 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
              />
            </div>
          )}

          {/* Bank info */}
          <input
            type="text"
            value={cpInstitutionName}
            onChange={e => setCpInstitutionName(e.target.value)}
            placeholder={t('send.usInstitutionName')}
            className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
          />
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={cpAccountNumber}
              onChange={e => setCpAccountNumber(e.target.value.replace(/\D/g, ''))}
              placeholder={t('send.accountNumber')}
              className={`flex-1 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
            />
            <input
              type="text"
              inputMode="numeric"
              value={cpRoutingNumber}
              onChange={e => setCpRoutingNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder={t('send.usRoutingNumber')}
              className={`flex-1 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
            />
          </div>

          {/* Account Type */}
          <div className="flex gap-2">
            {(['CHECKING', 'SAVINGS'] as const).map(type => (
              <button
                key={type}
                onClick={() => setCpAccountType(type)}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                  cpAccountType === type ? 'bg-[#C7FF00]/20 text-[#C7FF00] border border-[#C7FF00]/30' : `${tc.card} border ${tc.borderLight} ${tc.text}`
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Address */}
          <p className={`text-xs font-medium ${tc.textSecondary} mt-2`}>{t('send.usBeneficiaryAddress')}</p>
          <input
            type="text"
            value={cpStreet}
            onChange={e => setCpStreet(e.target.value)}
            placeholder={t('send.usStreet')}
            className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={cpCity}
              onChange={e => setCpCity(e.target.value)}
              placeholder={t('send.usCity')}
              className={`flex-1 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
            />
            <input
              type="text"
              value={cpState}
              onChange={e => setCpState(e.target.value.toUpperCase().slice(0, 2))}
              placeholder={t('send.usState')}
              className={`w-16 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text} text-center`}
            />
            <input
              type="text"
              inputMode="numeric"
              value={cpPostalCode}
              onChange={e => setCpPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder={t('send.usZip')}
              className={`w-20 ${tc.inputBg} border ${tc.borderLight} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text} text-center`}
            />
          </div>

          {/* Country field */}
          <div>
            <div className="flex items-center gap-2">
              <Globe size={12} className={tc.textMuted} />
              <label className={`text-xs font-medium ${tc.textSecondary}`}>{t('send.usCountry')}</label>
            </div>
            <input
              type="text"
              value={cpCountry}
              onChange={e => setCpCountry(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="US"
              maxLength={2}
              className={`w-full mt-1 ${tc.inputBg} border ${
                countryRestricted ? 'border-red-500/50 ring-1 ring-red-500/20' : tc.borderLight
              } rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
            />
          </div>

          {/* Restricted country warning */}
          {countryRestricted && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl"
            >
              <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-red-400 font-semibold">{t('send.usRestrictedCountry')}</p>
                <p className="text-[10px] text-red-400/70 mt-0.5">{t('send.usRestrictedCountryDesc')}</p>
              </div>
            </motion.div>
          )}

          {/* Create button */}
          <button
            onClick={handleCreateCounterparty}
            disabled={!canCreateCounterparty() || creatingCounterparty}
            className="w-full bg-[#C7FF00] text-black py-3 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creatingCounterparty ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('send.usCreating')}
              </>
            ) : (
              t('send.usRegisterCounterparty')
            )}
          </button>

          <button
            onClick={() => setShowNewCounterparty(false)}
            className="w-full text-center text-xs text-gray-500 py-1 pb-safe"
          >
            {t('common.cancel')}
          </button>
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      {/* Payment Rail Selection */}
      <div>
        <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.usSelectPaymentRail')}</label>
        <div className="space-y-2">
          {PAYMENT_RAILS.map(rail => (
            <button
              key={rail.id}
              onClick={() => setPaymentRail(rail.id)}
              className={`w-full ${tc.card} border rounded-2xl px-4 py-3 flex items-center gap-3 transition-all active:scale-[0.98] ${
                paymentRail === rail.id ? 'border-[#C7FF00]/50 bg-[#C7FF00]/5' : `${tc.cardBorder} ${tc.hoverBg}`
              }`}
            >
              <div className={`w-9 h-9 rounded-full ${rail.bg} flex items-center justify-center flex-shrink-0`}>
                {rail.id === 'FEDWIRE' ? <Zap size={16} className={rail.color} /> :
                 rail.id === 'ACH-ACCELERATED' ? <Shield size={16} className={rail.color} /> :
                 <Building2 size={16} className={rail.color} />}
              </div>
              <div className="flex-1 text-left">
                <p className={`text-sm font-semibold ${tc.text}`}>{rail.label}</p>
                <p className={`text-[11px] ${tc.textMuted}`}>{rail.desc}</p>
              </div>
              {paymentRail === rail.id && <CheckCircle size={18} className="text-[#C7FF00]" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}