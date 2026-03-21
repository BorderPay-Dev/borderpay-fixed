/**
 * BorderPay Africa - Hono Server (make-server-8714b62b)
 * NON-FINANCIAL routes ONLY — auth, profile, notifications, chat, settings.
 * 
 * All financial operations (wallets, cards, transfers, FX, KYC verification,
 * beneficiaries, analytics, etc.) are handled by 29 standalone Edge Functions
 * deployed separately via Supabase CLI. The frontend calls them directly
 * through backendAPI.ts → apiCall('edge-function-name').
 * 
 * This server handles:
 * - Auth (signup, signin, signout, session, OTP, magic-link, password reset)
 * - User profile (GET/PUT, profile picture, KYC document status)
 * - Notifications feed (CRUD, unread count)
 * - Chat / support
 * - Preferences & settings
 * - Session monitoring (device & location tracking)
 * - Email hooks (Resend integration)
 * 
 * Last cleaned: 2026-03-17 — removed 31 dead financial module files
 */

import { Hono } from 'npm:hono@4';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as db from './db.tsx';
// NON-FINANCIAL route handlers only — financial routes live in standalone Edge Functions
import { createSettingsRoutes } from './settings.tsx';
import { createChatRoutes } from './chat.tsx';
import { createPreferencesRoutes } from './preferences.tsx';
import { createNotificationFeedRoutes } from './notifications-feed.tsx';
import { initializeUserInDb } from './users.tsx';
import { sendEmail, getWelcomeEmail, getMagicLinkEmail, getPasswordResetEmail, getReauthenticationEmail, getInviteUserEmail, getChangeEmailAddressEmail } from './email.tsx';
import emailHook from './email-hook.tsx';
import session from './session.tsx';
import userProfileDirect from './user-profile-direct.tsx';

// ============================================================================
// INITIALIZATION
// ============================================================================

const app = new Hono();

// Environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Supabase admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// Supabase anon client (for auth operations like signIn)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Storage buckets - auto-create with make-8714b62b prefix as required
const PROFILE_PICTURES_BUCKET = 'make-8714b62b-profile-pictures';
const ADDRESS_VERIFICATION_BUCKET = 'make-8714b62b-address-verification';

async function initializeStorage() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    
    // Profile Pictures Bucket — idempotent create
    const profileBucketExists = buckets?.some((bucket: any) => bucket.name === PROFILE_PICTURES_BUCKET);
    if (!profileBucketExists) {
      const { error } = await supabase.storage.createBucket(PROFILE_PICTURES_BUCKET, { public: false });
      if (error) {
        console.warn('⚠️ Failed to create profile-pictures bucket:', error.message);
      } else {
        console.log('✅ Created profile-pictures bucket');
      }
    } else {
      console.log('✅ Profile-pictures bucket found');
    }

    // Address Verification Bucket — idempotent create
    const addressBucketExists = buckets?.some((bucket: any) => bucket.name === ADDRESS_VERIFICATION_BUCKET);
    if (!addressBucketExists) {
      const { error } = await supabase.storage.createBucket(ADDRESS_VERIFICATION_BUCKET, { public: false });
      if (error) {
        console.warn('⚠️ Failed to create address-verification bucket:', error.message);
      } else {
        console.log('✅ Created address-verification bucket');
      }
    } else {
      console.log('✅ Address-verification bucket found');
    }
    
  } catch (error) {
    console.error('❌ Error checking/creating storage buckets:', error);
  }
}

// Initialize storage on startup
initializeStorage().catch(console.error);


// ============================================================================
// MIDDLEWARE
// ============================================================================

// CORS - Allow all origins
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'apikey'],
  credentials: true,
  exposeHeaders: ['Content-Length', 'Content-Type'],
}));

// Logger
app.use('*', logger(console.log));



// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Verify user authentication
 */
async function verifyAuth(authHeader: string | null): Promise<{ userId: string; error?: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No auth header or invalid format');
    return null;
  }

  const token = authHeader.split(' ')[1];
  
  if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
    console.log('❌ Invalid token format');
    return null;
  }

  // Skip verification for ANON key (public requests)
  if (token === SUPABASE_ANON_KEY) {
    console.log('⚠️ ANON key used - no user verification');
    return null;
  }
  
  
  // Regular Supabase Auth verification
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) {
      // Check if token is expired
      if (error.message?.includes('expired') || error.code === 'bad_jwt') {
        console.error('🔐 Token expired:', error.message);
        return { userId: '', error: 'TOKEN_EXPIRED' };
      }

      // Handle "Auth session missing" which usually means invalid token structure
      if (error.message === 'Auth session missing!') {
        console.error('🔐 Auth verification failed: Invalid token structure');
        return null;
      }

      console.error('🔐 Auth verification failed:', error.message);
      return null;
    }
    
    if (!user) {
      console.error('🔐 No user found for token');
      return null;
    }
    
    console.log('✅ Auth verified for user:', user.id);
    return { userId: user.id };
  } catch (error) {
    console.error('🔐 Auth verification error:', error);
    // Check if it's a token expiry error
    if (error instanceof Error && (error.message.includes('expired') || error.message.includes('bad_jwt'))) {
      return { userId: '', error: 'TOKEN_EXPIRED' };
    }
    return null;
  }
}

// Financial helper functions (generateAccountNumber, generateCardNumber, etc.)
// removed — financial operations are handled by standalone Edge Functions.

/**
 * Validate Password Strength
 */
function validatePasswordStrength(password: string): { isValid: boolean; error?: string } {
  if (password.length < 12) {
    return { isValid: false, error: 'Password must be at least 12 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one number' };
  }
  return { isValid: true };
}

// ============================================================================
// HEALTH & DEBUG ROUTES
// ============================================================================

/**
 * GET /ping
 * Simple ping endpoint
 */
app.get('/make-server-8714b62b/ping', (c) => {
  return c.json({
    success: true,
    message: 'pong',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/make-server-8714b62b/health', (c) => {
  return c.json({
    success: true,
    message: 'BorderPay Africa API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: {
      hasSupabaseUrl: !!Deno.env.get('SUPABASE_URL'),
      hasSupabaseAnonKey: !!Deno.env.get('SUPABASE_ANON_KEY'),
      hasSupabaseServiceKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      hasResendKey: !!Deno.env.get('RESEND_API_KEY'),
      hasSmileIdPartnerId: !!Deno.env.get('SMILEID_PARTNER_ID'),
      hasSmileIdApiKey: !!Deno.env.get('SMILEID_API_KEY'),
    }
  });
});

/**
 * OPTIONS /auth/2fa/* (and all routes)
 * CORS diagnostic endpoint - helps debug CORS preflight issues
 */
app.options('/make-server-8714b62b/*', (c) => {
  console.log('✅ CORS preflight request received for:', c.req.url);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      'Access-Control-Max-Age': '86400',
    },
  });
});

// 🔒 SECURITY: Debug routes (/debug/init-demo-users, /debug/check-demo-user)
// removed — they exposed unauthenticated admin-level access to user data,
// profile lookups, and account enumeration. Removed 2026-03-14.

/**
 * POST /contact
 * Handle contact form submission
 */
