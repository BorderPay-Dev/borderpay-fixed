/**
 * BorderPay Africa - Currency Converter Component
 * Wise-style conversion UI for Dashboard
 * Fetches live rates from FX Quote API via backend
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { ArrowDownUp, Info, TrendingUp, Zap, Loader2 } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface CurrencyConverterProps {
  userId: string;
  onConvert?: () => void;
  standalone?: boolean;
  onBack?: () => void;
}

interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

// Supported FX currencies
const FX_CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', flag: '🇬🇭' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', flag: '🇹🇿' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', flag: '🇺🇬' },
  { code: 'XAF', name: 'Central African CFA', symbol: 'FCFA', flag: '🇨🇲' },
  { code: 'XOF', name: 'West African CFA', symbol: 'FCFA', flag: '🌍' },
];

// Stablecoins (1:1 with USD, no FX quote needed)
const STABLECOIN_CURRENCIES: Currency[] = [
  { code: 'USDT', name: 'Tether', symbol: '₮', flag: '₮' },
  { code: 'USDC', name: 'USD Coin', symbol: '$', flag: '💵' },
  { code: 'PYUSD', name: 'PayPal USD', symbol: '$', flag: '💳' },
];

const ALL_CURRENCIES = [...FX_CURRENCIES, ...STABLECOIN_CURRENCIES];

export function CurrencyConverter({ userId, onConvert, standalone, onBack }: CurrencyConverterProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [fromCurrency, setFromCurrency] = useState<Currency>(ALL_CURRENCIES[0]);
  const [toCurrency, setToCurrency] = useState<Currency>(ALL_CURRENCIES[1]);
  const [fromAmount, setFromAmount] = useState('100');
  const [toAmount, setToAmount] = useState('0');
  const [exchangeRate, setExchangeRate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [rateSource, setRateSource] = useState<'live' | 'mock' | 'identity' | ''>('');
  const [fee, setFee] = useState(0);

  // Debounced rate fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchExchangeRate();
    }, 500);
    return () => clearTimeout(timer);
  }, [fromCurrency, toCurrency, fromAmount]);

  useEffect(() => {
    if (fromAmount && exchangeRate > 0) {
      const converted = parseFloat(fromAmount) * exchangeRate;
      setToAmount(converted.toFixed(2));
    }
  }, [fromAmount, exchangeRate]);

  const fetchExchangeRate = async () => {
    if (fromCurrency.code === toCurrency.code) {
      setExchangeRate(1);
      setRateSource('identity');
      setFee(0);
      return;
    }

    const amount = parseFloat(fromAmount) || 100;
    setLoading(true);

    try {
      // Use the single FX Edge Function via backendAPI.fx.getQuote
      const result = await backendAPI.fx.getQuote(fromCurrency.code, toCurrency.code, amount);

      if (result.success && result.data) {
        const data = result.data;
        setExchangeRate(data.rate || 0);
        setRateSource(data.source === 'maplerad' ? 'live' : (data.source || 'live'));
        setFee(data.fee || 0);

        // Use converted_amount if available, otherwise calculate from rate
        if (data.converted_amount) {
          setToAmount(Number(data.converted_amount).toFixed(2));
        }
      } else {
        setExchangeRate(0);
        setRateSource('');
      }
    } catch (error) {
      setExchangeRate(0);
      setRateSource('');
    } finally {
      setLoading(false);
    }
  };

  const swapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
    setFromAmount(toAmount);
  };

  const handleConvert = () => {
    if (onConvert) {
      onConvert();
    }
  };

  const renderContent = () => (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#C7FF00]" />
          <h3 className={`text-base font-semibold ${tc.text}`}>{t('converter.title') || 'Currency Converter'}</h3>
        </div>
        {rateSource === 'live' && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded-full">
            <Zap className="w-3 h-3 text-green-400" />
            <span className="text-[10px] font-semibold text-green-400">LIVE</span>
          </div>
        )}
        {rateSource === 'mock' && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
            <span className="text-[10px] font-semibold text-yellow-400">INDICATIVE</span>
          </div>
        )}
      </div>

      {/* From Currency */}
      <div className="mb-3">
        <label className={`text-xs ${tc.textMuted} mb-2 block`}>{t('exchange.youSend') || 'You send'}</label>
        <div className={`relative ${tc.isLight ? 'bg-gray-50' : 'bg-[#0B0E11]'} rounded-xl p-4 border ${tc.border}`}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setShowFromDropdown(!showFromDropdown); setShowToDropdown(false); }}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 ${tc.isLight ? 'bg-gray-200/50 hover:bg-gray-200' : 'bg-gray-800/50 hover:bg-gray-700/50'} rounded-lg transition-colors`}
            >
              <span className="text-xl">{fromCurrency.flag}</span>
              <span className={`text-sm font-semibold ${tc.text}`}>{fromCurrency.code}</span>
            </button>
            <input
              type="number"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              className={`flex-1 min-w-0 bg-transparent text-lg font-semibold ${tc.text} outline-none text-right`}
              placeholder="0.00"
            />
          </div>

          {showFromDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`absolute top-full left-0 right-0 mt-2 ${tc.isLight ? 'bg-white' : 'bg-[#1A1D24]'} border ${tc.border} rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto`}
            >
              {ALL_CURRENCIES.map((curr) => (
                <button
                  key={curr.code}
                  onClick={() => {
                    setFromCurrency(curr);
                    setShowFromDropdown(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 ${tc.hoverBg} transition-colors text-left ${
                    fromCurrency.code === curr.code ? 'bg-[#C7FF00]/10' : ''
                  }`}
                >
                  <span className="text-xl">{curr.flag}</span>
                  <div>
                    <div className={`text-sm font-semibold ${tc.text}`}>{curr.code}</div>
                    <div className={`text-xs ${tc.textMuted}`}>{curr.name}</div>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Swap Button */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          onClick={swapCurrencies}
          className="p-2 bg-[#C7FF00] rounded-full hover:bg-[#B8F000] transition-all transform hover:rotate-180 duration-300"
        >
          <ArrowDownUp className="w-4 h-4 text-black" />
        </button>
      </div>

      {/* To Currency */}
      <div className="mb-4">
        <label className={`text-xs ${tc.textMuted} mb-2 block`}>{t('exchange.youReceive') || 'You receive'}</label>
        <div className={`relative ${tc.isLight ? 'bg-gray-50' : 'bg-[#0B0E11]'} rounded-xl p-4 border ${tc.border}`}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setShowToDropdown(!showToDropdown); setShowFromDropdown(false); }}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 ${tc.isLight ? 'bg-gray-200/50 hover:bg-gray-200' : 'bg-gray-800/50 hover:bg-gray-700/50'} rounded-lg transition-colors`}
            >
              <span className="text-xl">{toCurrency.flag}</span>
              <span className={`text-sm font-semibold ${tc.text}`}>{toCurrency.code}</span>
            </button>
            <div className={`flex-1 min-w-0 text-lg font-semibold ${tc.text} text-right`}>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#C7FF00] ml-auto" />
              ) : toAmount}
            </div>
          </div>

          {showToDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`absolute top-full left-0 right-0 mt-2 ${tc.isLight ? 'bg-white' : 'bg-[#1A1D24]'} border ${tc.border} rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto`}
            >
              {ALL_CURRENCIES.map((curr) => (
                <button
                  key={curr.code}
                  onClick={() => {
                    setToCurrency(curr);
                    setShowToDropdown(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 ${tc.hoverBg} transition-colors text-left ${
                    toCurrency.code === curr.code ? 'bg-[#C7FF00]/10' : ''
                  }`}
                >
                  <span className="text-xl">{curr.flag}</span>
                  <div>
                    <div className={`text-sm font-semibold ${tc.text}`}>{curr.code}</div>
                    <div className={`text-xs ${tc.textMuted}`}>{curr.name}</div>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Exchange Rate Info */}
      {exchangeRate > 0 && (
        <div className={`${tc.isLight ? 'bg-gray-50' : 'bg-[#0B0E11]'} rounded-lg p-3 mb-4`}>
          <div className="flex items-center justify-between text-xs">
            <span className={tc.textMuted}>{t('exchange.exchangeRate') || 'Exchange rate'}</span>
            <span className={`${tc.text} font-semibold`}>
              1 {fromCurrency.code} = {exchangeRate < 0.01 ? exchangeRate.toFixed(6) : exchangeRate.toFixed(4)} {toCurrency.code}
            </span>
          </div>
          {fee > 0 && (
            <div className="flex items-center justify-between text-xs mt-1">
              <span className={tc.textMuted}>{t('exchange.fee') || 'Fee'}</span>
              <span className={`${tc.text} font-semibold`}>
                {fromCurrency.symbol}{fee.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Convert Button */}
      <button
        onClick={handleConvert}
        disabled={!fromAmount || parseFloat(fromAmount) <= 0}
        className="w-full py-3 bg-[#C7FF00] text-black font-semibold rounded-xl hover:bg-[#B8F000] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {t('converter.convert') || 'Convert Currency'}
      </button>
    </>
  );

  // Standalone mode - full screen with back button
  if (standalone) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text}`}>
        <div className={`sticky top-0 z-20 pt-safe ${tc.bg} border-b ${tc.border}`}>
          <div className="flex items-center justify-between p-4">
            <button onClick={onBack} className={`p-2 ${tc.hoverBg} rounded-lg transition-colors`}>
              <span className="text-lg">←</span>
            </button>
            <h1 className="text-base font-bold">{t('converter.title') || 'Currency Converter'}</h1>
            <div className="w-9" />
          </div>
        </div>
        <div className="p-4">
          <div className={`${tc.card} rounded-2xl p-5 border ${tc.border}`}>
            {renderContent()}
          </div>
        </div>
      </div>
    );
  }

  // Widget mode - dashboard card
  return (
    <div className={`${tc.isLight ? 'bg-white' : 'bg-[#1A1D24]'} rounded-2xl p-5 border ${tc.border}`}>
      {renderContent()}
    </div>
  );
}