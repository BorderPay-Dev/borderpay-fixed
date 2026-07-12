import { expect, test, type Page } from '@playwright/test';

function installRuntimeCrashGuard(page: Page): string[] {
  const fatalErrors: string[] = [];

  page.on('pageerror', (error) => {
    fatalErrors.push(error?.message || String(error));
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/referenceerror|can't find variable|is not defined|borderpay error report/i.test(text)) {
      fatalErrors.push(text);
    }
  });

  return fatalErrors;
}

async function expectNoRuntimeCrash(page: Page, fatalErrors: string[]) {
  await expect(page.getByText(/BorderPay Error Report/i)).toHaveCount(0);
  expect(fatalErrors, fatalErrors.join('\n')).toEqual([]);
}

async function openAsReturningVisitor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('borderpay_onboarding_done', 'true');
    localStorage.setItem('borderpay_skip_splash_once_ts', String(Date.now()));
  });
  await page.goto('/?skip_splash=1');
}

test('login screen renders without runtime crash', async ({ page }) => {
  const fatalErrors = installRuntimeCrashGuard(page);

  await openAsReturningVisitor(page);

  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await expect(page.getByText(/Sign in to continue/i)).toBeVisible();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sign In$/i })).toBeVisible();

  await expectNoRuntimeCrash(page, fatalErrors);
});

test('signup screen renders from login without runtime crash', async ({ page }) => {
  const fatalErrors = installRuntimeCrashGuard(page);

  await openAsReturningVisitor(page);
  await page.getByRole('button', { name: /Sign Up/i }).click();

  await expect(page.getByRole('button', { name: /Create Account/i })).toBeVisible();
  await expect(page.getByText(/Full Name/i)).toBeVisible();
  await expect(page.getByText(/Country of Residence/i)).toBeVisible();
  await expect(page.getByText(/Already have an account/i)).toBeVisible();

  await expectNoRuntimeCrash(page, fatalErrors);
});