app.post('/make-server-8714b62b/contact', async (c) => {
  try {
    const body = await c.req.json();
    const { name, email, message } = body;

    console.log('📧 Contact form submission:', { name, email });

    if (!name || !email || !message) {
      return c.json({
        success: false,
        error: 'Name, email, and message are required'
      }, 400);
    }

    // Send email notification via Resend
    const emailResult = await sendEmail({
      to: 'contact@borderpayafrica.com', // Destination email
      subject: `New Contact Form Submission from ${name}`,
      html: `
        <h1>New Contact Message</h1>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\\n/g, '<br>')}</p>
      `,
    });

    if (!emailResult.success) {
      console.error('❌ Failed to send contact email:', emailResult.error);
      // If email fails, we still return success to user but log error, 
      // or we can fail. For now, let's fail so they know.
      return c.json({
        success: false,
        error: 'Failed to send message system. Please try again later.'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Message sent successfully'
    });

  } catch (error) {
    console.error('❌ Contact form error:', error);
    return c.json({
      success: false,
      error: 'Internal server error'
    }, 500);
  }
});

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================



/**
 * POST /auth/signup
 * Create new user account
 */
app.post('/make-server-8714b62b/auth/signup', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, full_name, phone_number, country_code, account_type = 'individual', primary_currency = 'USD' } = body;
    
    // Use country_code for all purposes
    const country = country_code;
    const phone = phone_number;

    console.log('🔐 Signup request:', { email, full_name, country_code, phone_number, account_type, primary_currency });

    // Validate required fields
    if (!email || !password || !full_name || !country_code) {
      console.error('❌ Missing required fields');
      return c.json({
        success: false,
        error: 'Email, password, full name, and country are required'
      }, 400);
    }

    // ====================================================================
    // COMPLIANCE CHECK: Restricted Jurisdictions
    // ====================================================================
    const RESTRICTED_COUNTRIES = [
      'AB', 'AF', 'AL', 'AO', 'BY', 'BA', 'MM', 'BI', 'CF', 'CU', 'KP', 'CD',
      'ET', 'ER', 'GN', 'GW', 'HT', 'IR', 'IQ', 'CI', 'XK', 'LB', 'LR', 'LY',
      'MK', 'ML', 'NK', 'NI', 'NC', 'PK', 'RU', 'EH', 'SO', 'SL', 'OS', 'SS',
      'SD', 'SY', 'RS', 'UA', 'VE', 'YE', 'ZW'
    ];

    if (RESTRICTED_COUNTRIES.includes(country_code.toUpperCase())) {
      console.error(`❌ Restricted jurisdiction: ${country_code}`);
      return c.json({
        success: false,
        error: 'RESTRICTED_JURISDICTION',
        message: 'We cannot provide services to users in this jurisdiction due to regulatory restrictions',
        country_code: country_code.toUpperCase()
      }, 403);
    }
    // ====================================================================

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({
        success: false,
        error: 'Invalid email format'
      }, 400);
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      return c.json({
        success: false,
        error: passwordValidation.error
      }, 400);
    }

    // Create user in Supabase Auth
    // Multi-layer fallback strategy to handle aggressive DB triggers
    let authData: any = { user: null, session: null };
    let authError = null;
    
    // Prepare metadata
    const safeUsername = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '');
    const cleanAccountType = (account_type || 'individual').toLowerCase();
    
    // 1. Standard Metadata (Matches demo-init.tsx exactly)
    // This is the "Goldilocks" set - known to work for demo users
    const standardMetadata = {
        full_name,
        phone,
        country: country || 'UNKNOWN',
        account_type: cleanAccountType,
        primary_currency: primary_currency || 'USD'
    };

    // 2. Rich Metadata (Includes extra fields)
    const richMetadata = {
        ...standardMetadata,
        name: full_name,
        phone_number: phone, // Standard Supabase field often used
        username: safeUsername,
        first_name: full_name.split(' ')[0],
        last_name: full_name.split(' ').slice(1).join(' ') || '',
    };
    
    console.log('🔄 Strategy 1: Admin Create (Standard/Demo-Like)...');
    
    // Attempt 1: Admin Create (Standard)
    // Uses exactly the fields that work in demo-init.tsx
    const minResult = await supabase.auth.admin.createUser({
       email: email.toLowerCase().trim(),
       password: password,
       email_confirm: true,
       user_metadata: standardMetadata
    });

    if (minResult.data.user) {
       console.log('✅ User created (Standard). Updating with rich metadata...');
       authData = minResult.data;
       authError = null;
       
       // Step 2: Update with remaining metadata
       const { error: updateError } = await supabase.auth.admin.updateUserById(
           minResult.data.user.id,
           { user_metadata: richMetadata }
       );
       
       if (updateError) {
           console.warn('⚠️ Metadata update failed (non-critical):', updateError);
       }
    } else {
       authError = minResult.error;
       
       // Check if email already exists - this is expected, not an error
       if (authError?.code === 'email_exists' || 
           authError?.message?.includes('registered') ||
           authError?.message?.includes('exists')) {
         console.log('ℹ️ Email already registered (expected behavior, not an error)');
         // Don't try other strategies, skip to the final error handling
       } else {
         console.error('❌ Admin (Standard) failed:', authError);

         // Fallback: Admin Create (Rich Metadata)
         console.log('🔄 Strategy 2: Admin Create (Rich)...');
           
           const richResult = await supabase.auth.admin.createUser({
               email: email.toLowerCase().trim(),
               password: password,
               email_confirm: true,
               user_metadata: richMetadata
           });
           
           if (richResult.data.user) {
               console.log('✅ Fallback (Rich) successful');
               authData = richResult.data;
               authError = null;
           } else {
               console.error('❌ Fallback (Rich) failed:', richResult.error);
               
               // Attempt 3: Public SignUp (Anon Client)
               console.log('🔄 Strategy 3: Public SignUp (Anon Client)...');
               authError = richResult.error;
               
               // Try with Standard metadata first (safest)
               const signUpResult = await supabaseAnon.auth.signUp({
                   email,
                   password,
                   options: { data: standardMetadata }
               });
               
               if (signUpResult.data.user) {
                   console.log('✅ Fallback (Public SignUp) successful');
                   authData = signUpResult.data;
                   authError = null;
                   
                   // Force confirm if not confirmed
                   if (!signUpResult.data.session && !signUpResult.data.user.email_confirmed_at) {
                       console.log('🔄 Manually confirming user...');
                       await supabase.auth.admin.updateUserById(signUpResult.data.user.id, { email_confirm: true });
                       // Refresh user data
                       const { data: refreshedUser } = await supabase.auth.admin.getUserById(signUpResult.data.user.id);
                       if (refreshedUser.user) authData.user = refreshedUser.user;
                   }
               } else {
                   console.error('❌ All strategies failed.');
                   authError = signUpResult.error;
               }
           }
       }
    }

    // Ensure email is confirmed (since we want auto-login behavior usually, or at least valid user)
    if (!authError && authData?.user) {
       // If session exists, they are already confirmed/logged in.
       // If no session, confirm them manually via Admin.
       if (!authData.session && !authData.user.email_confirmed_at) {
           const { error: confirmError } = await supabase.auth.admin.updateUserById(
             authData.user.id,
             { email_confirm: true }
           );
           if (confirmError) {
             console.error('❌ Error confirming user:', confirmError);
           } else {
             authData.user.email_confirmed_at = new Date().toISOString();
           }
       }
    }

    if (authError || !authData.user) {
      // Handle duplicate email - check both code and message
      if (authError?.code === 'email_exists' || 
          authError?.message?.includes('registered') ||
          authError?.message?.includes('exists')) {
        console.log('ℹ️ Signup blocked: Email already exists (user will be redirected to sign in)');
        return c.json({
          success: false,
          error: 'This email is already registered. Please sign in instead.',
          code: 'email_exists'
        }, 422);
      }
      
      // Other auth errors (genuine failures)
      console.error('❌ Auth error during signup:', authError);
      return c.json({
        success: false,
        error: authError?.message || 'Database error creating user. Please try again later.'
      }, 400);
    }

    const userId = authData.user.id;
    console.log('✅ User created in auth:', userId);

    // Create user record in Postgres users table
    // This is required for security status checks (2FA, PIN)
    // Only insert core fields to avoid schema mismatch errors
    // IMPORTANT: Using service role client which bypasses RLS
    try {
      console.log('📝 Creating user record in Postgres with service role...');
      const { error: dbError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: email.toLowerCase().trim(),
          full_name,
          created_at: new Date().toISOString(),
        });

      if (dbError) {
        // Log but don't fail - user is already created in auth
        console.error('⚠️ Error creating user in Postgres (non-critical):', dbError);
        console.error('⚠️ This is expected if you haven\'t run the full schema.sql yet');
      } else {
        console.log('✅ User record created in Postgres');
        
        // Try to update with additional fields if they exist
        try {
          await supabase
            .from('users')
            .update({
              phone: phone,
              address_country: country,
              kyc_status: 'pending',
            })
            .eq('id', userId);
        } catch (updateError) {
          // Ignore - columns might not exist yet
          console.log('⚠️ Could not update additional user fields (columns may not exist)');
        }
      }
    } catch (dbError) {
      console.error('⚠️ Exception creating user in Postgres (non-critical):', dbError);
    }

    // Initialize user in DataBase (Profile, Account, Wallet)
    // This ensures data consistency across all modules (users.tsx, wallets.tsx)
    let userProfile;
    let userWallets = [];
    
    try {
      const result = await initializeUserInDb(userId, email, {
          full_name,
          phone,
          country,
          account_type,
          primary_currency
      });
      userProfile = result.profile;
      userWallets = result.wallets;
      console.log('✅ User initialized in Data Base');
      console.log('✅ Profile created:', userProfile.email);
      console.log('✅ Wallets created:', userWallets.length);
    } catch (DbError: any) {
      console.error('❌ KV initialization failed:', DbError);
      console.error('❌ Full error details:', JSON.stringify(DbError, null, 2));
      console.error('❌ Error stack:', DbError.stack);
      // Return detailed error to frontend
      return c.json({
        success: false,
        error: `Account creation failed during setup: ${DbError.message || 'Unknown error'}. Please contact support.`,
        details: DbError.message
      }, 500);
    }

    // Sign in to get session token
    const { data: sessionData, error: sessionError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (sessionError || !sessionData.session) {
      console.error('❌ Session creation failed:', sessionError);
      
      return c.json({
        success: true,
        message: 'Account created. Please sign in.',
        data: {
          user: {
            id: userId,
            email,
            full_name,
            country,
            account_type,
          }
        }
      });
    }

    console.log('✅ Signup complete with session');

    // Send welcome email via Resend
    try {
      console.log('📧 Sending welcome email to:', email);
      const emailResult = await sendEmail({
        to: email,
        subject: 'Welcome to BorderPay Africa',
        html: getWelcomeEmail(full_name),
      });
      
      if (!emailResult.success) {
        console.warn('⚠️ Failed to send welcome email:', emailResult.error);
      } else {
        console.log('✅ Welcome email sent successfully');
      }
    } catch (emailError) {
      console.error('❌ Error sending welcome email:', emailError);
      // Don't fail signup if email fails
    }

    return c.json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: {
          id: userId,
          email,
          full_name,
          country,
          account_type,
          kyc_status: 'pending',
          kyc_level: 0,
        },
        access_token: sessionData.session.access_token,
        profile: userProfile,
        wallets: userWallets,
      }
    });

  } catch (error) {
    console.error('❌ Signup error:', error);
    return c.json({
      success: false,
      error: 'Internal server error during signup: ' + String(error)
    }, 500);
  }
});

