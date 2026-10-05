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
  await traders.locator('li').filter({ has: page.getByText('Зелье лечения', { exact: true }) }).getByRole('button', { name: 'Купить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить запрос' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Персонаж', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить запрос' }).click();
  await expect(page.getByText('35 золота', { exact: true })).toBeVisible();
  const stash = page.locator('section').filter({ has: page.getByRole('heading', { name: /Личный схрон/ }) });
  await expect(stash.locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Принять', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Сдать припасы' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Персонаж', exact: true }).selectOption('bob');
  await expect(page.getByText('0 золота', { exact: true })).toBeVisible();
  await expect(stash.locator('li')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/economy-desktop-viewport.png' });
  await page.screenshot({ path: 'test-results/economy-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/economy-mobile-viewport.png' });
  await page.screenshot({ path: 'test-results/economy-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('materials can be crafted through UI and bankruptcy recovery cannot be sold', async ({ page, request }) => {
  await page.goto('/?demo=1');
  await page.getByRole('combobox', { name: 'Персонаж', exact: true }).selectOption('bob');
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

test('demo mission event remains provisional until extraction and reward claim', async ({ page, request }) => {
  await page.goto('/?demo=1');
  await page.getByRole('combobox', { name: 'Персонаж', exact: true }).selectOption('bob');
  const before = await (await request.get('/api/state?player=bob')).json();
  const mission = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Разведка руин', exact: true }) });
  await mission.getByRole('button', { name: 'Взять задание' }).click();
  await expect(mission.getByRole('button', { name: 'Получить награду' })).toBeDisabled();
  await page.getByRole('button', { name: /Выйти в экспедицию/ }).click();
  await mission.getByRole('button', { name: 'Имитировать событие задания' }).click();
  await expect(mission.getByText(/до выхода/)).toBeVisible();
  await expect(mission.getByRole('button', { name: 'Получить награду' })).toBeDisabled();
  await page.getByRole('button', { name: 'Имитировать выход' }).click();
  await mission.getByRole('button', { name: 'Получить награду' }).click();
  await expect(mission.getByText('Выполнен', { exact: true })).toBeVisible();
  const after = await (await request.get('/api/state?player=bob')).json();
  expect(after.player.progression.gold).toBe(before.player.progression.gold + 20);
});

test('keyboard search and a fresh character finish the full beacon chain', async ({page, request}) => {
  await page.goto('/?demo=1');
  await page.getByRole('combobox', { name: 'Персонаж', exact: true }).selectOption('cora');
  const search=page.getByLabel('Поиск в убежище');
  await search.focus(); await page.keyboard.type('zzzz');
  await expect(page.locator('.crafting article')).toHaveCount(0);
  await search.fill('');
  const chain=['Разведка руин','Опасный патруль','Возвращение лекаря','Страж руин','Заброшенная шахта','Главарь шахты','Спасение картографа','Запечатанное хранилище','Детали маяка','Последний маяк'];
  for(const [index,name] of chain.entries()) {
    const mission=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
    await mission.getByRole('button',{name:'Взять задание',exact:true}).click();
    if(name!=='Детали маяка') {
      await page.getByRole('button',{name:/Выйти в экспедицию/}).click();
      if(index===0) {
        const pickup=page.getByRole('button',{name:'Забрать',exact:true});
        for(let count=await pickup.count();count>0;count--) {await pickup.first().click();await expect(pickup).toHaveCount(count-1);}
      }
      const event=mission.getByRole('button',{name:'Имитировать событие задания'});
      // Wait for each confirmed response; a patrol needs two separate stable events.
      for(let i=0;i<(name==='Опасный патруль'||name==='Последний маяк'?2:1);i++) {
        await event.first().click();
        await expect(page.getByRole('status').filter({hasText:'Состояние подтверждено'})).toBeVisible();
      }
      await page.getByRole('button',{name:'Имитировать выход',exact:true}).click();
    }
    await mission.getByRole('button',{name:'Получить награду',exact:true}).click();
    await expect(mission.getByText('Выполнен',{exact:true})).toBeVisible();
  }
  await expect(page.getByText(/Маяк восстановлен/)).toBeVisible();
  const state=await (await request.get('/api/state?player=cora')).json();
  expect(state.player.progression.finaleCompleted).toBe(true);
  expect(state.player.progression.reputation).toBe(100);
  await page.getByRole('combobox', { name: 'Задания', exact: true }).selectOption('completed');
  await expect(page.getByRole('button',{name:'Взять задание',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:1280,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
