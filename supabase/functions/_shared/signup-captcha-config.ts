type Env = Record<string, string | undefined>;
export type SignupCaptchaConfig = { projectId: string; apiKey: string; siteKey: string; valid: boolean };

export function resolveSignupCaptchaConfig(env: Env): SignupCaptchaConfig {
  const raw = env.SIGNUP_RECAPTCHA_ENTERPRISE_CONFIG;
  if (raw === undefined) {
    return {
      projectId: env.RECAPTCHA_ENTERPRISE_PROJECT_ID?.trim() || "",
      apiKey: env.RECAPTCHA_ENTERPRISE_API_KEY?.trim() || "",
      siteKey: env.RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() || "",
      valid: true,
    };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !["project_id", "api_key", "site_key"].every(
          key => typeof value[key] === "string" && value[key].trim().length > 0
        )) throw new Error("Invalid signup CAPTCHA configuration");
    return {
      projectId: value.project_id.trim(),
      apiKey: value.api_key.trim(),
      siteKey: value.site_key.trim(),
      valid: true,
    };
  } catch {
    // Never fall back to a different project's credentials on malformed configuration.
    return { projectId: "", apiKey: "", siteKey: "", valid: false };
  }
}

export function signupCaptchaAssessmentFailure(httpOk: boolean, tokenValid: unknown) {
  if (!httpOk) return {
    ok: false as const, status: 503, code: "captcha_unavailable",
    error: "Signup verification is temporarily unavailable. Please try again shortly.",
  };
  if (tokenValid !== true) return {
    ok: false as const, status: 400, code: "captcha_failed",
    error: "Signup verification could not be confirmed. Please try again.",
  };
  return null;
}