/**
 * POST /auth/signin
 * Sign in existing user
 */
app.post('/make-server-8714b62b/auth/signin', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    console.log('🔐 Sign in request:', { email });

    if (!email || !password) {
      return c.json({
        success: false,
        error: 'Email and password are required'
      }, 400);
    }

    // ============================================================================
    // DEMO USER AUTHENTICATION (DISABLED FOR PRODUCTION SECURITY)
    // ============================================================================
    // const isDemoIndividual = email === 'demo.individual@borderpay.africa' && password === 'Demo@2024123';

    // if (isDemoIndividual) {
    //   return c.json({
    //     success: false,
    //     error: 'Demo login is disabled in production mode.'
    //   }, 403);
    // }

    // Regular user signin
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      // Silent handling - don't spam logs for invalid credentials
      
      // Provide helpful error message
      const errorMessage = error?.message?.includes('Invalid login credentials') 
        ? 'Invalid email or password. Please check your credentials.'
        : 'Sign in failed. Please try again.';
      
      return c.json({
        success: false,
        error: errorMessage
      }, 401);
    }

    const userId = data.user.id;

    // Get user profile from Postgres
    let userProfile = await db.getProfile(userId);

    if (!userProfile) {
      console.warn(`⚠️ User profile missing for ${userId} (${email}). Attempting to auto-heal...`);
      
      try {
          const { profile } = await initializeUserInDb(userId, email, {
             full_name: data.user.user_metadata?.full_name || 'BorderPay User',
             country: data.user.user_metadata?.country || 'UNKNOWN',
             account_type: data.user.user_metadata?.account_type || 'individual'
          });
          userProfile = profile;
          console.log('✅ Profile auto-healed successfully');
      } catch (healError) {
          console.error('❌ Failed to auto-heal profile:', healError);
          return c.json({
            success: false,
            error: 'Account configuration error. Please contact support.'
          }, 500);
      }
    }

    console.log('✅ Sign in successful:', userId);

    return c.json({
      success: true,
      data: {
        user: userProfile,
        access_token: data.session.access_token,
      }
    });

  } catch (error) {
    console.error('❌ Sign in error:', error);
    return c.json({
      success: false,
      error: 'Internal server error during sign in'
    }, 500);
  }
});

/**
 * POST /auth/signout
 * Sign out user
 */
app.post('/make-server-8714b62b/auth/signout', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    
    if (!auth) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    console.log('✅ User signed out:', auth.userId);

    return c.json({
      success: true,
      message: 'Signed out successfully'
    });

  } catch (error) {
    console.error('❌ Sign out error:', error);
    return c.json({
      success: false,
      error: 'Internal server error'
    }, 500);
  }
});

/**
 * GET /auth/session
 * Verify current session
 */
app.get('/make-server-8714b62b/auth/session', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    
    if (!auth) {
      return c.json({ success: false, error: 'No active session' }, 401);
    }

    const userProfile = await db.getProfile(auth.userId);

    return c.json({
      success: true,
      data: {
        user: userProfile,
      }
    });

  } catch (error) {
    console.error('❌ Session check error:', error);
    return c.json({
      success: false,
      error: 'Internal server error'
    }, 500);
  }
});

/**
 * POST /kyc/submit
 * Submit KYC data and update status
 */
