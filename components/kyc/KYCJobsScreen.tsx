/**
 * BorderPay Africa — KYC Jobs List
 * Displays all SmileID verification jobs with status, filtering, and details.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Search, X, Shield, UserCheck, AlertCircle,
  Clock, CheckCircle, XCircle, RefreshCw, Loader2,
  ChevronDown, ChevronUp, FileText, Globe, Phone, Mail,
  Filter, Users, BadgeCheck
} from 'lucide-react';
import { kycAPI } from '../../utils/api/backendAPI';
import { motion, AnimatePresence } from 'motion/react';

interface KYCJobsScreenProps {
  onBack: () => void;
}

interface KYCJob {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  country: string;
  kyc_status: string;
  created_at: string;
  updated_at: string;
  documents: Array<{
    document_type: string;
    status: string;
    provider_ref: string;
    rejection_reason: string | null;
    created_at: string;
  }>;
  smile_job: {
    job_complete: boolean;
    job_success: boolean;
    result_code: string;
    result_text: string;
    confidence: string;
    smile_job_id: string;
  } | null;
}

interface KYCStats {
  total: number;
  verified: number;
  pending: number;
  failed: number;
}

type StatusFilter = 'all' | 'verified' | 'pending' | 'failed';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
  verified: { label: 'Verified', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', icon: CheckCircle },
  approved: { label: 'Approved', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', icon: CheckCircle },
  tier2: { label: 'Tier 2', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', icon: BadgeCheck },
  full_enrollment: { label: 'Full', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', icon: BadgeCheck },
  pending: { label: 'Pending', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', icon: Clock },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: XCircle },
  rejected: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: XCircle },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending;
}

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function KYCJobsScreen({ onBack }: KYCJobsScreenProps) {
  const [jobs, setJobs] = useState<KYCJob[]>([]);
  const [stats, setStats] = useState<KYCStats>({ total: 0, verified: 0, pending: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchJobs = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await kycAPI.getKYCJobs();
      if (result.success && result.data) {
        setJobs(result.data.jobs || []);
        setStats(result.data.stats || { total: 0, verified: 0, pending: 0, failed: 0 });
      } else {
        setError(result.error || 'Failed to load KYC jobs');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Filter jobs by search and status
  const filteredJobs = jobs.filter(job => {
    const matchesSearch = !searchQuery ||
      job.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.country.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.user_id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'verified' && ['verified', 'approved', 'tier2', 'full_enrollment'].includes(job.kyc_status)) ||
      (statusFilter === 'pending' && job.kyc_status === 'pending') ||
      (statusFilter === 'failed' && ['failed', 'rejected'].includes(job.kyc_status));

    return matchesSearch && matchesStatus;
  });

  const filterTabs: { id: StatusFilter; label: string; count: number; color: string }[] = [
    { id: 'all', label: 'All', count: stats.total, color: 'white' },
    { id: 'verified', label: 'Approved', count: stats.verified, color: 'green' },
    { id: 'pending', label: 'Pending', count: stats.pending, color: 'yellow' },
    { id: 'failed', label: 'Failed', count: stats.failed, color: 'red' },
  ];

  return (
    <div className="min-h-full bg-[#0B0E11] text-white flex flex-col pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 py-3 pt-safe">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-all active:scale-90"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2">
            <Shield size={14} className="text-[#C7FF00]" />
            <span className="text-[11px] font-bold tracking-widest uppercase">
              KYC Jobs
            </span>
          </div>

          <button
            onClick={() => fetchJobs(true)}
            disabled={refreshing}
            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-all active:scale-90"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-[#C7FF00]' : ''} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-4 gap-2">
          {filterTabs.map(tab => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-xl border p-2.5 text-center transition-all active:scale-95 ${
                  isActive
                    ? 'bg-[#C7FF00]/10 border-[#C7FF00]/30'
                    : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                }`}
              >
                <p className={`text-lg font-bold ${isActive ? 'text-[#C7FF00]' : 'text-white'}`}>
                  {tab.count}
                </p>
                <p className={`text-[8px] font-semibold uppercase tracking-wider ${
                  isActive ? 'text-[#C7FF00]/70' : 'text-gray-500'
                }`}>
                  {tab.label}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, country..."
            className="w-full pl-10 pr-10 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-xs focus:outline-none focus:border-[#C7FF00]/40 transition-all placeholder:text-gray-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="px-4 pb-2 flex items-center justify-between">
        <p className="text-[10px] text-gray-500 font-medium">
          {filteredJobs.length} {filteredJobs.length === 1 ? 'result' : 'results'}
        </p>
        {searchQuery && (
          <p className="text-[10px] text-gray-600">
            Searching: "{searchQuery}"
          </p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pb-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#C7FF00] animate-spin mb-3" />
            <p className="text-xs text-gray-500">Loading KYC jobs...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-sm text-red-400 font-medium mb-1">Failed to load</p>
            <p className="text-xs text-gray-500 mb-4">{error}</p>
            <button
              onClick={() => fetchJobs()}
              className="px-5 py-2 bg-[#C7FF00] text-black rounded-xl text-xs font-bold"
            >
              Retry
            </button>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users className="w-10 h-10 text-gray-600 mb-3" />
            <p className="text-sm text-gray-400 font-medium mb-1">No jobs found</p>
            <p className="text-xs text-gray-600">
              {searchQuery ? 'Try a different search term' : 'No KYC submissions yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredJobs.map((job, index) => {
              const sc = getStatusConfig(job.kyc_status);
              const StatusIcon = sc.icon;
              const isExpanded = expandedJob === job.user_id;

              return (
                <motion.div
                  key={job.user_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
                >
                  {/* Job Header - Clickable */}
                  <button
                    onClick={() => setExpandedJob(isExpanded ? null : job.user_id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-white/60">
                        {(job.full_name || '?')[0].toUpperCase()}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white truncate">
                          {job.full_name}
                        </p>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border ${sc.bg}`}>
                          <StatusIcon size={10} className={sc.color} />
                          <span className={`text-[8px] font-bold uppercase ${sc.color}`}>
                            {sc.label}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">
                        {job.email || job.user_id.slice(0, 8)}
                        {job.country ? ` · ${job.country}` : ''}
                      </p>
                    </div>

                    {/* Date + Expand */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <p className="text-[9px] text-gray-600">{formatDate(job.updated_at)}</p>
                      {isExpanded ? (
                        <ChevronUp size={14} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-500" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
                          {/* User details grid */}
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <DetailRow icon={Mail} label="Email" value={job.email || '—'} />
                            <DetailRow icon={Phone} label="Phone" value={job.phone || '—'} />
                            <DetailRow icon={Globe} label="Country" value={job.country || '—'} />
                            <DetailRow icon={Clock} label="Registered" value={formatDate(job.created_at)} />
                          </div>

                          {/* SmileID Job Data */}
                          {job.smile_job && (
                            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 mb-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Shield size={12} className="text-[#C7FF00]" />
                                <span className="text-[9px] font-bold text-[#C7FF00] uppercase tracking-wider">
                                  SmileID Result
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <MiniStat
                                  label="Status"
                                  value={job.smile_job.job_success ? 'Success' : job.smile_job.job_complete ? 'Failed' : 'Processing'}
                                  color={job.smile_job.job_success ? 'text-green-400' : 'text-yellow-400'}
                                />
                                <MiniStat label="Result" value={job.smile_job.result_text || '—'} />
                                <MiniStat label="Confidence" value={job.smile_job.confidence ? `${job.smile_job.confidence}%` : '—'} />
                                <MiniStat label="Job ID" value={job.smile_job.smile_job_id?.slice(0, 12) || '—'} />
                              </div>
                            </div>
                          )}

                          {/* Documents */}
                          {job.documents.length > 0 && (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <FileText size={12} className="text-gray-400" />
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                                  Documents ({job.documents.length})
                                </span>
                              </div>
                              <div className="space-y-1.5">
                                {job.documents.map((doc, i) => {
                                  const dsc = getStatusConfig(doc.status);
                                  return (
                                    <div
                                      key={i}
                                      className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-2"
                                    >
                                      <div>
                                        <p className="text-[10px] font-medium text-white/80 capitalize">
                                          {(doc.document_type || 'document').replace(/_/g, ' ')}
                                        </p>
                                        {doc.rejection_reason && (
                                          <p className="text-[9px] text-red-400 mt-0.5">{doc.rejection_reason}</p>
                                        )}
                                      </div>
                                      <span className={`text-[8px] font-bold uppercase ${dsc.color}`}>
                                        {dsc.label}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* User ID (small) */}
                          <p className="text-[8px] text-gray-700 mt-3 font-mono select-all">
                            ID: {job.user_id}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-2.5 py-2">
      <Icon size={11} className="text-gray-500 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[8px] text-gray-600 uppercase tracking-wider">{label}</p>
        <p className="text-[10px] text-white/70 truncate">{value}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white/[0.02] rounded-lg px-2.5 py-1.5">
      <p className="text-[8px] text-gray-600 uppercase tracking-wider">{label}</p>
      <p className={`text-[10px] font-semibold truncate ${color || 'text-white/70'}`}>{value}</p>
    </div>
  );
}
