/**
 * BorderPay Africa - Notification Bell
 * In-app notification center with badge
 * Uses KV store backend for non-financial notifications
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bell, 
  X, 
  Check, 
  Trash2,
  CheckCheck,
  CreditCard,
  Shield,
  User,
  AlertCircle,
  Megaphone
} from 'lucide-react';
import { authAPI } from '../../utils/supabase/client';
import { projectId, publicAnonKey } from '../../utils/supabase/info';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';

interface Notification {
  id: string;
  user_id: string;
  type: 'transaction' | 'security' | 'account' | 'card' | 'system' | 'announcement';
  title: string;
  room_topic: string;
  icon?: string;
  action_url?: string;
  action_label?: string;
  read: boolean;
  read_at?: string;
  created_at: string;
  metadata?: Record<string, any>;
}

interface NotificationBellProps {
  className?: string;
}

export function NotificationBell({ className = '' }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    // Small delay to avoid cold-start race conditions
    const initialTimeout = setTimeout(() => {
      loadUnreadCount();
    }, 2000);
    
    // Poll for unread count every 30 seconds
    const interval = setInterval(loadUnreadCount, 30000);
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
      // Abort any in-flight requests on unmount
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

  const getAccessToken = (): string | null => {
    const token = authAPI.getToken();
    return token || null;
  };

  const loadUnreadCount = async () => {
    try {
      // Skip if user is not authenticated
      const token = authAPI.getToken();
      if (!token) return;

      // Abort previous request if still pending
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Skip if signal already aborted (e.g. rapid unmount/remount)
      if (controller.signal.aborted) return;

      const result = await backendAPI.notifications.getUnreadCount(controller.signal);
      if (controller.signal.aborted) return;
      if (result.success && result.data) {
        setUnreadCount(result.data.unread_count ?? 0);
      }
    } catch (error: any) {
      // Silently ignore abort and network errors for polling
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const result = await backendAPI.notifications.getNotifications(20);
      if (result.success && result.data) {
        const items = result.data.notifications;
        setNotifications(Array.isArray(items) ? items : []);
        setUnreadCount(result.data.unread_count ?? 0);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      toast.error('Unable to load your notifications. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const result = await backendAPI.notifications.markAsRead(notificationId);
      if (result.success) {
        setNotifications(prev => 
          prev.map(n => n.id === notificationId ? { ...n, read: true, read_at: new Date().toISOString() } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const result = await backendAPI.notifications.markAllAsRead();
      if (result.success) {
        setNotifications(prev => 
          prev.map(n => ({ ...n, read: true, read_at: new Date().toISOString() }))
        );
        setUnreadCount(0);
        toast.success('All notifications marked as read');
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
      toast.error('Could not update notifications. Please try again.');
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const result = await backendAPI.notifications.deleteNotification(notificationId);
      if (result.success) {
        setNotifications(prev => prev.filter(n => n.id !== notificationId));
        toast.success('Notification deleted');
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast.error('Could not remove this notification. Please try again.');
    }
  };

  const clearAll = async () => {
    if (!confirm('Are you sure you want to clear all notifications?')) return;

    try {
      const result = await backendAPI.notifications.clearAll();
      if (result.success) {
        setNotifications([]);
        setUnreadCount(0);
        toast.success('All notifications cleared');
      }
    } catch (error) {
      console.error('Error clearing notifications:', error);
      toast.error('Could not clear notifications. Please check your connection.');
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'transaction':
        return <CreditCard className="w-5 h-5" />;
      case 'security':
        return <Shield className="w-5 h-5" />;
      case 'account':
        return <User className="w-5 h-5" />;
      case 'card':
        return <CreditCard className="w-5 h-5" />;
      case 'system':
        return <AlertCircle className="w-5 h-5" />;
      case 'announcement':
        return <Megaphone className="w-5 h-5" />;
      default:
        return <Bell className="w-5 h-5" />;
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'transaction':
        return 'bg-[#C7FF00]/20 text-[#C7FF00]';
      case 'security':
        return 'bg-red-500/20 text-red-500';
      case 'account':
        return 'bg-blue-500/20 text-blue-500';
      case 'card':
        return 'bg-purple-500/20 text-purple-500';
      case 'system':
        return 'bg-orange-500/20 text-orange-500';
      case 'announcement':
        return 'bg-green-500/20 text-green-500';
      default:
        return 'bg-white/10 text-white';
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <div className={`relative ${className}`}>
      {/* Bell Icon with Badge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-white/5 rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5 text-white" />
        {unreadCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.div>
        )}
      </button>

      {/* Notification Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 w-[380px] max-w-[calc(100vw-32px)] bg-[#0B0E11]/80 backdrop-blur-2xl border border-white/[0.08] rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-bold text-sm">Notifications</h3>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-white/60" />
                  </button>
                </div>

                {unreadCount > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={markAllAsRead}
                      className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/60 transition-colors flex items-center justify-center gap-1"
                    >
                      <CheckCheck className="w-3 h-3" />
                      Mark all read
                    </button>
                    <button
                      onClick={clearAll}
                      className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] text-white/60 transition-colors flex items-center justify-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear all
                    </button>
                  </div>
                )}
              </div>

              {/* Notifications List */}
              <div className="max-h-[500px] overflow-y-auto">
                {loading ? (
                  <div className="p-8 text-center">
                    <div className="w-8 h-8 border-2 border-[#C7FF00] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-white/40 text-xs">Loading...</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Bell className="w-8 h-8 text-white/30" />
                    </div>
                    <p className="text-white/60 text-sm mb-1">No notifications</p>
                    <p className="text-white/40 text-xs">You're all caught up!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {notifications.map((notification) => (
                      <motion.div
                        key={notification.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`p-4 hover:bg-white/5 transition-colors ${
                          !notification.read ? 'bg-white/[0.02]' : ''
                        }`}
                      >
                        <div className="flex gap-3">
                          {/* Icon */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getNotificationColor(notification.type)}`}>
                            {getNotificationIcon(notification.type)}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className="text-white text-sm font-medium">
                                {notification.title}
                              </h4>
                              {!notification.read && (
                                <div className="w-2 h-2 bg-[#C7FF00] rounded-full flex-shrink-0 mt-1" />
                              )}
                            </div>
                            <p className="text-white/60 text-xs mb-2 line-clamp-2">
                              {notification.room_topic}
                            </p>
                            <div className="flex items-center justify-between">
                              <span className="text-white/40 text-[10px]">
                                {formatTime(notification.created_at)}
                              </span>
                              <div className="flex gap-1">
                                {!notification.read && (
                                  <button
                                    onClick={() => markAsRead(notification.id)}
                                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                                    title="Mark as read"
                                  >
                                    <Check className="w-3 h-3 text-white/60" />
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteNotification(notification.id)}
                                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3 h-3 text-white/60" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}