app.post('/make-server-8714b62b/kyc/submit', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const userId = auth.userId;
    
    // Get current profile from Postgres
    const profile = await db.getProfile(userId);
    if (!profile) {
       return c.json({ success: false, error: 'Profile not found' }, 404);
    }
    
    // Update status to reviewing
    const updatedProfile = await db.updateProfile(userId, {
      kyc_status: 'reviewing',
    });
    
    console.log('✅ KYC submitted for user:', userId);
    
    return c.json({
      success: true,
      message: 'KYC submitted successfully',
      data: { user: updatedProfile }
    });
    
  } catch (error) {
    console.error('❌ KYC submit error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /auth/magic-link
 * Request magic link (passwordless auth) using Supabase OTP
 */
app.post('/make-server-8714b62b/auth/magic-link', async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    console.log('🔗 Magic link request for:', email);

    if (!email) {
      return c.json({
        success: false,
        error: 'Email is required'
      }, 400);
    }

    // Use Supabase Admin to generate link (so we can send it via Resend)
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: (c.req.header('origin') || 'https://app.borderpayafrica.com') + '/auth/callback',
      }
    });

    if (error || !data.properties?.action_link) {
      console.error('❌ Magic link generation error:', error);
      return c.json({
        success: false,
        error: 'Failed to generate magic link: ' + (error?.message || 'Unknown error')
      }, 500);
    }

    console.log('🔗 Magic link generated, sending via Resend...');

    // Send via Resend
    const emailResult = await sendEmail({
      to: email,
      subject: 'Sign in to BorderPay',
      html: getMagicLinkEmail(data.properties.action_link),
    });

    if (!emailResult.success) {
      return c.json({
        success: false,
        error: 'Failed to send email: ' + emailResult.error
      }, 500);
    }

    console.log('✅ Magic link sent successfully via Resend to:', email);
    
    return c.json({
      success: true,
      message: 'Magic link sent successfully. Check your email.',
    });

  } catch (error) {
    console.error('❌ Magic link request error:', error);
    return c.json({
      success: false,
      error: 'Internal server error: ' + String(error)
    }, 500);
  }
});

/**
 * POST /auth/magic-link/verify
 * Verify magic link OTP and sign in
 */
app.post('/make-server-8714b62b/auth/magic-link/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { token, email, type = 'magiclink' } = body;

    console.log('🔗 Verifying OTP for:', email, 'Type:', type);

    if (!token || !email) {
      return c.json({
        success: false,
        error: 'Token and email are required'
      }, 400);
    }

    // Verify OTP with Supabase Auth
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: type as any, // 'magiclink' or 'email'
    });

    if (error || !data.session) {
      console.error('❌ OTP verification failed:', error);
      return c.json({
        success: false,
        error: 'Invalid or expired magic link token'
      }, 401);
    }

    const userId = data.user.id;

    // Get user profile from Postgres
    const userProfile = await db.getProfile(userId);

    if (!userProfile) {
      console.error('❌ User profile not found for:', userId);
      return c.json({
        success: false,
        error: 'User profile not found'
      }, 404);
    }

    console.log('✅ Magic link verified successfully');

    return c.json({
      success: true,
      data: {
        user: userProfile,
        access_token: data.session.access_token,
      }
    });

  } catch (error) {
    console.error('❌ Magic link verification error:', error);
    return c.json({
      success: false,
      error: 'Internal server error: ' + String(error)
    }, 500);
  }
});

/**
 * POST /auth/invite
 * Invite a new user
 */
app.post('/make-server-8714b62b/auth/invite', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { email, full_name } = body;
    
    if (!email) return c.json({ success: false, error: 'Email required' }, 400);
    
    const { data: sender } = await supabase.auth.admin.getUserById(auth.userId);
    const senderName = sender.user?.user_metadata?.full_name || 'A BorderPay User';

    // Generate Invite Link
    const originUrl = c.req.header('origin') || 'https://app.borderpayafrica.com';
    const inviteRedirect = originUrl + '/auth/signup?invited_by=' + auth.userId;
    const { data, error } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
            redirectTo: inviteRedirect,
            data: { full_name }
        }
    });

    if (error) throw error;

    // Send Email
    await sendEmail({
        to: email,
        subject: "You've been invited to BorderPay",
        html: getInviteUserEmail(senderName, data.properties.action_link)
    });

    return c.json({ success: true, message: 'Invitation sent' });

  } catch (error) {
      console.error('❌ Invite error:', error);
      return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /auth/change-email
 * Request email change
 */
app.post('/make-server-8714b62b/auth/change-email', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const { new_email } = await c.req.json();
    if (!new_email) return c.json({ success: false, error: 'New email required' }, 400);

    // Generate Link for NEW email
    const { data, error } = await supabase.auth.admin.generateLink({
        type: 'email_change_new',
        email: new_email, 
        newEmail: new_email,
        options: {
            redirectTo: `${c.req.header('origin')}/profile`
        }
    });

    if (error) throw error;
    
    await sendEmail({
        to: new_email,
        subject: 'Confirm Email Change',
        html: getChangeEmailAddressEmail(data.properties.action_link)
    });
    
    return c.json({ success: true, message: 'Confirmation sent to new email' });

  } catch (e) {
      console.error('❌ Change email error:', e);
      return c.json({ success: false, error: String(e) }, 500);
  }
});

/**
 * POST /auth/reset-password
 * Request password reset using Supabase Auth
 */
