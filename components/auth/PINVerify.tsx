/**
 * BorderPay Africa - Transaction PIN Verification
 * Verify PIN before transaction execution
 */

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Lock, AlertCircle, Loader2, X } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';

interface PINVerifyProps {
  onVerifySuccess: () => void;
  onCancel: () => void;
  transactionType?: string;
  amount?: string;
  currency?: string;
}

export function PINVerify({ 
  onVerifySuccess, 
  onCancel, 
  transactionType = 'Transaction',
  amount,
  currency 
}: PINVerifyProps) {
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const verifyPIN = async () => {
    if (pin.length !== 6) {
      setError('Please enter your 6-digit PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await backendAPI.auth.verifyPIN(pin);

      if (result.success) {
        onVerifySuccess();
      } else {
        throw new Error(result.error || 'Invalid PIN');
      }
    } catch (err: any) {
      console.error('PIN verification error:', err);
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      
      if (newAttempts >= 3) {
        setError('Too many failed attempts. Transaction cancelled for security.');
        setTimeout(() => {
          onCancel();
        }, 2000);
      } else {
        setError(`Invalid PIN. ${3 - newAttempts} attempts remaining.`);
      }
      
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinInput = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 6);
    setPin(cleaned);
    setError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && pin.length === 6 && !isLoading) {
      verifyPIN();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#1A1D23] border-[#A4F34D]/20 p-6 relative">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-gray-400 hover:text-white"
          disabled={isLoading}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-[#A4F34D]/10 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-[#A4F34D]" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Authorize Transaction</h2>
          <p className="text-gray-400 text-sm text-center">
            Enter your PIN to confirm this {transactionType.toLowerCase()}
          </p>
        </div>

        {/* Transaction Details */}
        {amount && currency && (
          <div className="bg-[#A4F34D]/5 border border-[#A4F34D]/20 rounded-lg p-4 mb-6">
            <p className="text-xs text-gray-400 mb-1">Amount</p>
            <p className="text-2xl font-bold text-white">
              {currency} {amount}
            </p>
            <p className="text-xs text-gray-400 mt-2">{transactionType}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              Enter your transaction PIN
            </label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => handlePinInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="••••••"
              className="h-14 text-center text-2xl font-mono tracking-widest bg-[#0B0E11] border-[#A4F34D]/20 text-white"
              autoFocus
              disabled={isLoading || attempts >= 3}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <Button
            onClick={verifyPIN}
            disabled={isLoading || pin.length !== 6 || attempts >= 3}
            className="w-full bg-[#A4F34D] hover:bg-[#95E03D] text-[#0B0E11] font-bold h-12"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 mr-2" />
                Confirm Transaction
              </>
            )}
          </Button>

          <Button
            onClick={onCancel}
            variant="ghost"
            className="w-full text-gray-400 hover:text-white"
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
