import { resolveSignupCaptchaConfig, signupCaptchaAssessmentFailure } from "../supabase/functions/_shared/signup-captcha-config.ts";
const legacy = { RECAPTCHA_ENTERPRISE_PROJECT_ID: "partner-project", RECAPTCHA_ENTERPRISE_API_KEY: "partner-secret", RECAPTCHA_ENTERPRISE_SITE_KEY: "partner-site" };
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
Deno.test("signup credentials are kept together without changing partner configuration", () => {
 const env = { ...legacy, SIGNUP_RECAPTCHA_ENTERPRISE_CONFIG: JSON.stringify({project_id:"signup-project",api_key:"signup-secret",site_key:"signup-site"}) };
 const result = resolveSignupCaptchaConfig(env);
 assert(result.valid && result.projectId === "signup-project" && result.apiKey === "signup-secret" && result.siteKey === "signup-site", "Wrong signup configuration");
 assert(env.RECAPTCHA_ENTERPRISE_PROJECT_ID === "partner-project" && env.RECAPTCHA_ENTERPRISE_API_KEY === "partner-secret", "Shared configuration changed");
});
Deno.test("malformed dedicated configuration fails closed instead of using legacy credentials", () => {
 for (const raw of ["", "invalid", "null", "[]", "{}", '{"project_id":"signup-project","api_key":"","site_key":"site"}']) {
  const result = resolveSignupCaptchaConfig({...legacy,SIGNUP_RECAPTCHA_ENTERPRISE_CONFIG:raw});
  assert(!result.valid && !result.apiKey && !result.projectId, "Malformed configuration fell back");
 }
 assert(resolveSignupCaptchaConfig(legacy).projectId === "partner-project", "Legacy configuration was not preserved when override is absent");
});
Deno.test("provider failure is unavailable even if response claims token valid", () => {
 const result=signupCaptchaAssessmentFailure(false,true);
 assert(result?.status===503 && result.code==="captcha_unavailable", "Provider failure blamed on customer");
});
Deno.test("invalid and missing tokens remain denied; only valid assessments proceed", () => {
 for(const value of [false,undefined,null,"true",1])assert(signupCaptchaAssessmentFailure(true,value)?.status===400,"Invalid token accepted");
 assert(signupCaptchaAssessmentFailure(true,true)===null,"Valid token denied");
});
