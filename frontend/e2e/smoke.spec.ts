import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAs } from './fixtures/auth';

test('admin can reach the dashboard via dev-login', async ({ page }) => {
  await loginAs(page, 'admin');
  await expect(page).toHaveURL(/\/app/);
});

test('login page has no critical/serious a11y violations', async ({ page }) => {
  // Measure the settled page: mid-entrance the card is half transparent and
  // axe reports its text as low contrast. Reduce Motion skips the entrance.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(
    page.getByRole('button', { name: /client certificate|Client-Zertifikat/i }),
  ).toBeVisible();
  // Wait for finite entrance animations only; looping ones (spinners) never end.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    console.log(
      'A11y violations on /login:',
      JSON.stringify(
        blocking.map((v) => ({ id: v.id, impact: v.impact, description: v.description })),
        null,
        2,
      ),
    );
  }
  expect(blocking).toEqual([]);
});
