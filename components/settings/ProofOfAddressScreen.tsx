/**
 * BorderPay Africa - Proof of Address Screen
 * Upload and manage proof of address documents
 */

import React, { useState, useRef } from 'react';
import { ArrowLeft, Upload, FileText, CheckCircle2, Clock, X, Loader2 } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { toast } from 'sonner';
import { authAPI, BASE_URL, ANON_KEY } from '../../utils/supabase/client';

interface ProofOfAddressScreenProps {
  onBack: () => void;
}

const documentTypes = [
  { id: 'utility_bill', label: 'Utility Bill', desc: 'Electricity, water, gas, internet (last 3 months)' },
  { id: 'bank_statement', label: 'Bank Statement', desc: 'Official bank statement (last 3 months)' },
  { id: 'lease_agreement', label: 'Lease / Rental Agreement', desc: 'Current valid lease or rental agreement' },
  { id: 'government_letter', label: 'Government Letter', desc: 'Tax notice or official government correspondence' },
];

export function ProofOfAddressScreen({ onBack }: ProofOfAddressScreenProps) {
  const tc = useThemeClasses();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<'none' | 'uploaded' | 'reviewing' | 'verified'>('none');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum 10MB.');
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload JPG, PNG, or PDF.');
      return;
    }

    setUploadedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedType || !uploadedFile) {
      toast.error('Please select a document type and upload a file.');
      return;
    }

    setUploading(true);
    try {
      const token = authAPI.getToken();

      // Single call: upload file + document_type via FormData
      const formData = new FormData();
      formData.append('file', uploadedFile);
      formData.append('document_type', selectedType);

      const res = await fetch(`${BASE_URL}/upload-poa`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${token || ANON_KEY}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }

      setStatus('uploaded');
      toast.success('Document uploaded successfully! Under review.');
    } catch (error: any) {
      console.error('POA upload error:', error);
      toast.error(error.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`text-lg font-bold ${tc.text}`}>Proof of Address</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Info Card */}
        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <FileText size={18} className="text-indigo-400" />
            </div>
            <div>
              <h2 className={`text-sm font-bold ${tc.text} mb-1`}>Why do we need this?</h2>
              <p className={`text-xs ${tc.textSecondary} leading-relaxed`}>
                A proof of address verifies your residential address for regulatory compliance.
                Documents must be dated within the last 3 months and show your full name and address.
              </p>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        {status === 'uploaded' && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20">
            <Clock size={20} className="text-yellow-400" />
            <div>
              <p className={`text-sm font-semibold ${tc.text}`}>Document Under Review</p>
              <p className="text-xs text-yellow-400/80">We'll notify you once verification is complete.</p>
            </div>
          </div>
        )}

        {/* Document Type Selection */}
        {status === 'none' && (
          <>
            <div>
              <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider mb-3`}>
                Select Document Type
              </h2>
              <div className="space-y-2">
                {documentTypes.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedType(doc.id)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all ${
                      selectedType === doc.id
                        ? 'bg-[#C7FF00]/10 border-[#C7FF00]/30'
                        : `${tc.card} ${tc.cardBorder}`
                    }`}
                  >
                    <p className={`text-sm font-semibold ${tc.text}`}>{doc.label}</p>
                    <p className={`text-xs ${tc.textSecondary} mt-0.5`}>{doc.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* File Upload */}
            <div>
              <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider mb-3`}>
                Upload Document
              </h2>

              {uploadedFile ? (
                <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 flex items-center gap-3`}>
                  <div className="w-10 h-10 rounded-xl bg-[#C7FF00]/20 flex items-center justify-center">
                    <CheckCircle2 size={18} className="text-[#C7FF00]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tc.text} truncate`}>{uploadedFile.name}</p>
                    <p className={`text-xs ${tc.textSecondary}`}>
                      {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setUploadedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center"
                  >
                    <X size={14} className="text-red-400" />
                  </button>
                </div>
              ) : (
                <label className={`block ${tc.card} border-2 border-dashed ${tc.cardBorder} rounded-2xl p-8 text-center cursor-pointer hover:border-[#C7FF00]/30 transition-colors`}>
                  <Upload size={32} className={`${tc.textSecondary} mx-auto mb-3`} />
                  <p className={`text-sm font-semibold ${tc.text} mb-1`}>Tap to upload</p>
                  <p className={`text-xs ${tc.textSecondary}`}>JPG, PNG or PDF — max 10MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Submit Button */}
            <button
              onClick={handleUpload}
              disabled={!selectedType || !uploadedFile || uploading}
              className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${
                selectedType && uploadedFile && !uploading
                  ? 'bg-[#C7FF00] text-black active:scale-[0.98]'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Uploading...
                </span>
              ) : (
                'Submit Document'
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