app.post('/make-server-8714b62b/auth/reset-password', async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    console.log('🔐 Password reset request for:', email);

    if (!email) {
      return c.json({
        success: false,
        error: 'Email is required'
      }, 400);
    }

    const origin = c.req.header('Origin') || 'https://app.borderpayafrica.com';
    
    // Generate Recovery Link via Admin (to send via Resend)
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${origin}/reset-password-confirm`,
      }
    });

    if (error) {
      console.error('❌ Password reset generation error:', error);
      // Still return success to mask error/existence
    } else if (data.properties?.action_link) {
       // Send via Resend
       await sendEmail({
         to: email,
         subject: 'Reset Your Password',
         html: getPasswordResetEmail(data.properties.action_link),
       });
       console.log('✅ Password reset email sent via Resend to:', email);
    }

    return c.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    });

  } catch (error) {
    console.error('❌ Password reset request error:', error);
    return c.json({
      success: false,
      error: 'Internal server error: ' + String(error)
    }, 500);
  }
});

/**
 * POST /auth/reset-password/confirm
 * Confirm password reset with new password
 */
app.post('/make-server-8714b62b/auth/reset-password/confirm', async (c) => {
  try {
    const body = await c.req.json();
    const { access_token, new_password } = body;

    console.log('🔐 Confirming password reset');

    if (!access_token || !new_password) {
      return c.json({
        success: false,
        error: 'Access token and new password are required'
      }, 400);
    }

    if (new_password.length < 12) {
      return c.json({
        success: false,
        error: 'Password must be at least 12 characters'
      }, 400);
    }
    
    // Clean token
    const cleanToken = access_token.trim().replace(/^Bearer\s+/i, '');
    console.log(`🔐 Validating token (len=${cleanToken.length}): ${cleanToken.substring(0, 10)}...`);

    // Verify access token and get user ID
    const { data: userData, error: tokenError } = await supabase.auth.getUser(cleanToken);
    
    if (tokenError || !userData.user) {
         console.error('❌ Invalid access token:', tokenError);
         
         // Specific error for malformed JWT
         if (tokenError?.message?.includes('invalid number of segments')) {
             return c.json({ success: false, error: 'Invalid token format. Please retry the link.' }, 401);
         }
         
         return c.json({ success: false, error: 'Invalid or expired token' }, 401);
    }

    // Update password using Admin API (since client is Service Role)
    const { error } = await supabase.auth.admin.updateUserById(
      userData.user.id,
      { password: new_password }
    );

    if (error) {
      console.error('❌ Password update failed:', error);
      return c.json({
        success: false,
        error: 'Failed to update password: ' + error.message
      }, 400);
    }

    console.log('✅ Password reset successfully');
    
    return c.json({
      success: true,
      message: 'Password reset successfully. You can now sign in with your new password.'
    });

  } catch (error) {
    console.error('❌ Password reset confirm error:', error);
    return c.json({
      success: false,
      error: 'Internal server error: ' + String(error)
    }, 500);
  }
});

/**
 * POST /auth/otp/send
 * Generate and send OTP for verification/reauthentication
 */
app.post('/make-server-8714b62b/auth/otp/send', async (c) => {
  try {
    const body = await c.req.json();
    const { email, purpose = 'verification' } = body;

    console.log(`🔐 OTP send request for ${email} (${purpose})`);

    if (!email) {
      return c.json({ success: false, error: 'Email is required' }, 400);
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store in one_time_tokens table (durable, survives cold starts)
    const tokenId = `otp_${email}_${Date.now()}`;
    try {
      await db.deleteOneTimeTokenByEmail(email, purpose);
      await db.insertOneTimeToken({
        id: tokenId,
        token: code,
        email,
        purpose,
        expires_at: new Date(expiresAt).toISOString(),
        created_at: new Date().toISOString(),
      });
    } catch (dbErr: any) {
      console.error('Failed to store OTP in DB:', dbErr.message);
    }

    // 🔒 SECURITY: Never log plaintext OTP codes — removed 2026-03-14.

    // Send via Resend
    const emailResult = await sendEmail({
      to: email,
      subject: 'Your Verification Code',
      html: getReauthenticationEmail(code),
    });

    if (!emailResult.success) {
      console.error('❌ Failed to send OTP email:', emailResult.error);
      return c.json({ success: false, error: 'Failed to send email' }, 500);
    }

    console.log('✅ OTP sent successfully to:', email);

    return c.json({
      success: true,
      message: 'Verification code sent to your email',
      expires_in: 600 // seconds
    });

  } catch (error) {
    console.error('❌ OTP send error:', error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /auth/otp/verify
 * Verify provided OTP
 */
app.post('/make-server-8714b62b/auth/otp/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { email, code } = body;

    console.log(`🔐 OTP verify request for ${email}`);

    if (!email || !code) {
      return c.json({ success: false, error: 'Email and code are required' }, 400);
    }

    // Retrieve from one_time_tokens table (Postgres)
    const storedOtp = await db.getOneTimeTokenByEmail(email, 'verification')
      || await db.getOneTimeTokenByEmail(email, 'reauthentication');

    if (!storedOtp) {
      return c.json({ success: false, error: 'Invalid or expired code' }, 400);
    }

    // Check expiration
    const expiresAt = storedOtp.expires_at ? new Date(storedOtp.expires_at).getTime() : 0;
    if (Date.now() > expiresAt) {
      await db.deleteOneTimeToken(storedOtp.id);
      return c.json({ success: false, error: 'Code has expired' }, 400);
    }

    // Check match
    if (storedOtp.token !== code) {
      return c.json({ success: false, error: 'Invalid code' }, 400);
    }

    // Success - consume OTP
    await db.deleteOneTimeToken(storedOtp.id);
    
    console.log('✅ OTP verified successfully for:', email);

    return c.json({
      success: true,
      message: 'Verification successful'
    });

  } catch (error) {
    console.error('❌ OTP verify error:', error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============================================================================
// USER ROUTES
// ============================================================================

/**
 * GET /user/profile
 * Returns full user profile merged from Data Base + Supabase Auth metadata
 */
app.get('/make-server-8714b62b/user/profile', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

    let userProfile = await db.getProfile(auth.userId);

    // Auto-heal: if Postgres profile is missing, rebuild from Supabase Auth metadata
    if (!userProfile) {
      console.warn(`⚠️ No Postgres profile found for user ${auth.userId}, attempting auto-heal...`);
      try {
        const { data: { user: authUser }, error: authErr } = await supabase.auth.admin.getUserById(auth.userId);
        if (authErr || !authUser) {
          return c.json({ success: false, error: 'User not found' }, 404);
        }
        const result = await initializeUserInDb(auth.userId, authUser.email!, {
          full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || 'BorderPay User',
          country: authUser.user_metadata?.country || 'UNKNOWN',
          account_type: authUser.user_metadata?.account_type || 'individual',
          phone: authUser.user_metadata?.phone || authUser.phone || '',
          primary_currency: authUser.user_metadata?.primary_currency || 'USD',
        });
        userProfile = result.profile;
        console.log('✅ Profile auto-healed from Supabase Auth metadata');
      } catch (healError) {
        console.error('❌ Auto-heal failed:', healError);
        return c.json({ success: false, error: 'Profile not found and could not be auto-healed' }, 404);
      }
    }

    // Merge with live Supabase Auth data (email, confirmation status, last sign-in)
    try {
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(auth.userId);
      if (authUser) {
        userProfile = {
          ...userProfile,
          email: authUser.email || userProfile.email,
          email_confirmed: !!authUser.email_confirmed_at,
          last_sign_in_at: authUser.last_sign_in_at || null,
          phone: userProfile.phone || authUser.user_metadata?.phone || authUser.phone || '',
          full_name: userProfile.full_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
          two_factor_enabled: userProfile.two_factor_enabled ?? (authUser.factors && authUser.factors.length > 0),
        };
      }
    } catch (authMergeError) {
      console.warn('⚠️ Could not merge Supabase Auth data into profile:', authMergeError);
    }

    // Refresh profile picture signed URL if path exists but URL is missing
    if (userProfile.profile_picture_path && !userProfile.profile_picture_url) {
      try {
        const { data: signedUrlData } = await supabase.storage
          .from(PROFILE_PICTURES_BUCKET)
          .createSignedUrl(userProfile.profile_picture_path, 31536000);
        if (signedUrlData?.signedUrl) {
          userProfile.profile_picture_url = signedUrlData.signedUrl;
          await db.updateProfile(auth.userId, { profile_picture_url: signedUrlData.signedUrl });
          console.log('✅ Refreshed profile picture signed URL');
        }
      } catch (picError) {
        console.warn('⚠️ Could not refresh profile picture URL:', picError);
      }
    }

    return c.json({ success: true, data: { user: userProfile } });

  } catch (error) {
    console.error('❌ Get profile error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /users/profile  (alias -> same as /user/profile for backward compatibility)
 */
app.get('/make-server-8714b62b/users/profile', async (c) => {
  const auth = await verifyAuth(c.req.header('Authorization'));
  if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

  let userProfile = await db.getProfile(auth.userId);
  if (!userProfile) return c.json({ success: false, error: 'User not found' }, 404);

  try {
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(auth.userId);
    if (authUser) {
      userProfile = {
        ...userProfile,
        email: authUser.email || userProfile.email,
        email_confirmed: !!authUser.email_confirmed_at,
        last_sign_in_at: authUser.last_sign_in_at || null,
        phone: userProfile.phone || authUser.user_metadata?.phone || authUser.phone || '',
        full_name: userProfile.full_name || authUser.user_metadata?.full_name || '',
      };
    }
  } catch (_) { /* non-critical */ }

  return c.json({ success: true, data: { user: userProfile } });
});

/**
 * PUT /user/profile
 * Updates Data Base profile AND syncs back to Supabase Auth user_metadata
 */
app.put('/make-server-8714b62b/user/profile', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const userProfile = await db.getProfile(auth.userId);

    if (!userProfile) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Only allow safe fields to be updated
    const allowedFields = ['full_name', 'phone', 'address', 'city', 'country', 'postal_code', 'date_of_birth', 'language', 'timezone'];
    const safeUpdates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) safeUpdates[field] = body[field];
    }

    // 1. Persist to Postgres
    const updatedProfile = await db.updateProfile(auth.userId, safeUpdates);
    console.log('✅ Profile updated in Postgres for user:', auth.userId);

    // 2. Sync relevant fields back to Supabase Auth user_metadata
    try {
      await supabase.auth.admin.updateUserById(auth.userId, {
        user_metadata: {
          full_name: updatedProfile.full_name,
          phone: updatedProfile.phone,
          country: updatedProfile.country,
          date_of_birth: updatedProfile.date_of_birth,
          language: updatedProfile.language,
          timezone: updatedProfile.timezone,
        },
      });
      console.log('✅ Profile synced to Supabase Auth user_metadata for user:', auth.userId);
    } catch (syncError) {
      console.warn('⚠️ Could not sync profile to Supabase Auth metadata (non-critical):', syncError);
    }

    return c.json({ success: true, data: { user: updatedProfile } });

  } catch (error) {
    console.error('❌ Update profile error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /user/profile-picture
 * Upload profile picture
 */
app.post('/make-server-8714b62b/user/profile-picture', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    
    if (!auth) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({
        success: false,
        error: 'No file provided'
      }, 400);
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return c.json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.'
      }, 400);
    }

    // Validate file size (5MB max)
    if (file.size > 5242880) {
      return c.json({
        success: false,
        error: 'File too large. Maximum size is 5MB.'
      }, 400);
    }

    console.log('📸 Uploading profile picture for user:', auth.userId);

    // Delete old profile picture if exists
    const userProfile = await db.getProfile(auth.userId);
    if (userProfile?.profile_picture_path) {
      try {
        await supabase.storage.from(PROFILE_PICTURES_BUCKET).remove([userProfile.profile_picture_path]);
        console.log('🗑️ Deleted old profile picture');
      } catch (error) {
        console.warn('⚠️ Could not delete old profile picture:', error);
      }
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${auth.userId}_${Date.now()}.${fileExt}`;
    const filePath = `profile-pictures/${fileName}`;

    // Convert File to ArrayBuffer then to Uint8Array
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(PROFILE_PICTURES_BUCKET)
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      return c.json({
        success: false,
        error: 'Failed to upload profile picture: ' + uploadError.message
      }, 500);
    }

    console.log('✅ Profile picture uploaded:', filePath);

    // Create signed URL (valid for 1 year)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(PROFILE_PICTURES_BUCKET)
      .createSignedUrl(filePath, 31536000); // 1 year in seconds

    if (signedUrlError) {
      console.error('❌ Signed URL error:', signedUrlError);
      return c.json({
        success: false,
        error: 'Failed to generate image URL: ' + signedUrlError.message
      }, 500);
    }

    // Update user profile with picture URL and path
    await db.updateProfile(auth.userId, {
      profile_picture_url: signedUrlData.signedUrl,
      profile_picture_path: filePath,
    });

    console.log('✅ Profile picture saved for user:', auth.userId);

    return c.json({
      success: true,
      data: {
        profile_picture_url: signedUrlData.signedUrl,
        message: 'Profile picture uploaded successfully'
      }
    });

  } catch (error) {
    console.error('❌ Profile picture upload error:', error);
    return c.json({
      success: false,
      error: 'Internal server error: ' + String(error)
    }, 500);
  }
});

