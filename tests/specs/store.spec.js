const { test, expect, openDemo, shekels, isPhone } = require('./helpers');

const product = (page, sku) => page.locator('.plist li', { hasText: sku });

// On a phone the cart is a sheet that opens from the bottom bar.
async function openCart(page, testInfo) {
  if (isPhone(testInfo) && !(await page.locator('.cart').getAttribute('class')).includes('up')) {
    await page.locator('.cart-bar').click();
    await expect(page.locator('.cart')).toHaveClass(/up/);
  }
  return page.locator('.cart-panel');
}

test.describe('חנות', () => {
  test('חיפוש מוצר לפי שם או מק״ט', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByLabel('חיפוש מוצר').fill('6295-753');
    await expect(page.locator('.plist li')).toHaveCount(1);
    await expect(page.locator('.plist li')).toContainText('סבון כללי 1 ליטר');
    await page.getByLabel('חיפוש מוצר').fill('פילטר');
    await expect(page.locator('.plist li').first()).toContainText('פילטר');
  });

  test('סינון לפי קטגוריה', async ({ page }) => {
    await openDemo(page, 'store');
    await page.locator('.chips button', { hasText: 'קיטור' }).click();
    await expect(page.locator('.group-h')).toHaveCount(1);
    await expect(page.locator('.group-h')).toHaveText('קיטור');
  });

  test('הוספה לעגלה, שינוי כמות וחישוב הסכום', async ({ page }, testInfo) => {
    await openDemo(page, 'store');
    await product(page, '6295-753').getByRole('button', { name: /הוספת/ }).click();
    await product(page, '6295-743').getByRole('button', { name: /הוספת/ }).click();
    const first = product(page, '6295-753');
    await expect(first).toHaveClass(/in/);
    await first.getByRole('button', { name: 'עוד אחד' }).click();
    await expect(first.locator('.stepper input')).toHaveValue('2');
    // 2 × ₪60 + 1 × ₪65
    const cart = await openCart(page, testInfo);
    await expect(cart.locator('.clist li')).toHaveCount(2);
    await expect.poll(async () => shekels(await cart.locator('.cart-total b').innerText())).toBe(185);
    await cart.getByRole('button', { name: 'ריקון' }).click();
    await page.locator('.modal').getByRole('button', { name: 'ריקון' }).click();
    await expect(cart.locator('.clist li')).toHaveCount(0);
  });

  test('שליחת הזמנה עם הערות מגיעה לספק', async ({ page, context }, testInfo) => {
    await openDemo(page, 'store');
    await product(page, '6295-753').getByRole('button', { name: /הוספת/ }).click();
    const cart = await openCart(page, testInfo);
    await cart.getByRole('button', { name: 'הוספת הערה' }).click();
    await cart.getByPlaceholder('הערה לפריט').fill('בלי מדבקות');
    await cart.getByPlaceholder('למשל: לשלוח עד יום חמישי').fill('בדיקה אוטומטית');
    await cart.getByRole('button', { name: 'שליחת ההזמנה' }).click();
    await expect(page.getByText('ההזמנה נשלחה')).toBeVisible();
    const number = (await page.getByText(/הזמנה מספר \d+/).innerText()).match(/\d+/)[0];

    const supplier = await context.newPage();
    await openDemo(supplier, 'admin');
    const row = supplier.locator('tr.ord', { hasText: 'חנות לדוגמה' }).filter({ has: supplier.locator('.s-new') }).first();
    await row.click();
    await expect(supplier.getByRole('heading', { name: 'הזמנה ' + number })).toBeVisible();
    await expect(supplier.locator('.page')).toContainText('בלי מדבקות');
    await expect(supplier.locator('.page')).toContainText('בדיקה אוטומטית');
  });

  test('הזמנות קודמות והזמנה חוזרת', async ({ page }, testInfo) => {
    await openDemo(page, 'store', 'history');
    const order = page.locator('.hist .card').first();
    await order.locator('.hist-row').click();
    await expect(order.locator('.hist-lines li').first()).toBeVisible();
    const lines = await order.locator('.hist-lines li').count();
    await order.getByRole('button', { name: /הזמנה חוזרת/ }).click();
    const cart = await openCart(page, testInfo);
    await expect(cart.locator('.clist li')).toHaveCount(lines);
  });

  test('ההזמנה הקבועה שלי ממלאת את העגלה כמו בפעם הקודמת', async ({ page }, testInfo) => {
    await openDemo(page, 'store');
    const reg = page.locator('.reg');
    await expect(reg.getByText('ההזמנה הקבועה שלי')).toBeVisible();
    const items = reg.locator('.rlist li');
    // Only the first 4 show until asked for more.
    await expect(items).toHaveCount(4);
    await reg.getByRole('button', { name: /עוד \d+ מוצרים/ }).click();
    const n = await items.count();
    expect(n).toBeGreaterThan(4);
    const last = Number((await items.first().locator('.last').innerText()).match(/\d+/)[0]);
    await reg.getByRole('button', { name: 'למלא כמו בפעם הקודמת' }).click();
    await expect(reg.getByRole('button', { name: /כבר כמו בפעם הקודמת/ })).toBeDisabled();
    await expect(items.first().locator('.stepper input')).toHaveValue(String(last));
    const cart = await openCart(page, testInfo);
    await expect(cart.locator('.clist li')).toHaveCount(n);
  });

  test('כמות: הקלדה, הוצאה מהעגלה וביטול', async ({ page }) => {
    await openDemo(page, 'store');
    const item = product(page, '6295-753');
    await item.getByRole('button', { name: /הוספת/ }).click();
    const box = item.locator('.stepper input');
    await expect(box).toHaveAttribute('inputmode', 'numeric');

    // Clearing the box to type a new amount does not drop the product.
    await box.fill('');
    await box.blur();
    await expect(box).toHaveValue('1');
    await box.fill('7');
    await box.press('Enter');
    await expect(box).toHaveValue('7');

    // Minus at 1 is a remove button, and the toast offers to undo it.
    await box.fill('1');
    await box.blur();
    await item.getByRole('button', { name: 'הוצאה מהעגלה' }).click();
    await expect(item).not.toHaveClass(/in/);
    await page.getByRole('button', { name: 'ביטול' }).click();
    await expect(item.locator('.stepper input')).toHaveValue('1');
  });

  test('מועדפים', async ({ page }) => {
    await openDemo(page, 'store');
    const star = product(page, '6295-753').locator('.fav');
    await star.click();
    await expect(star).toHaveClass(/on/);
    await page.locator('.chips button', { hasText: 'מועדפים' }).click();
    await expect(page.locator('.plist li')).toHaveCount(1);
  });

  test('בטלפון הדף לא רחב מהמסך', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'בדיקה לטלפון בלבד');
    await openDemo(page, 'store');
    for (const hash of ['', 'history']) {
      await page.goto('/?demo#/' + hash);
      await expect(page.locator('.shop-top')).toBeVisible();
      const [doc, screen] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(doc).toBeLessThanOrEqual(screen);
    }
  });
});
