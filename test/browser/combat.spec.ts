import {test,expect} from '@playwright/test';
test('combat HUD runs damage, atomic healing with lost response, bow and mobile layout',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/combat');
 const hp=page.getByRole('progressbar',{name:'Вы: Здоровье',exact:true});await expect(hp).toHaveAttribute('value','100');
 await page.getByRole('button',{name:'Страж: быстрый удар',exact:true}).click();await page.getByRole('button',{name:'Вперёд на 1 секунду',exact:true}).click();await expect(hp).toHaveAttribute('value','78');
 let dropped=false;
 await page.route('**/api/combat',async route=>{const input=route.request().postDataJSON();if(input.operation==='use'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:/Зелье лечения/}).click();await expect(page.getByRole('button',{name:'Повторить запрос',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Повторить запрос',exact:true}).click();await expect(hp).toHaveAttribute('value','100');await expect(page.getByRole('button',{name:/Зелье лечения/})).toContainText('×5');
 await page.getByRole('button',{name:'Вперёд на 1 секунду',exact:true}).click();await page.getByRole('combobox',{name:'Оружие',exact:true}).selectOption('bow');await page.getByRole('button',{name:'Надеть',exact:true}).click();await page.getByRole('button',{name:'Вперёд на 1 секунду',exact:true}).click();
 await page.getByRole('button',{name:'Быстрый удар',exact:true}).click();await page.getByRole('button',{name:'Вперёд на 1 секунду',exact:true}).click();await expect(page.getByRole('progressbar',{name:'Страж: Здоровье',exact:true})).toHaveAttribute('value','74');await expect(page.getByText(/Стрелы: 29/)).toBeVisible();
 await page.screenshot({path:'test-results/combat-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/combat-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
test('failed combined projection pauses HUD until readback retry; recovery closes the raid',async({page})=>{
 await page.goto('/combat');await page.getByText('Проверка сбоя и сохранения',{exact:true}).click();await page.getByRole('button',{name:'Имитировать сбой',exact:true}).click();
 await page.getByRole('button',{name:'Быстрый удар',exact:true}).click();await expect(page.getByText('Мир заморожен',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Быстрый удар',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Восстановить состояние',exact:true}).click();await expect(page.getByText('Готов',{exact:true})).toBeVisible();await expect(page.getByText(/Стрелы: 28/)).toBeVisible();
 await page.getByRole('button',{name:'Закрыть рейд с восстановлением',exact:true}).click();await expect(page.getByText('Рейд закрыт',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Вперёд на 1 секунду',exact:true})).toBeDisabled();
});
