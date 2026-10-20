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
  test('כשהספק מבטל הזמנה, החנות מקבלת הודעה עד שלוחצת "הבנתי"', async ({ page }) => {
    await openDemo(page, 'store');
    await expect(page.locator('.plist li').first()).toBeVisible();
    await expect(page.locator('.modal')).toHaveCount(0);
    // The supplier cancels this store's open order (in the demo data).
    const num = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('demo_db_v1'));
      const store = db.stores.find(s => s.name === 'חנות לדוגמה');
      const o = db.orders.find(x => x.store_id === store.id && x.status === 'new');
      o.status = 'cancelled';
      localStorage.setItem('demo_db_v1', JSON.stringify(db));
      return o.number;
    });
    await page.reload();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('הזמנה מספר ' + num);
    await expect(modal).toContainText('בוטלה על ידי הספק');
    await expect(modal).toContainText('נא ליצור קשר עם ספק לדוגמה');
    await modal.getByRole('button', { name: 'הבנתי' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.plist li').first()).toBeVisible();
    await expect(page.locator('.modal')).toHaveCount(0);
  });

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

  test('קרטון: הצעה להשלים לקרטון, ומחיר קרטון + יחידות', async ({ page, context }, testInfo) => {
    await openDemo(page, 'store');
    const item = product(page, '6295-753');
    await expect(item.locator('.pk-badge')).toHaveText(/קרטון של 6 · ₪300/);
    await item.getByRole('button', { name: /הוספת/ }).click();
    const box = item.locator('.stepper input');

    // 4 of 6: offered to complete a carton, with the saving (6 x 60 - 300 = 60).
    await box.fill('4');
    await box.blur();
    const nudge = item.locator('.pk-nudge');
    await expect(nudge).toContainText('עוד 2');
    await expect(nudge).toContainText('₪60');
    await nudge.click();
    await expect(box).toHaveValue('6');
    await expect(item.locator('.pk-split')).toContainText('קרטון אחד · ₪300');

    // 8 = one carton + 2 units = 300 + 120.
    await box.fill('8');
    await box.blur();
    await expect(item.locator('.pk-split')).toContainText('קרטון אחד + 2 יחידות');
    await expect(item.locator('.pk-split')).toContainText('₪420');
    await expect(item.locator('.pk-nudge')).toHaveCount(0);
    const cart = await openCart(page, testInfo);
    await expect(cart.locator('.cart-total')).toContainText('₪420');
    await cart.getByRole('button', { name: 'שליחת ההזמנה' }).click();
    await expect(page.getByText('ההזמנה נשלחה')).toBeVisible();
    const number = (await page.getByText(/הזמנה מספר \d+/).innerText()).match(/\d+/)[0];

    // The supplier sees the carton split and the right total.
    const supplier = await context.newPage();
    await openDemo(supplier, 'admin');
    await supplier.locator('tr.ord', { hasText: 'חנות לדוגמה' }).filter({ has: supplier.locator('.s-new') }).first().click();
    await expect(supplier.getByRole('heading', { name: 'הזמנה ' + number })).toBeVisible();
    const line = supplier.locator('tbody tr', { hasText: '6295-753' });
    await expect(line).toContainText('קרטון אחד + 2 יחידות');
    await expect(line.locator('td').last()).toContainText('420');
  });

  test('הספקים שלי: רואים את הספקים שהחנות מחוברת אליהם', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByRole('link', { name: /הספקים שלי/ }).click();
    await expect(page.getByRole('heading', { name: 'הספקים שלי' })).toBeVisible();
    const card = page.locator('.sup-page .st-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('ספק לדוגמה');
    await expect(card).toContainText('מזמינים ממנו עכשיו');
    await expect(page.getByText('עובדים עם ספק נוסף?')).toBeVisible();
    await card.locator('.st-head').click();
    await expect(page.locator('.plist li').first()).toBeVisible();
  });

  test('בטלפון תיבות הטקסט בגודל 16 לפחות, כדי שהאייפון לא יגדיל את הדף', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'בדיקה לטלפון בלבד');
    await openDemo(page, 'store');
    await page.locator('.cart-bar').click();
    const small = await page.evaluate(() => [...document.querySelectorAll('input,textarea,select')]
      .filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.getAttribute('aria-label') || e.placeholder || e.tagName));
    expect(small).toEqual([]);
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
