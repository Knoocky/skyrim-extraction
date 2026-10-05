import { test, expect } from '@playwright/test';
test('trade and ambiguous reply retry preserve one purchase; character switch shows own wallet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?demo=1');
  await expect(page.getByText('0 золота', { exact: true })).toBeVisible();
  const traders = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Торговцы', exact: true }) });
  // Sell the three starter items; wait for each confirmed inventory update.
  for (let remaining = 3; remaining > 0; remaining--) {
    await traders.getByRole('button', { name: 'Продать 1', exact: true }).first().click();
    await expect(traders.getByRole('button', { name: 'Продать 1', exact: true })).toHaveCount(remaining - 1);
  }
  await expect(page.getByText('55 золота', { exact: true })).toBeVisible();
  let dropped = false;
  await page.route('**/api/intent', async route => {
    const input = route.request().postDataJSON();
    if (input.operation === 'buy' && !dropped) {
      dropped = true;
      await route.fetch(); // Commit on server, lose the HTTP reply.
      await route.abort('failed');
    } else await route.continue();
  });
  await traders.locator('li').filter({ hasText: 'Зелье лечения' }).getByRole('button', { name: 'Купить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить запрос' })).toBeVisible();
  await expect(page.getByRole('combobox')).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить запрос' }).click();
  await expect(page.getByText('35 золота', { exact: true })).toBeVisible();
  const stash = page.locator('section').filter({ has: page.getByRole('heading', { name: /Личный схрон/ }) });
  await expect(stash.locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Принять', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Сдать припасы' })).toBeDisabled();
  await page.getByRole('combobox').selectOption('bob');
  await expect(page.getByText('0 золота', { exact: true })).toBeVisible();
  await expect(stash.locator('li')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/economy-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/economy-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('materials can be crafted through UI and bankruptcy recovery cannot be sold', async ({ page, request }) => {
  await page.goto('/?demo=1');
  await page.getByRole('combobox').selectOption('bob');
  await expect(page.getByText('0 золота', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Выйти в экспедицию/ }).click();
  const pickup = page.getByRole('button', { name: 'Забрать', exact: true });
  for (let count = await pickup.count(); count > 0; count--) {
    await pickup.first().click();
    await expect(pickup).toHaveCount(count - 1);
  }
  await page.getByRole('button', { name: 'Имитировать выход' }).click();
  const traders = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Торговцы', exact: true }) });
  await traders.locator('li').filter({ hasText: 'Двемерская реликвия' }).getByRole('button', { name: 'Продать 1' }).click();
  await expect(page.getByText('120 золота', { exact: true })).toBeVisible();
  await page.locator('article').filter({ has: page.getByRole('heading', { name: /Мастерская/ }) }).getByRole('button', { name: /Улучшить/ }).click();
  await expect(page.getByText('20 золота', { exact: true })).toBeVisible();
  await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Приготовить зелье' }) }).getByRole('button', { name: 'Изготовить' }).click();
  await expect(page.getByText('18 золота', { exact: true })).toBeVisible();
  const state = await (await request.get('/api/state?player=bob')).json();
  expect(state.player.stash.filter((i: { template: string }) => i.template === 'mountain_herb').reduce((n: number, i: { quantity: number }) => n + i.quantity, 0)).toBe(6);
  // Lose every remaining stash item in an expedition; recovery must become available.
  const stash = page.locator('section').filter({ has: page.getByRole('heading', { name: /Личный схрон/ }) });
  for (const box of await stash.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: /Выйти в экспедицию/ }).click();
  await page.getByRole('button', { name: 'Имитировать смерть' }).click();
  await page.getByRole('button', { name: 'Получить аварийный меч' }).click();
  await expect(stash.getByText('Аварийный комплект · не для продажи')).toBeVisible();
  await expect(traders.getByRole('button', { name: 'Продать 1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Получить аварийный меч' })).toBeDisabled();
});