/**
 * DELETE /user/profile-picture
 * Delete profile picture
 */
app.delete('/make-server-8714b62b/user/profile-picture', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    
    if (!auth) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const userProfile = await db.getProfile(auth.userId);

    if (!userProfile?.profile_picture_path) {
      return c.json({
        success: false,
        error: 'No profile picture found'
      }, 404);
    }

    console.log('🗑️ Deleting profile picture for user:', auth.userId);

    // Delete from storage
    const { error: deleteError } = await supabase.storage
      .from(PROFILE_PICTURES_BUCKET)
      .remove([userProfile.profile_picture_path]);

    if (deleteError) {
      console.error('❌ Delete error:', deleteError);
      // Continue anyway to update profile
    }

    // Update user profile
    await db.updateProfile(auth.userId, {
      profile_picture_url: null,
      profile_picture_path: null,
    });

    console.log('✅ Profile picture deleted for user:', auth.userId);

    return c.json({
      success: true,
      message: 'Profile picture deleted successfully'
    });

  } catch (error) {
    console.error('❌ Profile picture delete error:', error);
    return c.json({
      success: false,
      error: 'Internal server error: ' + String(error)
    }, 500);
  }
});

/**
 * POST /user/kyc
 * Submit KYC documents
 */
app.post('/make-server-8714b62b/user/kyc', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    
    if (!auth) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { id_front, id_back, selfie } = body;

    console.log('📄 KYC submission for user:', auth.userId);

    if (!id_front || !id_back || !selfie) {
      return c.json({
        success: false,
        error: 'All KYC documents are required'
      }, 400);
    }

    // Get user profile from Postgres
    const userProfile = await db.getProfile(auth.userId);

    if (!userProfile) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Store KYC documents in Postgres (only Storage paths, not base64)
    // NOTE: In production, upload id_front/id_back/selfie to Supabase Storage
    // and store only the paths here. For now, store metadata only.
    await db.upsertKycDocument({
      user_id: auth.userId,
      id_front_path: 'pending_upload', // Should be Storage path
      id_back_path: 'pending_upload',
      selfie_path: 'pending_upload',
      status: 'pending',
      submitted_at: new Date().toISOString(),
    });

    // Update user profile with KYC status
    const updatedProfile = await db.updateProfile(auth.userId, {
      kyc_status: 'pending',
    });

    console.log('✅ KYC documents submitted successfully');

    return c.json({
      success: true,
      message: 'KYC documents submitted successfully. We will review within 1-2 business days.',
      data: {
        kyc_status: 'pending',
        user: updatedProfile
      }
    });

  } catch (error) {
    console.error('❌ KYC submission error:', error);
    return c.json({
      success: false,
      error: 'Internal server error during KYC submission'
    }, 500);
  }
});

/**
 * GET /user/kyc
 * Get KYC status and documents
 */
app.get('/make-server-8714b62b/user/kyc', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    
    if (!auth) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const kycData = await db.getKycDocument(auth.userId);

    if (!kycData) {
      return c.json({
        success: true,
        data: {
          kyc_status: 'not_started',
          message: 'No KYC documents submitted yet'
        }
      });
    }

    // Don't send full images in response, just metadata
    const kycResponse = {
      user_id: kycData.user_id,
      status: kycData.status,
      submitted_at: kycData.submitted_at,
      reviewed_at: kycData.reviewed_at,
      reviewer_notes: kycData.reviewer_notes,
      has_id_front: !!kycData.id_front_path,
      has_id_back: !!kycData.id_back_path,
      has_selfie: !!kycData.selfie_path,
    };

    return c.json({
      success: true,
      data: kycResponse
    });

  } catch (error) {
    console.error('❌ Get KYC error:', error);
    return c.json({
      success: false,
      error: 'Internal server error'
    }, 500);
  }
});

// ============================================================================
// FINANCIAL ROUTES REMOVED
// ============================================================================
// All financial operations (wallets, transactions, cards, accounts, transfers,
// payments, exchange, beneficiaries, etc.) are handled by standalone Supabase
// Edge Functions deployed separately via Supabase CLI. This Hono server handles
// ONLY non-financial, non-sensitive operations.
//
// Frontend calls standalone Edge Functions DIRECTLY:
//   apiCall('verify-pin')          -> https://xxx.supabase.co/functions/v1/verify-pin
//   apiCall('maplerad-get-card')   -> https://xxx.supabase.co/functions/v1/maplerad-get-card
//   apiCall('create-card')         -> https://xxx.supabase.co/functions/v1/create-card
//   apiCall('activate-wallets')    -> https://xxx.supabase.co/functions/v1/activate-wallets
//   apiCall('fx')                  -> https://xxx.supabase.co/functions/v1/fx
//   etc. (29 Maplerad functions total)
//
// This Hono server handles ONLY:
//   - Auth (signup, signin, signout, session, password reset, OTP, magic link)
//   - User profile (GET/PUT, profile picture)
//   - KYC document submission
//   - Notifications feed
//   - Chat / support
//   - Preferences & settings
//   - Session monitoring
//   - Email hooks
// ============================================================================

