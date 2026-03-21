/**
 * BorderPay Africa - Live Chat Routes
 * Chat support using Postgres `rooms` and `chat_messages` tables (durable)
 * 
 * MIGRATED from ephemeral store → rooms + chat_messages tables
 */

import { Hono } from 'npm:hono@4';
import * as db from './db.tsx';

export function createChatRoutes(app: Hono, verifyAuth: any) {

  /**
   * GET /chat/sessions
   */
  app.get('/make-server-8714b62b/chat/sessions', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      console.log('💬 Getting chat sessions for user:', auth.userId);

      const sessions = await db.getRoomsByUser(auth.userId);

      return c.json({ success: true, data: { sessions } });
    } catch (error) {
      console.error('❌ Get chat sessions error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * POST /chat/sessions
   */
  app.post('/make-server-8714b62b/chat/sessions', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      const { subject } = body;

      console.log('💬 Creating new chat session for user:', auth.userId);

      const sessionId = `session_${auth.userId}_${Date.now()}`;
      const newSession = {
        id: sessionId,
        user_id: auth.userId,
        status: 'active',
        subject: subject || 'Support Request',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 0,
      };

      await db.insertRoom(newSession);
      console.log('✅ Chat session created:', sessionId);

      return c.json({ success: true, data: { session: newSession } });
    } catch (error) {
      console.error('❌ Create chat session error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * GET /chat/sessions/:sessionId/messages
   */
  app.get('/make-server-8714b62b/chat/sessions/:sessionId/messages', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const sessionId = c.req.param('sessionId');
      console.log('💬 Getting messages for session:', sessionId);

      const session = await db.getRoom(auth.userId, sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Chat session not found' }, 404);
      }

      const messages = await db.getChatMessagesByRoom(sessionId);

      return c.json({ success: true, data: { messages } });
    } catch (error) {
      console.error('❌ Get messages error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * POST /chat/sessions/:sessionId/messages
   */
  app.post('/make-server-8714b62b/chat/sessions/:sessionId/messages', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const sessionId = c.req.param('sessionId');
      const body = await c.req.json();
      const { message } = body;

      if (!message || message.trim().length === 0) {
        return c.json({ success: false, error: 'Message cannot be empty' }, 400);
      }

      console.log('💬 Sending message in session:', sessionId);

      const session = await db.getRoom(auth.userId, sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Chat session not found' }, 404);
      }

      const userProfile = await db.getProfile(auth.userId);
      const senderName = userProfile?.full_name || 'User';

      const messageId = `msg_${sessionId}_${Date.now()}`;
      const newMessage = {
        id: messageId,
        room_id: sessionId,
        user_id: auth.userId,
        sender_type: 'user',
        sender_name: senderName,
        message: message.trim(),
        created_at: new Date().toISOString(),
      };

      await db.insertChatMessage(newMessage);

      // Update room last_message and updated_at
      await db.updateRoom(sessionId, auth.userId, {
        last_message: message.trim().substring(0, 100),
      });

      console.log('✅ Message sent:', messageId);

      return c.json({ success: true, data: { message: newMessage } });
    } catch (error) {
      console.error('❌ Send message error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * PATCH /chat/sessions/:sessionId/status
   */
  app.patch('/make-server-8714b62b/chat/sessions/:sessionId/status', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const sessionId = c.req.param('sessionId');
      const body = await c.req.json();
      const { status } = body;

      if (!['active', 'resolved', 'pending'].includes(status)) {
        return c.json({ success: false, error: 'Invalid status' }, 400);
      }

      console.log('💬 Updating session status:', sessionId, status);

      const session = await db.getRoom(auth.userId, sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Chat session not found' }, 404);
      }

      const updated = await db.updateRoom(sessionId, auth.userId, { status });
      console.log('✅ Session status updated');

      return c.json({ success: true, data: { session: updated } });
    } catch (error) {
      console.error('❌ Update session status error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * PATCH /chat/messages/:messageId/read
   */
  app.patch('/make-server-8714b62b/chat/messages/:messageId/read', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const messageId = c.req.param('messageId');
      console.log('💬 Marking message as read:', messageId);

      const message = await db.getChatMessage(messageId);
      if (!message) {
        return c.json({ success: false, error: 'Message not found' }, 404);
      }

      const updated = await db.updateChatMessage(messageId, {
        read_at: new Date().toISOString(),
      });

      console.log('✅ Message marked as read');
      return c.json({ success: true, data: { message: updated } });
    } catch (error) {
      console.error('❌ Mark message read error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  return app;
}