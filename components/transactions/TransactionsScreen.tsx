/**
 * BorderPay Africa - Transactions Screen
 * Complete transaction history with filters, export, and search
 * i18n + theme-aware
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Filter, Download, Search, ArrowUpRight, ArrowDownLeft, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorState } from '../common/ErrorState';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface TransactionsScreenProps {
  userId: string;
  customerId?: string;
  onBack: () => void;
}

interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
  recipient?: string;
  sender?: string;
}

export function TransactionsScreen({ userId, customerId, onBack }: TransactionsScreenProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const { t, language } = useThemeLanguage();
  const tc = useThemeClasses();

  useEffect(() => {
    loadTransactions();
  }, [filterType]);

  const loadTransactions = async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const filters = filterType !== 'all' ? { type: filterType } : {};
      // Try standalone edge function first (get-customer-transactions)
      let result = await backendAPI.transactions.getCustomerTransactions(
        customerId || userId,
        filters
      );

      // Fallback to Hono route if standalone edge function is unavailable
      if (!result.success) {
        console.warn('Standalone get-customer-transactions failed, falling back to Hono route');
        result = await backendAPI.transactions.getTransactions(100, 0);
      }

      if (result.success && result.data) {
        const txns = result.data.transactions || result.data;
        setTransactions(Array.isArray(txns) ? txns : []);
      } else {
        console.error('Failed to load transactions:', result.error);
        setLoadError(true);
      }
    } catch (error) {
      console.error('Failed to load transactions:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'csv' | 'pdf' | 'excel') => {
    setExporting(true);
    try {
      const result = await backendAPI.transactions.exportTransactions(userId, format);
      if (result.success && result.data) {
        const url = result.data.download_url || result.data.url;
        if (url) {
          window.open(url, '_blank');
          toast.success(`${t('transactions.export')} ${format.toUpperCase()}`);
        }
      } else {
        toast.error(result.error || t('transactions.export'));
      }
    } catch (error) {
      console.error('Export error:', error);
      toast.error(t('send.txFailed'));
    } finally {
      setExporting(false);
      setShowFilters(false);
    }
  };

  const filteredTransactions = transactions.filter(txn =>
    txn.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    txn.recipient?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    txn.sender?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Locale mapping for date formatting
  const localeMap: Record<string, string> = {
    en: 'en-US', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', sw: 'sw-KE',
  };
  const dateLocale = localeMap[language] || 'en-US';

  const groupedTransactions = filteredTransactions.reduce((groups, txn) => {
    const date = new Date(txn.created_at).toLocaleDateString(dateLocale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(txn);
    return groups;
  }, {} as Record<string, Transaction[]>);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return t('transactions.completed');
      case 'pending': return t('transactions.pending');
      case 'failed': return t('transactions.failed');
      default: return status;
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`bp-text-h3 font-bold ${tc.text}`}>{t('transactions.title')}</h1>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <Filter size={20} className={tc.text} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 pb-4">
          <div className="relative">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${tc.textSecondary}`} size={20} />
            <input
              type="text"
              placeholder={t('transactions.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full ${tc.inputBg} rounded-2xl pl-12 pr-4 py-3 placeholder:${tc.textSecondary} focus:outline-none focus:border-[#C7FF00]/50`}
            />
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-6 pb-4 space-y-3"
          >
            {/* Filter Type */}
            <div>
              <p className={`bp-text-small ${tc.textSecondary} mb-2`}>{t('transactions.txType')}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-4 py-2 rounded-full bp-text-small font-semibold transition-all ${
                    filterType === 'all'
                      ? 'bg-[#C7FF00] text-black'
                      : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                  }`}
                >
                  {t('transactions.all')}
                </button>
                <button
                  onClick={() => setFilterType('credit')}
                  className={`px-4 py-2 rounded-full bp-text-small font-semibold transition-all ${
                    filterType === 'credit'
                      ? 'bg-[#C7FF00] text-black'
                      : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                  }`}
                >
                  {t('transactions.received')}
                </button>
                <button
                  onClick={() => setFilterType('debit')}
                  className={`px-4 py-2 rounded-full bp-text-small font-semibold transition-all ${
                    filterType === 'debit'
                      ? 'bg-[#C7FF00] text-black'
                      : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                  }`}
                >
                  {t('transactions.sent')}
                </button>
              </div>
            </div>

            {/* Export Options */}
            <div>
              <p className={`bp-text-small ${tc.textSecondary} mb-2`}>{t('transactions.export')}</p>
              <div className="flex gap-2">
                {(['csv', 'pdf', 'excel'] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => handleExport(format)}
                    disabled={exporting}
                    className={`px-4 py-2 rounded-full ${tc.card} ${tc.textSecondary} ${tc.hoverBg} bp-text-small font-semibold flex items-center gap-2 disabled:opacity-50`}
                  >
                    <Download size={16} />
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        {loading && transactions.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : loadError ? (
          <ErrorState
            variant="server"
            title={t('transactions.title')}
            message="Could not load your transactions. Please try again."
            onRetry={loadTransactions}
            compact
          />
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-12">
            <Calendar size={48} className={`${tc.textMuted} mx-auto mb-4`} />
            <p className={`bp-text-body ${tc.textSecondary}`}>{t('transactions.noTransactions')}</p>
            <p className={`bp-text-small ${tc.textMuted}`}>{t('transactions.historyHere')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTransactions).map(([date, txns]) => (
              <div key={date}>
                <h3 className={`bp-text-small ${tc.textSecondary} mb-3`}>{date}</h3>
                <div className="space-y-2">
                  {txns.map((txn) => (
                    <div
                      key={txn.id}
                      className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${tc.hoverBg} transition-colors cursor-pointer`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          txn.type === 'credit'
                            ? 'bg-green-500/20'
                            : 'bg-red-500/20'
                        }`}>
                          {txn.type === 'credit' ? (
                            <ArrowDownLeft size={20} className="text-green-500" />
                          ) : (
                            <ArrowUpRight size={20} className="text-red-500" />
                          )}
                        </div>

                        <div className="flex-1">
                          <p className={`bp-text-body font-semibold ${tc.text}`}>{txn.description}</p>
                          <p className={`bp-text-small ${tc.textSecondary}`}>
                            {new Date(txn.created_at).toLocaleTimeString(dateLocale, {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className={`bp-text-body font-bold ${
                            txn.type === 'credit' ? 'text-green-500' : 'text-red-500'
                          }`}>
                            {txn.type === 'credit' ? '+' : '-'}${txn.amount.toFixed(2)}
                          </p>
                          <p className={`bp-text-small ${
                            txn.status === 'completed' ? 'text-green-400' :
                            txn.status === 'pending' ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {getStatusLabel(txn.status)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}