// ============================================================================
// NON-FINANCIAL ROUTE MOUNTS (kept in Hono)
// ============================================================================

createSettingsRoutes(app, verifyAuth);
createChatRoutes(app, verifyAuth);
createPreferencesRoutes(app, verifyAuth);
createNotificationFeedRoutes(app, verifyAuth);

// Session monitoring (device & location tracking)
app.route('/make-server-8714b62b/session', session);

// User profile (non-financial — name, email, phone, profile picture)
app.route('/make-server-8714b62b/direct/user', userProfileDirect);

/**
 * Handle password reset token exchange
 * Supports both PKCE code and Access Token
 * Supports POST for direct password update
 */
const resetPasswordHandler = async (c: any) => {
  try {
    let token = c.req.query('token');
    let body: any = {};
    
    if (c.req.method === 'POST') {
        body = await c.req.json().catch(() => ({}));
        token = body.token || token;
    }
    
    if (!token) {
      return c.json({ success: false, error: 'Token is required' }, 400);
    }

    console.log(`🔄 Exchanging token for session (len=${token.length})...`);

    // 1. Try exchanging as PKCE code first (Public Client)
    // Only if NOT trying to update password directly (PKCE code is one-time use)
    if (!body.password) {
        const { data: codeData, error: codeError } = await supabaseAnon.auth.exchangeCodeForSession(token);

        if (codeData.session) {
           console.log('✅ Token exchanged for session successfully (PKCE)');
           return c.json({
             access_token: codeData.session.access_token,
             refresh_token: codeData.session.refresh_token,
             user: codeData.user
           });
        }
    }

    // 2. If PKCE failed or skipped, check if it's already an access token (Implicit/Legacy)
    // We use the ADMIN client (supabase) to verify the token because if it's a user token, 
    // we want to ensure it's valid.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    
    if (userData.user) {
        console.log('✅ Token is a valid access token');
        
        // If password is provided, update it now (Server-side Reset)
        if (body.password) {
             console.log('🔐 Performing server-side password update...');
             const { error: updateError } = await supabase.auth.admin.updateUserById(
                 userData.user.id, 
                 { password: body.password }
             );
             if (updateError) {
                 console.error('❌ Server-side update failed:', updateError);
                 return c.json({ success: false, error: updateError.message }, 400);
                 }
                 console.log('✅ Password updated successfully via server');
                 return c.json({ success: true, message: 'Password updated successfully' });
             }

        return c.json({
            access_token: token,
            refresh_token: '', // No refresh token available, but access token allows update
            user: userData.user
        });
    }

    console.error('❌ Token exchange failed. User error:', userError?.message);
    
    return c.json({ 
      success: false, 
      error: 'Invalid token or expired link',
      details: {
        token_error: userError?.message
      }
    }, 401);

  } catch (error) {
    console.error('❌ Reset password confirm error:', error);
    return c.json({ success: false, error: 'Internal server error: ' + String(error) }, 500);
  }
};

/**
 * GET /reset-password-confirm
 * Exchange recovery token/code for session
 * Maps to multiple paths to ensure accessibility
 */
app.get('/make-server-8714b62b/reset-password-confirm', resetPasswordHandler);
app.get('/reset-password-confirm', resetPasswordHandler);
app.post('/make-server-8714b62b/reset-password-confirm', resetPasswordHandler);
app.post('/reset-password-confirm', resetPasswordHandler);

// ============================================================================
// EMAIL HOOK ROUTE
// ============================================================================
// Mounted late to avoid capturing other routes if wildcard is used
app.route('/', emailHook);

// ============================================================================
// DASHBOARD DATA ROUTES (Postgres read-only — fallback for standalone Edge Fns)
// ============================================================================

/**
 * POST /get-wallets
 * Returns user wallets from Postgres wallets table
 */
app.post('/make-server-8714b62b/get-wallets', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (auth.error === 'TOKEN_EXPIRED') {
      return c.json({ success: false, error: 'TOKEN_EXPIRED' }, 401);
    }

    console.log('💰 Getting wallets for user:', auth.userId);
    const wallets = await db.getWallets(auth.userId);

    return c.json({
      success: true,
      data: { wallets: wallets || [] },
    });
  } catch (error) {
    console.error('❌ Get wallets error:', error);
    return c.json({ success: false, error: 'Failed to fetch wallets' }, 500);
  }
});

/**
 * POST /get-security-status
 * Returns user security status (PIN, 2FA) from Postgres
 */
app.post('/make-server-8714b62b/get-security-status', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (auth.error === 'TOKEN_EXPIRED') {
      return c.json({ success: false, error: 'TOKEN_EXPIRED' }, 401);
    }

    console.log('🔒 Getting security status for user:', auth.userId);
    const profile = await db.getProfile(auth.userId);

    return c.json({
      success: true,
      data: {
        pin_set: profile?.pin_hash ? true : false,
        two_factor_enabled: profile?.two_factor_enabled || false,
        kyc_status: profile?.kyc_status || 'pending',
        kyc_level: profile?.kyc_level || 0,
        is_unlocked: profile?.is_unlocked || false,
      },
    });
  } catch (error) {
    console.error('❌ Get security status error:', error);
    return c.json({ success: false, error: 'Failed to fetch security status' }, 500);
  }
});

/**
 * POST /log-stablecoin-transaction
 * Records a stablecoin deposit/send/receive to dedicated stablecoin_transactions table.
 */
