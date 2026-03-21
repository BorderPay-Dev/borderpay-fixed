/**
 * BorderPay Africa - Notification Feed Routes
 * In-app notification feed using Postgres `messages` table (durable, RLS-protected)
 * 
 * MIGRATED from ephemeral store → messages table
 */

import { Hono } from 'npm:hono@4';
import * as db from './db.tsx';

export function createNotificationFeedRoutes(app: Hono, verifyAuth: any) {

  /**
   * GET /notifications
   * Get user's notification feed
   */
  app.get('/make-server-8714b62b/notifications', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const url = new URL(c.req.url);
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const unreadOnly = url.searchParams.get('unread_only') === 'true';

      console.log('🔔 Getting notifications for user:', auth.userId, { limit, unreadOnly });

      const notifications = await db.getMessagesByUser(auth.userId, { limit, unreadOnly });
      const unreadCount = await db.getUnreadMessageCount(auth.userId);

      return c.json({
        success: true,
        data: {
          notifications,
          unread_count: unreadCount,
          total_count: notifications.length,
        }
      });

    } catch (error) {
      console.error('❌ Get notifications error:', error);
      return c.json({ success: false, error: `Failed to get notifications: ${error}` }, 500);
    }
  });

  /**
   * POST /notifications
   * Create a new notification (internal use - called by other services)
   */
  app.post('/make-server-8714b62b/notifications', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      const { user_id, type, title, message, icon, action_url, action_label, metadata } = body;

      if (!user_id || !type || !title || !message) {
        return c.json({ success: false, error: 'user_id, type, title, and message (room_topic) are required' }, 400);
      }

      const validTypes = ['transaction', 'security', 'account', 'card', 'system', 'announcement'];
      if (!validTypes.includes(type)) {
        return c.json({ success: false, error: 'Invalid notification type' }, 400);
      }

      console.log('🔔 Creating notification for user:', user_id);

      const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const notification = {
        id: notificationId,
        user_id,
        type,
        title,
        room_topic: message,
        icon: icon || null,
        action_url: action_url || null,
        action_label: action_label || null,
        read: false,
        created_at: new Date().toISOString(),
        metadata: metadata || {},
      };

      await db.insertMessage(notification);
      console.log('✅ Notification created:', notificationId);

      return c.json({ success: true, data: { notification } });

    } catch (error) {
      console.error('❌ Create notification error:', error);
      return c.json({ success: false, error: `Failed to create notification: ${error}` }, 500);
    }
  });

  /**
   * PATCH /notifications/:notificationId/read
   * Mark a notification as read
   */
  app.patch('/make-server-8714b62b/notifications/:notificationId/read', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const notificationId = c.req.param('notificationId');
      console.log('🔔 Marking notification as read:', notificationId);

      const notification = await db.getMessage(auth.userId, notificationId);
      if (!notification) {
        return c.json({ success: false, error: 'Notification not found' }, 404);
      }

      const updated = await db.updateMessage(notificationId, auth.userId, {
        read: true,
        read_at: new Date().toISOString(),
      });

      console.log('✅ Notification marked as read');
      return c.json({ success: true, data: { notification: updated } });

    } catch (error) {
      console.error('❌ Mark notification read error:', error);
      return c.json({ success: false, error: `Failed to mark as read: ${error}` }, 500);
    }
  });

  /**
   * POST /notifications/mark-all-read
   * Mark all notifications as read
   */
  app.post('/make-server-8714b62b/notifications/mark-all-read', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      console.log('🔔 Marking all notifications as read for user:', auth.userId);

      const updatedCount = await db.markAllMessagesRead(auth.userId);
      console.log('✅ Marked', updatedCount, 'notifications as read');

      return c.json({ success: true, data: { updated_count: updatedCount } });

    } catch (error) {
      console.error('❌ Mark all read error:', error);
      return c.json({ success: false, error: `Failed to mark all as read: ${error}` }, 500);
    }
  });

  /**
   * DELETE /notifications/:notificationId
   * Delete/dismiss a notification
   */
  app.delete('/make-server-8714b62b/notifications/:notificationId', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const notificationId = c.req.param('notificationId');
      console.log('🔔 Deleting notification:', notificationId);

      const notification = await db.getMessage(auth.userId, notificationId);
      if (!notification) {
        return c.json({ success: false, error: 'Notification not found' }, 404);
      }

      await db.deleteMessage(notificationId, auth.userId);
      console.log('✅ Notification deleted');

      return c.json({ success: true, message: 'Notification deleted' });

    } catch (error) {
      console.error('❌ Delete notification error:', error);
      return c.json({ success: false, error: `Failed to delete notification: ${error}` }, 500);
    }
  });

  /**
   * DELETE /notifications/clear-all
   * Clear all notifications for user
   */
  app.delete('/make-server-8714b62b/notifications/clear-all', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      console.log('🔔 Clearing all notifications for user:', auth.userId);
      await db.deleteAllMessages(auth.userId);
      console.log('✅ All notifications cleared');

      return c.json({ success: true, data: { deleted_count: 0 } });

    } catch (error) {
      console.error('❌ Clear notifications error:', error);
      return c.json({ success: false, error: `Failed to clear notifications: ${error}` }, 500);
    }
  });

  /**
   * GET /notifications/unread-count
   * Get count of unread notifications (fast endpoint for badge)
   */
  app.get('/make-server-8714b62b/notifications/unread-count', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const unreadCount = await db.getUnreadMessageCount(auth.userId);
      return c.json({ success: true, data: { unread_count: unreadCount } });

    } catch (error) {
      console.error('❌ Get unread count error:', error);
      return c.json({ success: false, error: `Failed to get unread count: ${error}` }, 500);
    }
  });

  return app;
}