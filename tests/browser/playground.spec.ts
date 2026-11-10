import { test, expect } from '@playwright/test';

test('enter, move, interact, pause, change settings and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter playground' })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/playground-menu.png' });
  await page.getByRole('button', { name: 'Enter playground' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.keyboard.press('F3');
  await expect(page.locator('#diagnostics')).toContainText('Grounded');
  await page.keyboard.down('KeyW');
  await expect(page.locator('#prompt')).toContainText('caretaker', { timeout: 10000 });
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: 'artifacts/playground-world.png' });
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: 'The caretaker' })).toBeVisible();
  await page.getByRole('button', { name: 'Where am I?' }).click();
  await expect(page.locator('#speech')).toContainText('An old courtyard');
  await page.getByRole('button', { name: 'Back to exploring' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  // Browser-level Escape releases pointer lock; explicitly exercise that event in automation.
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByLabel('Rendering quality').selectOption('low');
  await page.getByLabel('Show collision bounds').check();
  await page.getByRole('button', { name: 'Return to spawn' }).click();
  await expect(page.locator('#diagnostics')).toContainText('0.00, 0.00, 8.00');
  await page.getByRole('button', { name: 'Resume exploring' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('#diagnostics')).toContainText('Airborne');
  await expect(page.locator('#diagnostics')).toContainText('Grounded');
  expect(errors).toEqual([]);
});
