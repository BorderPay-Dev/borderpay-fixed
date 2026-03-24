/**
 * BorderPay Africa - Card Restrictions Screen
 * Shows countries where virtual cards cannot be used
 * Mobile-optimized with search and categorization
 */

import React, { useState } from 'react';
import { ArrowLeft, CreditCard, AlertTriangle, Search, X, Shield, Globe, DollarSign } from 'lucide-react';
import { 
  CARD_RESTRICTED_COUNTRIES, 
  getCardRestrictedByCategory,
  getCardRestrictionStats,
  type CardRestrictedCountry 
} from '../../utils/compliance/cardRestrictedCountries';

interface CardRestrictionsScreenProps {
  onBack: () => void;
}

export function CardRestrictionsScreen({ onBack }: CardRestrictionsScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'geographic_sanctions' | 'card_network_restriction' | 'financial_sanctions'>('all');

  const stats = getCardRestrictionStats();

  // Filter countries based on search and category
  const filteredCountries = CARD_RESTRICTED_COUNTRIES.filter(country => {
    const matchesSearch = country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         country.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || country.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [
    { 
      id: 'all' as const, 
      label: 'All Countries', 
      count: stats.total,
      icon: Globe,
      color: 'white'
    },
    { 
      id: 'geographic_sanctions' as const, 
      label: 'Geographic Sanctions', 
      count: stats.geographic_sanctions,
      icon: AlertTriangle,
      color: 'red'
    },
    { 
      id: 'card_network_restriction' as const, 
      label: 'Card Network', 
      count: stats.card_network_restriction,
      icon: CreditCard,
      color: 'orange'
    },
    { 
      id: 'financial_sanctions' as const, 
      label: 'Financial Sanctions', 
      count: stats.financial_sanctions,
      icon: DollarSign,
      color: 'yellow'
    },
  ];

  const getCategoryColor = (category: CardRestrictedCountry['category']) => {
    switch (category) {
      case 'geographic_sanctions':
        return 'bg-red-500/20 border-red-500/30 text-red-400';
      case 'card_network_restriction':
        return 'bg-orange-500/20 border-orange-500/30 text-orange-400';
      case 'financial_sanctions':
        return 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400';
    }
  };

  const getCategoryLabel = (category: CardRestrictedCountry['category']) => {
    switch (category) {
      case 'geographic_sanctions':
        return 'Geographic';
      case 'card_network_restriction':
        return 'Card Network';
      case 'financial_sanctions':
        return 'Financial';
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col pb-safe">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-6 pt-safe border-b border-white/10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-white/70 hover:text-white transition-colors mb-4 min-h-[44px]"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            Card Restrictions
          </h1>
        </div>
        <p className="text-sm text-gray-400">
          Countries where virtual cards cannot be used
        </p>
      </div>

      {/* Alert Banner */}
      <div className="flex-shrink-0 px-6 py-4 bg-red-500/10 border-b border-red-500/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm font-semibold mb-1">
              Important: Card Usage Restrictions
            </p>
            <p className="text-white/70 text-xs leading-relaxed">
              Virtual cards cannot be used for transactions in the countries listed below due to international sanctions, 
              card network policies, or compliance regulations. Attempting to use cards in these regions will result in 
              automatic transaction decline.
            </p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/10">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search countries..."
            className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-2xl text-white text-sm focus:outline-none focus:border-[#C7FF00] transition-all placeholder:text-gray-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filters */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/10 overflow-x-auto">
        <div className="flex gap-2">
          {categories.map((category) => {
            const Icon = category.icon;
            const isSelected = selectedCategory === category.id;
            
            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-xl border transition-all whitespace-nowrap
                  ${isSelected 
                    ? 'bg-[#C7FF00] border-[#C7FF00] text-black' 
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{category.label}</span>
                <span className={`
                  text-xs font-bold px-2 py-0.5 rounded-lg
                  ${isSelected ? 'bg-black/20' : 'bg-white/10'}
                `}>
                  {category.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Countries List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredCountries.length > 0 ? (
          <div className="space-y-3 pb-8">
            {filteredCountries.map((country, index) => (
              <div
                key={country.code}
                className="bg-white/5 border border-white/10 rounded-2xl p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1">
                    <h3 className="text-white font-semibold text-sm mb-1">
                      {country.name}
                    </h3>
                    <p className="text-gray-400 text-xs">
                      Country Code: {country.code}
                    </p>
                  </div>
                  <div className={`
                    px-3 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap
                    ${getCategoryColor(country.category)}
                  `}>
                    {getCategoryLabel(country.category)}
                  </div>
                </div>
                
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <p className="text-white/70 text-xs leading-relaxed">
                      <strong className="text-white">Reason:</strong> {country.reason}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-gray-600" />
            </div>
            <p className="text-white/70 text-sm text-center mb-1">
              No countries found
            </p>
            <p className="text-gray-500 text-xs text-center">
              Try adjusting your search or filter
            </p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-white/10 bg-gradient-to-t from-black to-transparent">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">Total</p>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">Geographic</p>
            <p className="text-2xl font-bold text-red-400">{stats.geographic_sanctions}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">Network</p>
            <p className="text-2xl font-bold text-orange-400">{stats.card_network_restriction}</p>
          </div>
        </div>
        
        <div className="mt-4 bg-gradient-to-r from-[#C7FF00]/10 to-transparent border border-[#C7FF00]/20 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-white/70 leading-relaxed">
              <strong className="text-[#C7FF00]">Compliance Notice:</strong> These restrictions are enforced by 
              Visa, Mastercard, and international regulatory bodies (OFAC, UN, EU). BorderPay Africa complies 
              with all sanctions and card network policies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}