app.post('/make-server-8714b62b/log-stablecoin-transaction', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (auth.error === 'TOKEN_EXPIRED') {
      return c.json({ success: false, error: 'TOKEN_EXPIRED' }, 401);
    }

    const body = await c.req.json();
    const { type, currency, amount, network, address, tx_hash, status, reference, description, metadata } = body;

    if (!type || !currency) {
      return c.json({ success: false, error: 'Missing required fields: type, currency' }, 400);
    }

    const txRecord = {
      user_id: auth.userId,
      type: type,
      currency: currency,
      amount: amount || 0,
      status: status || 'pending',
      network: network || 'SOLANA',
      address: address || null,
      tx_hash: tx_hash || null,
      reference: reference || `stbl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description: description || `Stablecoin ${type} - ${currency}`,
      metadata: metadata || {},
      created_at: new Date().toISOString(),
    };

    console.log('🪙 Logging stablecoin transaction:', txRecord.type, txRecord.currency, txRecord.amount);
    const savedTx = await db.insertStablecoinTransaction(txRecord);

    return c.json({
      success: true,
      data: { transaction_id: savedTx?.id || txRecord.reference, ...savedTx },
    });
  } catch (error) {
    console.error('❌ Log stablecoin transaction error:', error);
    return c.json({ success: false, error: `Failed to log stablecoin transaction: ${error}` }, 500);
  }
});

/**
 * POST /get-stablecoin-transactions
 * Returns stablecoin transactions for the current user from dedicated stablecoin_transactions table.
 */
app.post('/make-server-8714b62b/get-stablecoin-transactions', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (auth.error === 'TOKEN_EXPIRED') {
      return c.json({ success: false, error: 'TOKEN_EXPIRED' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const limit = body.limit || 20;
    const offset = body.offset || 0;
    const currency = body.currency;

    console.log('🪙 Getting stablecoin transactions for user:', auth.userId, { limit, offset, currency });

    const result = await db.getStablecoinTransactions(auth.userId, { limit, offset, currency });

    return c.json({
      success: true,
      data: {
        transactions: result.transactions,
        total_count: result.total_count,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('❌ Get stablecoin transactions error:', error);
    return c.json({ success: false, error: 'Failed to fetch stablecoin transactions' }, 500);
  }
});

/**
 * POST /get-transactions-list
 * Returns paginated transactions from Postgres
 */
app.post('/make-server-8714b62b/get-transactions-list', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (auth.error === 'TOKEN_EXPIRED') {
      return c.json({ success: false, error: 'TOKEN_EXPIRED' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const limit = body.limit || 10;
    const offset = body.offset || 0;

    console.log('📋 Getting transactions for user:', auth.userId, { limit, offset });
    const transactions = await db.getTransactions(auth.userId, limit, offset);
    const totalCount = await db.getTransactionCount(auth.userId);

    return c.json({
      success: true,
      data: {
        transactions: transactions || [],
        total_count: totalCount || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('❌ Get transactions error:', error);
    return c.json({ success: false, error: 'Failed to fetch transactions' }, 500);
  }
});

/**
 * POST /get-cards
 * Returns user's virtual cards from Postgres cards table
 * If card_id is provided, returns a single card; otherwise returns all cards.
 */
app.post('/make-server-8714b62b/get-cards', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (auth.error === 'TOKEN_EXPIRED') {
      return c.json({ success: false, error: 'TOKEN_EXPIRED' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const cardId = body.card_id;

    if (cardId) {
      console.log('💳 Getting card detail:', cardId);
      const card = await db.getCardById(cardId);
      if (!card) {
        return c.json({ success: false, error: 'Card not found' }, 404);
      }
      return c.json({ success: true, data: card });
    }

    console.log('💳 Getting all cards for user:', auth.userId);
    const cards = await db.getCards(auth.userId);

    return c.json({
      success: true,
      data: { cards: cards || [] },
    });
  } catch (error) {
    console.error('❌ Get cards error:', error);
    return c.json({ success: false, error: 'Failed to fetch cards' }, 500);
  }
});

// ============================================================================
// CATCH ALL
// ============================================================================

app.all('*', (c) => {
  console.log('❌ 404 Not Found:', c.req.method, c.req.url);
  return c.json({
    success: false,
    error: 'Endpoint not found',
    method: c.req.method,
    path: c.req.url,
    message: 'The requested endpoint does not exist'
  }, 404);
});

// ============================================================================
// START SERVER
// ============================================================================

console.log('🚀 BorderPay Africa backend v4.0 starting...');
console.log('📍 Environment check:', {
  hasSupabaseUrl: !!SUPABASE_URL,
  hasAnonKey: !!SUPABASE_ANON_KEY,
  hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY,
});
// ============================================================================
// SmileID Callback Handler (replaces standalone edge function)
// POST: Initiate SmileID verification / receive webhook callbacks
// GET:  Poll verification status from KV store
// ============================================================================

app.post('/make-server-8714b62b/smile-callback-handler', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    console.log('😊 SmileID POST request:', { userId: auth.userId, job_id: body.job_id, product: body.product });

    const SMILEID_API_KEY = Deno.env.get('SMILEID_API_KEY');
    const SMILEID_PARTNER_ID = Deno.env.get('SMILEID_PARTNER_ID');

    if (!SMILEID_API_KEY || !SMILEID_PARTNER_ID) {
      console.error('❌ SmileID credentials not configured');
      return c.json({ success: false, error: 'SmileID not configured' }, 500);
    }

    // Generate SmileID web link for biometric KYC
    const jobId = body.job_id || `kyc-${auth.userId}-${Date.now()}`;

    // Store pending verification in KV
    await kv.set(`smile_kyc:${auth.userId}`, JSON.stringify({
      job_id: jobId,
      status: 'pending',
      product: body.product || 'biometric_kyc',
      created_at: new Date().toISOString(),
    }));

    // Call SmileID API to create hosted web session
    try {
      const smileRes = await fetch('https://api.smileidentity.com/v2/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SMILEID_API_KEY}`,
        },
        body: JSON.stringify({
          partner_id: SMILEID_PARTNER_ID,
          job_id: jobId,
          user_id: auth.userId,
          job_type: 11, // Enhanced KYC + Biometric
          callback_url: `${SUPABASE_URL}/functions/v1/make-server-8714b62b/smile-webhook`,
          partner_params: {
            job_id: jobId,
            user_id: auth.userId,
            job_type: 11,
          },
          ...(body.partner_details ? { partner_details: body.partner_details } : {}),
          ...(body.customization ? { customization: body.customization } : {}),
        }),
      });

      const smileData = await smileRes.json();
      console.log('😊 SmileID API response:', smileData);

      if (!smileRes.ok) {
        return c.json({ success: false, error: smileData.error || 'SmileID API error', data: smileData }, smileRes.status);
      }

      return c.json({ success: true, data: smileData });
    } catch (smileErr: any) {
      console.error('❌ SmileID API call failed:', smileErr.message);
      return c.json({ success: false, error: `SmileID API unreachable: ${smileErr.message}` }, 502);
    }
  } catch (error: any) {
    console.error('❌ SmileID handler error:', error);
    return c.json({ success: false, error: error.message || 'Internal server error' }, 500);
  }
});

app.get('/make-server-8714b62b/smile-callback-handler', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth || !auth.userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const userId = c.req.query('userId') || auth.userId;
    console.log('😊 SmileID status poll for user:', userId);

    const stored = await kv.get(`smile_kyc:${userId}`);
    if (!stored) {
      return c.json({ success: true, status: 'not_started' });
    }

    const data = JSON.parse(stored);
    return c.json({ success: true, status: data.status, data });
  } catch (error: any) {
    console.error('❌ SmileID status poll error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// SmileID webhook (server-to-server callback)
app.post('/make-server-8714b62b/smile-webhook', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    console.log('😊 SmileID webhook received:', JSON.stringify(body).slice(0, 500));

    const userId = body.partner_params?.user_id || body.user_id;
    const resultCode = body.ResultCode || body.result_code;
    const resultText = body.ResultText || body.result_text;

    if (!userId) {
      console.error('❌ SmileID webhook: no user_id in payload');
      return c.json({ success: false, error: 'Missing user_id' }, 400);
    }

    // Determine verification status
    const isVerified = resultCode === '1020' || resultCode === '0810' || resultCode === '0820';
    const status = isVerified ? 'verified' : 'failed';

    // Update KV store
    const existing = await kv.get(`smile_kyc:${userId}`);
    const data = existing ? JSON.parse(existing) : {};
    await kv.set(`smile_kyc:${userId}`, JSON.stringify({
      ...data,
      status,
      result_code: resultCode,
      result_text: resultText,
      verified_at: isVerified ? new Date().toISOString() : undefined,
      webhook_received_at: new Date().toISOString(),
    }));

    // Update user profile KYC status
    if (isVerified) {
      try {
        const profile = await db.getProfile(userId);
        if (profile) {
          await db.updateProfile(userId, { kyc_status: 'verified', kyc_level: 2 });
        }
      } catch (e) {
        console.error('❌ SmileID webhook: profile update failed:', e);
      }
    }

    console.log(`😊 SmileID webhook processed: user=${userId} status=${status}`);
    return c.json({ success: true });
  } catch (error: any) {
    console.error('❌ SmileID webhook error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});



console.log('✅ Server ready to accept requests');

Deno.serve(app.fetch);
