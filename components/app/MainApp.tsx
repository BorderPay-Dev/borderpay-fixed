/**
 * BorderPay Africa - Main App Container
 * Handles navigation between all app screens after authentication
 */

import React, { useState, useRef, useCallback } from 'react';
import { Dashboard } from './Dashboard';
import { CardsScreen } from '../cards/CardsScreen';
import { TwoFactorSetup } from '../security/TwoFactorSetup';
import { PINSetup } from '../security/PINSetup';
import { KYCVerification } from '../kyc/KYCVerification';
import { SendMoneyFlow } from '../send/SendMoneyFlow';
import { TransactionsScreen } from '../transactions/TransactionsScreen';
import { AddMoneyScreen } from '../deposit/AddMoneyScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { WalletScreen } from '../wallet/WalletScreen';
import { useVerification } from '../../utils/verification/useVerification';
import { ProfileScreen } from '../profile/ProfileScreen';
import { ChangePIN } from '../settings/ChangePIN';
import { ChangePassword } from '../settings/ChangePassword';
import { PaymentMethods } from '../settings/PaymentMethods';
import { TermsOfServiceScreen } from '../legal/TermsOfServiceScreen';
import { PrivacyPolicyScreen } from '../legal/PrivacyPolicyScreen';
import { PreferencesScreen } from '../app/PreferencesScreen';
import { CardRestrictionsScreen } from '../compliance/CardRestrictionsScreen';
import { ReceiveMoneyScreen } from '../receive/ReceiveMoneyScreen';
import { ExchangeScreen } from '../exchange/ExchangeScreen';
import { CurrencyConverter } from '../conversion/CurrencyConverter';
import { USDAccountScreen } from '../accounts/USDAccountScreen';
import { MomoCollectionScreen } from '../momo/MomoCollectionScreen';
import { CreateCounterpartyScreen } from '../counterparty/CreateCounterpartyScreen';
import { StablecoinDepositScreen } from '../wallets/StablecoinDepositScreen';
import { StablecoinConfirmScreen } from '../wallets/StablecoinConfirmScreen';
import { ReferralScreen } from '../referral/ReferralScreen';
import { BiometricSetup } from '../security/BiometricSetup';
import { HelpCenterScreen } from '../settings/HelpCenterScreen';
import { ProofOfAddressScreen } from '../settings/ProofOfAddressScreen';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldAlert, X } from 'lucide-react';

interface MainAppProps {
  userId: string;
  onLogout: () => void;
  newDeviceDetected?: boolean;
  onDismissNewDevice?: () => void;
  onTrustDevice?: () => void;
}

export type AppScreen = 
  | 'dashboard'
  | 'home'
  | 'cards'
  | 'send-money'
  | 'receive-money'
  | 'exchange'
  | 'converter'
  | 'deposit'
  | 'add-money'
  | 'transactions'
  | 'wallet-detail'
  | 'two-factor-setup'
  | 'pin-setup'
  | 'change-pin'
  | 'change-password'
  | 'payment-methods'
  | 'card-restrictions'
  | 'kyc'
  | 'settings'
  | 'profile'
  | 'terms-of-service'
  | 'privacy-policy'
  | 'preferences'
  | 'usd-account'
  | 'momo-collect'
  | 'create-counterparty'
  | 'stablecoin-deposit'
  | 'stablecoin-confirm'
  | 'referral'
  | 'biometric-setup'
  | 'help-center'
  | 'proof-of-address';

