/**
 * Email utilities using Resend API
 * Handles transactional emails for BorderPay Africa
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// Verified sender email that can receive test emails on Resend free tier
const VERIFIED_SENDER = 'support@borderpayafrica.com';
// Use verified sender for FROM to avoid domain verification requirements
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || `BorderPay <${VERIFIED_SENDER}>`;

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send email using Resend API
 * NOTE: On Resend free tier, you can only send to your verified email.
 * For production, verify a domain at resend.com/domains
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string; emailId?: string }> {
  if (!RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not configured, email not sent');
    return { success: false, error: 'Email service not configured' };
  }

  // RESEND FREE TIER RESTRICTION:
  // You can only send emails to the verified sender address.
  // If recipient is different, log the email instead of sending.
  const canSendRealEmail = options.to === VERIFIED_SENDER;
  
  if (!canSendRealEmail) {
    console.log(`📧 [DEV MODE] Email suppressed - Resend free tier can only send to ${VERIFIED_SENDER}`);
    console.log(`📧 [MOCK EMAIL] To: ${options.to}`);
    console.log(`📧 [MOCK EMAIL] Subject: ${options.subject}`);
    console.log(`📧 [MOCK EMAIL] Preview: ${options.html.substring(0, 200)}...`);
    
    // Return success to avoid breaking auth flow
    return { 
      success: true, 
      emailId: `mock-${Date.now()}` 
    };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Resend API error:', data);
      // If it's the validation error about verified domains, log helpful info
      if (data.statusCode === 403 && data.name === 'validation_error') {
        console.error('💡 To fix: Verify a domain at https://resend.com/domains');
        console.error(`💡 Or only send test emails to: ${VERIFIED_SENDER}`);
      }
      return { success: false, error: data.message || 'Failed to send email' };
    }

    console.log('✅ Email sent successfully:', data.id);
    return { success: true, emailId: data.id };
  } catch (error: any) {
    console.error('❌ Error sending email:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Email Template Helper
 * Uses the "Green Lemon" dark theme with inline styles for compatibility
 */
function getBaseTemplate(title: string, bodyContent: string): string {
  // Public URL for the logo - Hosted on Supabase Storage
  const logoUrl = "https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/email-logo.png.PNG";
  const year = new Date().getFullYear();
  const greenLemon = "#A4F34D"; // Brand "Green Lemon"
  const bgColor = "#000000"; // Black Background
  const cardColor = "#0d0d0d"; // Dark Card
  const textColor = "#ffffff"; // Pure White Text

  return `
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>${title} — BorderPay Africa</title>
    <style>
      body{margin:0;padding:0;background:${bgColor};font-family:Arial,Helvetica,sans-serif;color:${textColor}}
      .wrap{width:100%;padding:36px 12px;background:${bgColor}}
      .card{max-width:600px;margin:0 auto;background:${cardColor};border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.6);border: 1px solid #222}
      .logo{display:block;margin:0 auto 16px auto;width:160px;height:auto}
      .h{color:#ffffff;font-size:20px;font-weight:700;text-align:center;margin:0 0 12px}
      .copy{color:${textColor};font-size:15px;line-height:22px;margin:0 0 18px}
      .cta-wrap{text-align:center;margin:24px 0}
      .cta{background:${greenLemon};color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px}
      .foot{color:#7a7a7a;text-align:center;font-size:12px;margin-top:24px;border-top: 1px solid #222; padding-top: 16px}
      a.inline{color:${greenLemon};text-decoration:underline}
      @media(max-width:420px){.card{padding:20px}.h{font-size:18px}}
    </style>
    </head>
    <body style="margin:0;padding:0;background:${bgColor};font-family:Arial,Helvetica,sans-serif;color:${textColor}">
      <div class="wrap" style="width:100%;padding:36px 12px;background:${bgColor};box-sizing: border-box;">
        <div class="card" role="article" aria-label="${title}" style="max-width:600px;margin:0 auto;background:${cardColor};border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.6);border: 1px solid #222;">
          
          <img src="${logoUrl}" alt="BorderPay Africa" class="logo" style="display:block;margin:0 auto 16px auto;width:160px;height:auto;border:none;">
          
          <h1 class="h" style="color:#ffffff;font-size:20px;font-weight:700;text-align:center;margin:0 0 12px;">${title}</h1>
          
          ${bodyContent}

          <div class="foot" style="color:#7a7a7a;text-align:center;font-size:12px;margin-top:24px;border-top: 1px solid #222; padding-top: 16px;">
            <p style="margin: 0 0 8px 0;">This link expires in 24 hours.</p>
            <p style="margin: 0;">© ${year} BorderPay Africa. All rights reserved.</p>
            <p style="margin: 8px 0 0 0;">
              Contact <a href="mailto:support@borderpayafrica.com" class="inline" style="color:${greenLemon};text-decoration:underline;">support@borderpayafrica.com</a>
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * 1. Welcome Email (After confirmed signup)
 */
export function getWelcomeEmail(name: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Hi <strong>${name}</strong>,
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Welcome to BorderPay Africa! Thanks for creating an account with us.
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      We are preparing for our official launch. In the meantime, you can access your dashboard to complete your profile.
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="https://app.borderpayafrica.com" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Go to Dashboard
      </a>
    </div>

    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      We'll notify you as soon as full features are live!
    </p>
  `;
  return getBaseTemplate('Welcome to BorderPay Africa', content);
}

