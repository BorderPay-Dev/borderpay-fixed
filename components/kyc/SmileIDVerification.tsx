/**
 * BorderPay Africa - SmileID Verification Component (Compact Card)
 * Embeds SmileID widget directly in-app via themed iframe
 * Polls smile-callback-handler for verification result
 */

import React, { useState, useEffect, useRef } from 'react';
import { SERVER_URL, ANON_KEY } from '../../utils/supabase/client';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Shield, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { authAPI, supabase } from '../../utils/supabase/client';
import { projectId } from '../../utils/supabase/info';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';

const BORDERPAY_THEME_COLOR = 'C7FF00';
const SMILEID_SANDBOX_URL = 'https://links.sandbox.usesmileid.com/8077/4ad0eb49-0a5d-45e1-8365-b64c5bc3fe98';

function appendThemeParams(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('theme_color', BORDERPAY_THEME_COLOR);
    u.searchParams.set('partner_name', 'BorderPay Africa');
    return u.toString();
  } catch {
    return url;
  }
}

interface SmileIDVerificationProps {
  onVerificationComplete: (status: 'verified' | 'failed' | 'pending') => void;
  userEmail: string;
  userName: string;
  userCountry: string;
}

export function SmileIDVerification({ 
  onVerificationComplete, 
  userEmail, 
  userName,
  userCountry 
}: SmileIDVerificationProps) {
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'loading' | 'widget' | 'polling' | 'success' | 'failed'>('idle');
  const [verificationLink, setVerificationLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const getCurrentUserId = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) return session.user.id;
    } catch (e) {
      console.warn('Failed to get Supabase session:', e);
    }
    const storedUser = authAPI.getStoredUser();
    return storedUser?.id || null;
  };

  // Generate verification link from backend
  const generateVerificationLink = async () => {
    setVerificationStatus('loading');
    setError(null);

    try {
      const response = await fetch(
        `${SERVER_URL}/smile-callback-handler`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authAPI.getToken()}`,
            'apikey': ANON_KEY,
          },
          body: JSON.stringify({
            job_id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            product: 'biometric_kyc'
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('SmileID Response:', data);

        if (data.success) {
          const link = data.data?.web_url || data.data?.mobile_url || data.data?.smile_link || data.data?.verification_url;
          if (link) {
            setVerificationLink(link);
            setVerificationStatus('widget');
            startPolling();
            return;
          }
        }
      }

      // Fallback to sandbox
      console.log('Using SmileID sandbox widget URL');
      setVerificationLink(appendThemeParams(SMILEID_SANDBOX_URL));
      setVerificationStatus('widget');
      startPolling();
    } catch (err: any) {
      console.warn('Backend failed, using sandbox:', err.message);
      setVerificationLink(appendThemeParams(SMILEID_SANDBOX_URL));
      setVerificationStatus('widget');
      startPolling();
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const startPolling = () => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(checkBackendStatus, 3000);
    checkBackendStatus();
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  // Poll smile-callback-handler for verification status
  const checkBackendStatus = async () => {
    const userId = await getCurrentUserId();
    if (!userId) return;

    try {
      const response = await fetch(
        `${SERVER_URL}/smile-callback-handler?userId=${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${authAPI.getToken() || ANON_KEY}`,
            'apikey': ANON_KEY,
          }
        }
      );
      const data = await response.json();
      console.log('Poll Status:', data.status);
      
      if (data.success) {
        if (data.status === 'verified') {
          setVerificationStatus('success');
          await refreshUserProfile();
          onVerificationComplete('verified');
          stopPolling();
        } else if (data.status === 'failed') {
          setVerificationStatus('failed');
          setError(data.result_text || 'Verification failed');
          onVerificationComplete('failed');
          stopPolling();
        }
      }
    } catch (e) {
      console.error('Status check error:', e);
    }
  };

  const refreshUserProfile = async () => {
    try {
      const result = await backendAPI.user.getProfile();
      if (result.success && result.data?.user) {
        localStorage.setItem('borderpay_user', JSON.stringify(result.data.user));
      }
    } catch (e) {
      console.error('Failed to refresh user profile:', e);
    }
  };

  return (
    <Card className="border-2 border-[#A4F34D] bg-white py-6 px-4 md:px-6">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-[#A4F34D]/10 rounded-full">
          <Shield className="w-6 h-6 text-[#A4F34D]" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-lg mb-2">Identity Verification</h3>
          <p className="text-gray-600 text-sm mb-4">
            Verify your identity using your ID card or passport via SmileID.
          </p>

          {/* Idle - Start Verification */}
          {verificationStatus === 'idle' && (
            <div className="space-y-3">
              <Button
                onClick={generateVerificationLink}
                className="w-full bg-[#A4F34D] hover:bg-[#95E03D] text-[#0B0E11] font-bold h-12"
              >
                <Shield className="w-4 h-4 mr-2" />
                Start Verification
              </Button>
              {error && (
                <p className="text-red-500 text-xs flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {error}
                </p>
              )}
            </div>
          )}

          {/* Loading */}
          {verificationStatus === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Preparing verification widget...
            </div>
          )}

          {/* Widget Embedded */}
          {verificationStatus === 'widget' && verificationLink && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-blue-900 mb-1">
                  Complete your verification below
                </p>
                <p className="text-xs text-blue-600">
                  You'll need your ID document and to take a selfie. Camera permission required.
                </p>
              </div>
              
              {/* SmileID Widget Iframe */}
              <div className="relative w-full bg-gray-50 rounded-lg overflow-hidden border-2 border-[#A4F34D]">
                <iframe
                  src={appendThemeParams(verificationLink)}
                  allow="camera; microphone"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  className="w-full"
                  style={{ 
                    height: '600px',
                    border: 'none'
                  }}
                  title="SmileID Identity Verification"
                />
              </div>

              <div className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <Loader2 className="w-4 h-4 text-yellow-600 animate-spin flex-shrink-0" />
                <p className="text-xs text-yellow-700">
                  Waiting for you to complete verification above. This will update automatically.
                </p>
              </div>
            </div>
          )}

          {/* Polling */}
          {verificationStatus === 'polling' && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <div>
                <p className="font-semibold text-blue-900">Processing verification...</p>
                <p className="text-sm text-blue-600">Please wait while we confirm your identity.</p>
              </div>
            </div>
          )}

          {/* Success */}
          {verificationStatus === 'success' && (
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-semibold text-green-900">Verification successful!</p>
                <p className="text-sm text-green-600">Your identity has been verified</p>
              </div>
            </div>
          )}

          {/* Failed */}
          {verificationStatus === 'failed' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <div>
                  <p className="font-semibold text-red-900">Verification failed</p>
                  <p className="text-sm text-red-600">{error || 'Please try again'}</p>
                </div>
              </div>
              <Button
                onClick={generateVerificationLink}
                className="w-full bg-[#A4F34D] hover:bg-[#95E03D] text-[#0B0E11] font-bold"
              >
                Try Again
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}