export function MainApp({ userId, onLogout, newDeviceDetected, onDismissNewDevice, onTrustDevice }: MainAppProps) {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('dashboard');
  const [navigationStack, setNavigationStack] = useState<AppScreen[]>(['dashboard']);
  const verificationStatus = useVerification(userId);
  const [refreshKey, setRefreshKey] = useState(0);
  const tc = useThemeClasses();
  const tl = useThemeLanguage();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [stablecoinConfirmData, setStablecoinConfirmData] = useState<{
    txType: 'deposit' | 'send' | 'receive' | 'swap';
    currency: 'USDC' | 'USDT' | 'PYUSD';
    amount?: number;
    network?: string;
    address?: string;
    txHash?: string;
  } | null>(null);

  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, []);

  const navigateTo = (screen: AppScreen | string) => {
    const target = screen as AppScreen;
    const isAlreadyHere =
      currentScreen === target ||
      (target === 'home' && currentScreen === 'dashboard') ||
      (target === 'dashboard' && currentScreen === 'home');

    if (isAlreadyHere) return;

    setCurrentScreen(target);
    setNavigationStack(prev => [...prev, target]);
    scrollToTop();
  };

  React.useEffect(() => {
    (window as any).__borderpay_navigate = navigateTo;
    return () => { delete (window as any).__borderpay_navigate; };
  });

  const navigateBack = () => {
    if (navigationStack.length > 1) {
      const newStack = [...navigationStack];
      newStack.pop();
      const previousScreen = newStack[newStack.length - 1];
      setCurrentScreen(previousScreen);
      setNavigationStack(newStack);
      scrollToTop();
    }
  };

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'cards':
        return <CardsScreen onBack={navigateBack} />;

      case 'send-money':
        return (
          <SendMoneyFlow
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
            onNavigate={navigateTo}
          />
        );

      case 'receive-money':
        return <ReceiveMoneyScreen onBack={navigateBack} />;

      case 'exchange':
        return <ExchangeScreen onBack={navigateBack} />;

      case 'converter':
        return (
          <CurrencyConverter
            userId={userId}
            standalone={true}
            onBack={navigateBack}
            onConvert={() => navigateTo('exchange')}
          />
        );

      case 'deposit':
      case 'add-money':
        return <AddMoneyScreen userId={userId} onBack={navigateBack} />;

      case 'two-factor-setup':
        return (
          <TwoFactorSetup
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'pin-setup':
        return (
          <PINSetup
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'biometric-setup':
        return (
          <BiometricSetup
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'kyc':
        return (
          <KYCVerification
            userId={userId}
            userEmail=""
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'transactions':
        return <TransactionsScreen userId={userId} onBack={navigateBack} />;

      case 'wallet-detail':
        return (
          <WalletScreen
            userId={userId}
            onBack={navigateBack}
            isVerified={verificationStatus.isVerified}
            onNavigate={navigateTo}
          />
        );

      

      

      case 'settings':
        return (
          <SettingsScreen
            userId={userId}
            onBack={navigateBack}
            onLogout={onLogout}
            onNavigate={navigateTo}
          />
        );

      

      

      case 'profile':
        return <ProfileScreen userId={userId} onBack={navigateBack} />;

      case 'change-pin':
        return <ChangePIN userId={userId} onBack={navigateBack} />;

      case 'change-password':
        return <ChangePassword onBack={navigateBack} />;

      case 'payment-methods':
        return <PaymentMethods onBack={navigateBack} />;

      case 'card-restrictions':
        return <CardRestrictionsScreen onBack={navigateBack} />;

      case 'terms-of-service':
        return <TermsOfServiceScreen onBack={navigateBack} />;

      case 'privacy-policy':
        return <PrivacyPolicyScreen onBack={navigateBack} />;

      case 'preferences':
        return <PreferencesScreen onBack={navigateBack} />;

      case 'usd-account':
        return (
          <USDAccountScreen
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'momo-collect':
        return (
          <MomoCollectionScreen
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'create-counterparty':
        return (
          <CreateCounterpartyScreen
            userId={userId}
            onBack={navigateBack}
            onSuccess={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'stablecoin-deposit':
        return (
          <StablecoinDepositScreen
            onBack={navigateBack}
            onConfirm={(data) => {
              setStablecoinConfirmData(data);
              navigateTo('stablecoin-confirm');
            }}
          />
        );

      case 'stablecoin-confirm':
        return stablecoinConfirmData ? (
          <StablecoinConfirmScreen
            onBack={navigateBack}
            onDone={() => {
              setStablecoinConfirmData(null);
              navigateTo('dashboard');
              handleRefresh();
            }}
            txType={stablecoinConfirmData.txType}
            currency={stablecoinConfirmData.currency}
            amount={stablecoinConfirmData.amount}
            network={stablecoinConfirmData.network}
            address={stablecoinConfirmData.address}
            txHash={stablecoinConfirmData.txHash}
          />
        ) : null;

      case 'help-center':
        return <HelpCenterScreen onBack={navigateBack} onNavigate={navigateTo} />;

      case 'proof-of-address':
        return <ProofOfAddressScreen onBack={navigateBack} />;

      case 'referral':
        return <ReferralScreen onBack={navigateBack} />;

      case 'dashboard':
      case 'home':
      default:
        return <Dashboard userId={userId} onLogout={onLogout} onNavigate={navigateTo} currentScreen={currentScreen} />;
    }
  };

  return (
    <div className={`min-h-[100dvh] max-h-[100dvh] overflow-hidden fixed inset-0 ${tc.bg}`}>
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      
      <div ref={scrollContainerRef} className="h-full overflow-y-auto overflow-x-hidden relative z-[2]" style={{ WebkitOverflowScrolling: 'auto', overscrollBehavior: 'none' }}>
        {renderScreen()}
      </div>

      {/* New Device / IP Security Alert */}
      <AnimatePresence>
        {newDeviceDetected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6"
          >
            <div className="w-full max-w-[calc(100vw-48px)] sm:max-w-sm bg-[#0B0E11]/80 backdrop-blur-2xl border border-white/[0.08] rounded-2xl overflow-hidden">
              <div className="h-1 bg-red-500" />
              <div className="p-6">
                <div className="flex flex-col items-center mb-5">
                  <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                    <ShieldAlert className="w-8 h-8 text-red-400" />
                  </div>
                  <h2 className="text-lg font-bold text-white mb-1">New Device Detected</h2>
                  <p className="text-sm text-gray-400 text-center">
                    This account is being accessed from a new device or IP address. If this wasn't you, change your password immediately.
                  </p>
                </div>
                <div className="space-y-3">
                  <button
                    onClick={() => onTrustDevice?.()}
                    className="w-full h-12 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    This Was Me
                  </button>
                  <button
                    onClick={() => { onDismissNewDevice?.(); navigateTo('change-password'); }}
                    className="w-full h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    Secure My Account
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}