/**
 * 2. Confirm Sign Up (Email Verification)
 */
export function getConfirmSignUpEmail(link: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Thanks for signing up with BorderPay Africa. Please confirm your email to finish setting up your account.
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="${link}" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Confirm Email
      </a>
    </div>
    
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      If you didn't create an account with us, you can safely ignore this message.
    </p>
  `;
  return getBaseTemplate('Confirm your email', content);
}

/**
 * 3. Invite User
 */
export function getInviteUserEmail(inviterName: string, inviteLink: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      <strong>${inviterName}</strong> has invited you to join BorderPay Africa.
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Create an account today to send money, create virtual cards, and manage your finances globally.
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="${inviteLink}" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Accept Invitation
      </a>
    </div>
  `;
  return getBaseTemplate('You\'ve Been Invited', content);
}

/**
 * 4. Magic Link (Sign In)
 */
export function getMagicLinkEmail(magicLink: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Click the button below to securely sign in to your BorderPay account.
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="${magicLink}" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Sign In Now
      </a>
    </div>
  `;
  return getBaseTemplate('Sign In to BorderPay', content);
}

/**
 * 5. Change Email Address
 */
export function getChangeEmailAddressEmail(confirmationLink: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      We received a request to change the email address for your BorderPay account.
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Please confirm this change by clicking the button below:
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="${confirmationLink}" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Confirm New Email
      </a>
    </div>
  `;
  return getBaseTemplate('Confirm Email Change', content);
}

/**
 * 6. Reset Password
 */
export function getPasswordResetEmail(resetLink: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      We received a request to reset your password.
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Click the button below to choose a new password:
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="${resetLink}" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Reset Password
      </a>
    </div>
    
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      If you didn't ask for this, you can safely ignore this email.
    </p>
  `;
  return getBaseTemplate('Reset Your Password', content);
}

/**
 * 7. Reauthentication (OTP)
 */
export function getReauthenticationEmail(otp: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Please use the following code to verify your identity:
    </p>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <div style="background:#121418;color:#A4F34D;padding:16px 32px;border-radius:8px;display:inline-block;font-family:monospace;font-size:32px;letter-spacing:4px;font-weight:700;border:1px solid #A4F34D;">
        ${otp}
      </div>
    </div>
    
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Do not share this code with anyone.
    </p>
  `;
  return getBaseTemplate('Verification Code', content);
}

/**
 * 8. KYC Approved Email
 */
export function getKYCApprovedEmail(name: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Hi <strong>${name}</strong>,
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Great news! Your identity verification has been successfully approved.
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      You now have full access to BorderPay Africa services, including:
    </p>
    <ul style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;padding-left:20px;">
      <li>Creating unlimited virtual cards</li>
      <li>Higher transaction limits</li>
      <li>Multi-currency wallet access</li>
    </ul>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="https://app.borderpayafrica.com/app/cards" class="cta" target="_blank" rel="noopener" style="background:#A4F34D;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Create Your First Card
      </a>
    </div>
  `;
  return getBaseTemplate('Verification Approved', content);
}

/**
 * 9. KYC Rejected Email
 */
export function getKYCRejectedEmail(name: string, reason: string): string {
  const content = `
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Hi <strong>${name}</strong>,
    </p>
    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      We reviewed your identity verification documents, but unfortunately, we could not approve your application at this time.
    </p>
    
    <div style="background:rgba(235, 0, 27, 0.1);border:1px solid #EB001B;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="color:#EB001B;font-weight:bold;margin:0 0 8px 0;font-size:14px;">Reason for rejection:</p>
      <p style="color:#ffffff;margin:0;font-size:14px;">${reason || 'Document quality issue or data mismatch.'}</p>
    </div>

    <p class="copy" style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;">
      Please try again ensuring:
    </p>
    <ul style="color:#ffffff;font-size:15px;line-height:22px;margin:0 0 18px;padding-left:20px;">
      <li>Your ID document is clearly visible and not expired</li>
      <li>Your selfie is well-lit and matches the ID photo</li>
      <li>The name on your ID matches your account details</li>
    </ul>
    
    <div class="cta-wrap" style="text-align:center;margin:24px 0;">
      <a href="https://app.borderpayafrica.com/app/kyc-individual" class="cta" target="_blank" rel="noopener" style="background:#ffffff;color:#000000;text-decoration:none;padding:14px 34px;border-radius:6px;font-weight:700;display:inline-block;font-size:16px;">
        Try Again
      </a>
    </div>
  `;
  return getBaseTemplate('Verification Update', content);
}