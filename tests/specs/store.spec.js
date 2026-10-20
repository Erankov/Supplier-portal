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
      const w = JSON.parse(localStorage.getItem('demo_world_v2'));
      const db = w.dbs[0];
      const store = db.stores.find(s => s.name === 'מרכול השכונה');
      const o = db.orders.find(x => x.store_id === store.id && x.status === 'new');
      o.status = 'cancelled';
      localStorage.setItem('demo_world_v2', JSON.stringify(w));
      return o.number;
    });
    await page.reload();
    const modal = page.locator('.modal');
    await expect(modal).toContainText('הזמנה מספר ' + num);
    await expect(modal).toContainText('בוטלה על ידי הספק');
    await expect(modal).toContainText('נא ליצור קשר עם קלין פרו ציוד ניקוי');
    await modal.getByRole('button', { name: 'הבנתי' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.plist li').first()).toBeVisible();
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('הדגמה: 5 ספקים ו-2 חנויות, ומעבר ביניהם בלחיצה', async ({ page }) => {
    await openDemo(page, 'store');
    const sw = page.getByLabel('צפייה בתור');
    await expect(sw.locator('option')).toHaveCount(7);
    // "My suppliers" shows all 5 suppliers for the store.
    await page.getByRole('link', { name: 'הספקים שלי' }).click();
    await expect(page.locator('.shop-top .count')).toHaveText('5');
    // Switch to the second store, then to a supplier.
    await sw.selectOption({ label: 'סופר הדר' });
    await expect(page.locator('.shop-brand')).toContainText('סופר הדר');
    await page.getByLabel('צפייה בתור').selectOption({ label: 'משקאות הצפון' });
    await expect(page.locator('.side, .admin-main').first()).toBeVisible();
    await expect(page.getByLabel('צפייה בתור')).toHaveValue('s3');
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
    const row = supplier.locator('tr.ord', { hasText: 'מרכול השכונה' }).filter({ has: supplier.locator('.s-new') }).first();
    await row.click();
    await expect(supplier.getByRole('heading', { name: 'הזמנה ' + number })).toBeVisible();
    await expect(supplier.locator('.page')).toContainText('בלי מדבקות');
    await expect(supplier.locator('.page')).toContainText('בדיקה אוטומטית');
  });

  test('לכל ספק עגלה משלו: מעבר בין ספקים לא מערבב את העגלות', async ({ page }, testInfo) => {
    await openDemo(page, 'store');
    const toSupplier = async name => {
      await page.getByRole('link', { name: /הספקים שלי/ }).click();
      await page.locator('.sup-page .st-card', { hasText: name }).locator('.st-head').click();
      await expect(page.locator('.shop-brand')).toContainText(name);
      await expect(page.locator('.plist li').first()).toBeVisible();
    };
    await product(page, '6295-753').getByRole('button', { name: /הוספת/ }).click();
    await toSupplier('משקאות הצפון');
    let cart = await openCart(page, testInfo);
    await expect(cart).not.toContainText('6295-753');
    await page.reload();
    await expect(page.locator('.plist li').first()).toBeVisible();
    await product(page, '301').getByRole('button', { name: /הוספת/ }).click();
    await toSupplier('קלין פרו ציוד ניקוי');
    cart = await openCart(page, testInfo);
    await expect(cart).toContainText('סבון כללי 1 ליטר');
    await expect(cart).not.toContainText('קולה');
  });

  test('ההזמנות שלי: הזמנה חוזרת', async ({ page }, testInfo) => {
    await openDemo(page, 'store', 'history');
    await page.locator('.my-orders .chips button', { hasText: 'קלין פרו ציוד ניקוי' }).click();
    const order = page.locator('.hist .card').first();
    await order.locator('.hist-row').click();
    await expect(order.locator('.hist-lines li').first()).toBeVisible();
    const lines = await order.locator('.hist-lines li').count();
    await order.getByRole('button', { name: /הזמנה חוזרת/ }).click();
    const cart = await openCart(page, testInfo);
    await expect(cart.locator('.clist li')).toHaveCount(lines);
  });

  test('ההזמנות שלי: הזמנות פעילות מכל הספקים עם סטטוס, והיסטוריה עם סינון לפי ספק', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByRole('link', { name: 'ההזמנות שלי' }).click();
    const box = page.locator('.my-orders');
    // Open orders from all 5 suppliers, each with its status at the supplier.
    const act = box.locator('.hist.act > li');
    await expect(act.first()).toBeVisible();
    for (const name of ['קלין פרו ציוד ניקוי', 'מאפיית לחם הארץ', 'מחלבת גליל', 'משקאות הצפון', 'פרי וירק אחים לוי'])
      await expect(act.filter({ hasText: name }).first()).toBeVisible();
    await expect(act.first().locator('.badge')).toHaveText(/חדשה|נקלטה/);
    await expect(act.first().locator('.st-txt')).toContainText('הספק');
    // History stays closed until tapped (2.12).
    await expect(box.locator('.hist.old')).toHaveCount(0);
    const tog = box.getByRole('button', { name: /היסטוריה/ });
    await expect(tog).toHaveAttribute('aria-expanded', 'false');
    await tog.click();
    await expect(box.locator('.hist.old > li').first()).toBeVisible();
    // Filter by one supplier, then back to all.
    const chips = box.locator('.chips button');
    await expect(chips).toHaveCount(6);
    const all = await box.locator('.hist > li').count();
    await chips.filter({ hasText: 'מחלבת גליל' }).click();
    const rows = box.locator('.hist > li');
    for (const t of await rows.allInnerTexts()) expect(t).toContain('מחלבת גליל');
    await chips.filter({ hasText: 'הכל' }).click();
    await expect(rows).toHaveCount(all);
    // An order of another supplier offers to switch to it instead of copying it into this cart.
    await chips.filter({ hasText: 'משקאות הצפון' }).click();
    await rows.first().locator('.hist-row').click();
    await expect(rows.first().getByRole('button', { name: 'מעבר למשקאות הצפון' })).toBeVisible();
  });

  test('ההזמנה הקבועה שלי ממלאת את העגלה כמו בפעם הקודמת', async ({ page }, testInfo) => {
    await openDemo(page, 'store');
    const reg = page.locator('.reg');
    await expect(reg.getByText('ההזמנה הקבועה שלי')).toBeVisible();
    const items = reg.locator('.rlist li');
    // Closed until tapped (2.14), and stays open on this device after a reload.
    await expect(items.first()).toBeHidden();
    await reg.locator('summary').click();
    // Wait until it is open (and remembered) before reloading; on a busy machine the reload could come first.
    await expect(items.first()).toBeVisible();
    await page.reload();
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
    await supplier.locator('tr.ord', { hasText: 'מרכול השכונה' }).filter({ has: supplier.locator('.s-new') }).first().click();
    await expect(supplier.getByRole('heading', { name: 'הזמנה ' + number })).toBeVisible();
    const line = supplier.locator('tbody tr', { hasText: '6295-753' });
    await expect(line).toContainText('קרטון אחד + 2 יחידות');
    await expect(line.locator('td').last()).toContainText('420');
  });

  test('הספקים שלי: רואים את הספקים שהחנות מחוברת אליהם', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByRole('link', { name: /הספקים שלי/ }).click();
    await expect(page.getByRole('heading', { name: 'הספקים שלי' })).toBeVisible();
    await expect(page.locator('.sup-page .st-card')).toHaveCount(5);
    const card = page.locator('.sup-page .st-card', { hasText: 'מזמינים ממנו עכשיו' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('קלין פרו ציוד ניקוי');
    await expect(card).toContainText('מזמינים ממנו עכשיו');
    await expect(page.getByText('עובדים עם ספק נוסף?')).toBeVisible();
    await card.locator('.st-head').click();
    await expect(page.locator('.plist li').first()).toBeVisible();
  });

  test('הספקים שלי: פרטי הקשר של כל ספק וכמה קניתם ממנו החודש', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByRole('link', { name: /הספקים שלי/ }).click();
    const card = page.locator('.sup-page .st-card', { hasText: 'מחלבת גליל' });
    await expect(card.locator('.sup-stats')).toContainText(/קניתם החודש: ₪[\d,.]+ · \d+ הזמנות/);
    await expect(card.getByRole('link', { name: '04-6987654' })).toHaveAttribute('href', 'tel:046987654');
    await expect(card).toContainText('מושב עמיעד');
    await expect(card).toContainText('שעות פעילות');
  });

  test('פרטי העסק שלי: מייל וטלפון לא תקינים לא נשמרים, ותקינים נשמרים', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByRole('link', { name: 'החשבון שלי' }).click();
    const biz = page.getByRole('region', { name: 'פרטי העסק שלי' });
    await expect(biz).toContainText('הרצל 45, רמת גן');
    await biz.getByRole('button', { name: 'עריכה' }).click();
    await biz.getByLabel('מייל').fill('dana@gmail');
    await biz.getByLabel('טלפון').fill('12345');
    await biz.getByRole('button', { name: 'שמירה' }).click();
    await expect(biz.getByText('המייל לא תקין')).toBeVisible();
    await expect(biz.getByText('מספר הטלפון לא תקין')).toBeVisible();
    await expect(biz.getByLabel('טלפון')).toHaveAttribute('aria-invalid', 'true');
    await biz.getByLabel('מייל').fill('dana@gmail.com');
    await biz.getByLabel('טלפון').fill('+972 54-765-4321');
    await biz.getByLabel('שעות פעילות').fill('א׳-ו׳ 6:00-23:00');
    await biz.getByRole('button', { name: 'שמירה' }).click();
    await expect(biz.getByRole('link', { name: '+972 54-765-4321' })).toBeVisible();
    // Saved for this business at every supplier, and kept after a reload.
    await page.reload();
    await expect(page.getByRole('region', { name: 'פרטי העסק שלי' })).toContainText('א׳-ו׳ 6:00-23:00');
  });

  test('הצטרפות לספק: חובה למלא פרטי עסק תקינים', async ({ page }) => {
    // The join page has no demo bar, so set up the demo here instead of openDemo.
    await page.addInitScript(() => { try { sessionStorage.setItem('demo_role', 'store'); localStorage.setItem('pending_invite', 'DEMO01'); } catch {} });
    await page.goto('/?demo');
    await expect(page.getByRole('heading', { name: 'הצטרפות לספק' })).toBeVisible();
    await expect(page.getByLabel('מייל')).not.toHaveValue('');
    await page.getByLabel('טלפון').fill('050-123');
    await page.getByRole('button', { name: 'הצטרפות' }).click();
    await expect(page.locator('.field-err', { hasText: 'מספר הטלפון לא תקין' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'הצטרפות לספק' })).toBeVisible();
    await page.getByLabel('טלפון').fill('03-6123456');
    await page.getByRole('button', { name: 'הצטרפות' }).click();
    await expect(page.getByText('הצטרפתם בהצלחה')).toBeVisible();
  });

  test('תפריט עם שמות, החלפת ספק מלמעלה, והתנתקות רק אחרי אישור', async ({ page }, testInfo) => {
    await openDemo(page, 'store');
    const menu = page.getByRole('navigation', { name: 'תפריט' });
    for (const name of ['הזמנה', 'ההזמנות שלי', 'הספקים שלי', 'החשבון שלי'])
      await expect(menu.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    if (isPhone(testInfo)) {
      // On a phone the menu is a bar fixed to the bottom, with the cart bar above it.
      const box = await menu.boundingBox();
      expect(box.y + box.height).toBeGreaterThan(page.viewportSize().height - 5);
      const cart = await page.locator('.cart-bar').boundingBox();
      expect(cart.y + cart.height).toBeLessThanOrEqual(box.y + 1);
    }
    await expect(page.locator('.shop-top')).toContainText('מזמינים בשם מרכול השכונה');
    await page.getByRole('link', { name: 'החלפת ספק' }).click();
    await expect(page.getByRole('heading', { name: 'הספקים שלי' })).toBeVisible();
    await menu.getByRole('link', { name: 'החשבון שלי' }).click();
    await expect(page.getByRole('heading', { name: 'החשבון שלי' })).toBeVisible();
    await page.getByRole('button', { name: 'התנתקות מהחשבון' }).click();
    const ask = page.getByRole('dialog', { name: 'אישור' });
    await ask.getByRole('button', { name: 'חזרה' }).click();
    await expect(page.getByRole('heading', { name: 'החשבון שלי' })).toBeVisible();
    await page.getByRole('button', { name: 'התנתקות מהחשבון' }).click();
    await page.getByRole('dialog', { name: 'אישור' }).getByRole('button', { name: 'התנתקות' }).click();
    await expect(page.getByRole('button', { name: /כניסה כחנות/ })).toBeVisible();
  });

  test('בטלפון כפתור החזרה סוגר את העגלה ולא יוצא מהמסך', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'בדיקה לטלפון בלבד');
    await openDemo(page, 'store');
    await page.getByRole('link', { name: 'ההזמנות שלי' }).click();
    await page.getByRole('link', { name: 'הזמנה', exact: true }).click();
    await page.locator('.cart-bar').click();
    await expect(page.locator('.cart.up')).toHaveCount(1);
    await page.goBack();
    await expect(page.locator('.cart.up')).toHaveCount(0);
    await expect(page.locator('.plist li').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('.my-orders')).toBeVisible();
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
