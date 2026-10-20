const { test, expect, openDemo, isPhone } = require('./helpers');

const nav = (page, name) => page.locator('.side-links a', { hasText: name });

// A store card on the stores page, opened so its buttons show.
async function openStore(page, name) {
  const card = page.locator('.st-card', { hasText: name });
  const head = card.locator('.st-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  return card;
}

test.describe('ספק', () => {
  test('ההזמנות מוצגות עם ארבעת כרטיסי הסיכום', async ({ page }) => {
    await openDemo(page, 'admin');
    await expect(page.getByRole('heading', { name: 'הזמנות' })).toBeVisible();
    await expect(page.locator('.kpi')).toHaveCount(4);
    await expect(page.locator('tr.ord')).toHaveCount(3);
  });

  test('התפריט מוביל לכל המסכים', async ({ page }, testInfo) => {
    await openDemo(page, 'admin');
    if (isPhone(testInfo)) {
      // On a phone the menu is a bar fixed to the bottom of the screen.
      const box = await page.locator('.side').boundingBox();
      expect(box.y + box.height).toBeGreaterThan(page.viewportSize().height - 5);
    }
    for (const [link, heading] of [['חנויות', 'חנויות'], ['קטלוג ומחירים', 'קטלוג ומחירים'], ['החשבון שלי', 'החשבון שלי'], ['הזמנות', 'הזמנות']]) {
      await nav(page, link).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(nav(page, link)).toHaveClass(/on/);
    }
  });

  test('סינון הזמנות לפי סטטוס וחיפוש', async ({ page }) => {
    await openDemo(page, 'admin');
    await page.locator('.seg button', { hasText: 'חדשות' }).click();
    await expect(page.locator('tr.ord')).toHaveCount(1);
    await expect(page.locator('tr.ord .badge')).toHaveText('חדשה');
    await page.locator('.seg button', { hasText: 'הכל' }).click();
    await page.getByPlaceholder('חיפוש חנות או מספר הזמנה').fill('הדר');
    await expect(page.locator('tr.ord')).toHaveCount(1);
    await expect(page.locator('tr.ord')).toContainText('סופר הדר');
  });

  test('פתיחת הזמנה, סימון כנקלטה וביטול', async ({ page }) => {
    await openDemo(page, 'admin');
    await page.locator('tr.ord', { has: page.locator('.s-new') }).click();
    await expect(page.getByRole('heading', { name: /^הזמנה \d+$/ })).toBeVisible();
    await page.getByRole('button', { name: 'סימון כנקלטה' }).click();
    await expect(page.locator('.page .badge').first()).toHaveText('נקלטה');
    await page.getByRole('button', { name: 'ביטול הזמנה' }).click();
    await page.locator('.modal').getByRole('button', { name: 'ביטול ההזמנה' }).click();
    await expect(page.locator('.page .badge').first()).toHaveText('בוטלה');
    await page.getByRole('link', { name: 'כל ההזמנות' }).click();
    await expect(page.locator('tr.ord .s-cancelled')).toHaveCount(1);
  });

  test('קטלוג משלה לחנות עם מחיר מיוחד', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    await (await openStore(page, 'מרכול השכונה')).getByRole('button', { name: 'קטלוג ומחירים' }).click();
    const modal = page.locator('.modal');
    await modal.getByRole('button', { name: 'רק מוצרים שבחרתי' }).click();
    await modal.getByLabel('חיפוש בקטלוג החנות').fill('6295-7');
    await modal.getByRole('button', { name: 'סימון כל המוצרים ברשימה' }).click();
    await modal.getByLabel('חיפוש בקטלוג החנות').fill('6295-753');
    await modal.getByLabel(/^מחיר מיוחד:/).fill('50');
    await modal.getByRole('button', { name: 'שמירת הקטלוג' }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('.st-card', { hasText: 'מרכול השכונה' }).locator('.st-head')).toContainText('קטלוג משלה');

    // The store sees only the chosen products, at its own price.
    // (about:blank first, so that only the hash changing still reloads the app with the new role)
    await page.goto('about:blank');
    await openDemo(page, 'store');
    const items = page.locator('.plist li');
    await expect(items.first()).toBeVisible();
    for (const sku of await items.allInnerTexts()) expect(sku).toContain('6295-7');
    await expect(items.filter({ hasText: '6295-753' })).toContainText('₪50');

    // Back to the full catalog: everything shows again at the regular price.
    await page.goto('about:blank');
    await openDemo(page, 'admin', 'stores');
    await (await openStore(page, 'מרכול השכונה')).getByRole('button', { name: 'קטלוג ומחירים' }).click();
    await modal.getByRole('button', { name: 'כל הקטלוג' }).click();
    await modal.getByLabel('חיפוש בקטלוג החנות').fill('6295-753');
    await modal.getByLabel(/^מחיר מיוחד:/).fill('');
    await modal.getByRole('button', { name: 'שמירת הקטלוג' }).click();
    await expect(modal).toBeHidden();
    await page.goto('about:blank');
    await openDemo(page, 'store');
    await expect(page.locator('.plist li', { hasText: '6295-753' })).toContainText('₪60');
    await expect(page.locator('.plist li', { hasText: 'פילטר' }).first()).toBeVisible();
  });

  test('הוספת חנות חדשה', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    await page.getByRole('button', { name: 'הוספת חנות' }).click();
    const modal = page.locator('.modal');
    await modal.getByLabel('שם החנות').fill('חנות בדיקה');
    await modal.getByLabel('איש קשר').fill('יוסי');
    await modal.getByRole('button', { name: 'הוספה וקבלת קישור' }).click();
    await page.keyboard.press('Escape');
    await page.goto('/?demo#/stores');
    await expect(page.locator('.st-card', { hasText: 'חנות בדיקה' })).toContainText('יוסי');
  });

  test('חסימת חנות ושחרור', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    const card = await openStore(page, 'מרכול השכונה');
    const status = card.locator('.st-tags .badge').first();
    await card.getByRole('button', { name: 'חסימה' }).click();
    await expect(status).toHaveText('חסומה');
    await card.getByRole('button', { name: 'שחרור' }).click();
    await expect(status).toHaveText('פעילה');
  });

  test('חנויות ככרטיסים: לחיצה פותחת פרטים, קישור הצטרפות רק לחנות שעוד לא הצטרפה', async ({ page, context }) => {
    await openDemo(page, 'admin', 'stores');
    const cards = page.locator('.st-card');
    await expect(cards).toHaveCount(2);
    // Closed: no buttons yet, the first letter stands in for a picture.
    const card = cards.filter({ hasText: 'מרכול השכונה' });
    await expect(card.getByRole('button', { name: 'עריכה' })).toHaveCount(0);
    await expect(card.locator('img.st-pic')).toBeVisible();
    await openStore(page, 'מרכול השכונה');
    await expect(card.locator('.st-facts')).toContainText('הזמנות');
    // Someone already joined this store, so no join link; the second store has none yet.
    await expect(card.getByRole('button', { name: 'קישור הצטרפות' })).toHaveCount(0);
    // The supplier does not upload the store's picture.
    await expect(card.locator('input[type=file]')).toHaveCount(0);
    // Tapping again closes it.
    await card.locator('.st-head').click();
    await expect(card.getByRole('button', { name: 'עריכה' })).toHaveCount(0);
    await expect((await openStore(page, 'סופר הדר')).getByRole('button', { name: 'קישור הצטרפות' })).toBeVisible();

    // The store uploads its own picture, and the supplier sees it on the card.
    const shop = await context.newPage();
    await openDemo(shop, 'store', 'account');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await shop.getByLabel('התמונה של העסק שלי').setInputFiles({ name: 'shop.png', mimeType: 'image/png', buffer: png });
    await expect(shop.locator('.sup-me img.st-pic')).toBeVisible();
    // Still there after going to another tab and back.
    await shop.locator('a[href="#/history"]').click();
    await shop.locator('a[href="#/account"]').click();
    await expect(shop.locator('.sup-me img.st-pic')).toBeVisible();
    await page.reload();
    await expect(page.locator('.st-card', { hasText: 'מרכול השכונה' }).locator('img.st-pic')).toBeVisible();
  });

  test('חיפוש בקטלוג', async ({ page }) => {
    await openDemo(page, 'admin', 'catalog');
    await page.getByLabel('חיפוש מוצר').fill('RM 626');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('סבון כללי 1 ליטר');
  });

  test('קרטון: הספק מגדיר יחידות בקרטון ומחיר לקרטון', async ({ page, context }) => {
    await openDemo(page, 'admin', 'catalog');
    await page.getByLabel('חיפוש מוצר').fill('RM 610');
    await page.locator('tbody tr').getByRole('button', { name: 'עריכה' }).click();
    const modal = page.locator('.modal');
    await modal.getByLabel('יחידות בקרטון').fill('12');
    await modal.getByLabel('מחיר לקרטון שלם').fill('800');
    // 12 x 60 = 720, so 800 is not a deal and the supplier is told so.
    await expect(modal.locator('.pk-warn')).toBeVisible();
    await modal.getByLabel('מחיר לקרטון שלם').fill('600');
    await expect(modal.locator('.pk-ok')).toContainText('50');
    await modal.getByRole('button', { name: /שמירה/ }).click();
    await expect(modal).toBeHidden();

    const shop = await context.newPage();
    await openDemo(shop, 'store');
    await expect(shop.locator('.plist li', { hasText: '6295-750' }).locator('.pk-badge')).toHaveText(/קרטון של 12 · ₪600/);
  });

  test('מוצר שהוסתר לא מופיע לחנות', async ({ page, context }) => {
    await openDemo(page, 'admin', 'catalog');
    // The switch saves first and only then flips, so click it and wait for the new state.
    await page.getByLabel('הצגת סבון כללי 1 ליטר RM 626').click({ force: true });
    await expect(page.getByLabel('הצגת סבון כללי 1 ליטר RM 626')).not.toBeChecked();
    const shop = await context.newPage();
    await openDemo(shop, 'store');
    await expect(shop.locator('.plist li').first()).toBeVisible();
    await expect(shop.locator('.pname', { hasText: 'RM 626' })).toHaveCount(0);
  });

  test('בטלפון הדפים לא רחבים מהמסך', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'בדיקה לטלפון בלבד');
    await openDemo(page, 'admin');
    for (const link of ['הזמנות', 'חנויות', 'קטלוג ומחירים', 'החשבון שלי']) {
      await nav(page, link).click();
      await expect(page.locator('.page h1')).toBeVisible();
      const [doc, screen] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(doc, `רוחב הדף במסך ${link}`).toBeLessThanOrEqual(screen);
    }
  });

  test('בטלפון צר הדף לא זז לצדדים, ורק התפריט למטה נגלל', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'בדיקה לטלפון בלבד');
    // Narrower than the menu, like a small phone or bigger text.
    await page.setViewportSize({ width: 240, height: 700 });
    await openDemo(page, 'admin');
    await expect(page.locator('.page h1')).toBeVisible();
    const r = await page.evaluate(() => {
      window.scrollTo(200, 0);
      const s = document.querySelector('.side');
      s.scrollLeft = -200;
      return { page: window.scrollX, wide: s.scrollWidth > s.clientWidth, menu: s.scrollLeft };
    });
    expect(r.page, 'הדף זז לצדדים').toBe(0);
    expect(r.wide).toBe(true);
    expect(r.menu, 'התפריט נגלל').not.toBe(0);
  });

  test('יצירת קוד לספק חדש, בתוקף ל-15 דקות', async ({ page }) => {
    await openDemo(page, 'admin', 'account');
    await page.getByRole('button', { name: 'יצירת קוד', exact: true }).click();
    await expect(page.getByLabel('הקוד')).toHaveText(/^[0-9A-Z]{6}$/);
    await expect(page.getByRole('timer')).toContainText(/בתוקף עוד 1[45]:\d\d/);
    await expect(page.getByRole('link', { name: 'שליחה בוואטסאפ' })).toHaveAttribute('href', /wa\.me/);
  });

  test('הגדרות: טלפון או מייל לא תקינים לא נשמרים', async ({ page }) => {
    await openDemo(page, 'admin', 'settings');
    await expect(page.getByLabel('כתובת')).not.toHaveValue('');
    await page.getByLabel('טלפון').fill('0501234');
    await page.getByLabel('מייל לקבלת הזמנות').fill('orders@');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await expect(page.locator('.field-err', { hasText: 'מספר הטלפון לא תקין' })).toBeVisible();
    await expect(page.locator('.field-err', { hasText: 'המייל לא תקין' })).toBeVisible();
    await page.getByLabel('טלפון').fill('050-1234567');
    await page.getByLabel('מייל לקבלת הזמנות').fill('orders@clean.co.il');
    await page.getByLabel('שעות פעילות').fill('א׳-ה׳ 6:00-15:00');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await expect(page.getByText('ההגדרות נשמרו')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('שעות פעילות')).toHaveValue('א׳-ה׳ 6:00-15:00');
  });

  test('כרטיס חנות: כמה הזמנות וכמה כסף, וכתובת ושעות בפרטים', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    const card = page.locator('.st-card', { hasText: 'מרכול השכונה' });
    await expect(card.locator('.st-stats')).toContainText(/\d+ הזמנות · ₪[\d,.]+/);
    await card.locator('.st-head').click();
    await expect(card).toContainText('הרצל 45, רמת גן');
    await expect(card).toContainText('א׳-ה׳ 7:00-22:00');
  });

  test('החשבון שלי: הגדרות וחזרה, והתנתקות רק אחרי אישור', async ({ page }) => {
    await openDemo(page, 'admin');
    await nav(page, 'החשבון שלי').click();
    await expect(page.getByRole('heading', { name: 'החשבון שלי' })).toBeVisible();
    await expect(page.getByText('demo@example.com')).toBeVisible();
    await page.getByRole('link', { name: /הגדרות העסק/ }).click();
    await expect(page.getByRole('heading', { name: 'הגדרות העסק' })).toBeVisible();
    await expect(nav(page, 'החשבון שלי')).toHaveClass(/on/);
    await page.getByRole('link', { name: 'חזרה' }).click();
    await expect(page.getByRole('heading', { name: 'החשבון שלי' })).toBeVisible();
    // Logging out asks first; "חזרה" keeps you logged in.
    await page.getByRole('button', { name: 'התנתקות מהחשבון' }).click();
    const ask = page.getByRole('dialog', { name: 'אישור' });
    await expect(ask).toContainText('להתנתק מהחשבון?');
    await ask.getByRole('button', { name: 'חזרה' }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'החשבון שלי' })).toBeVisible();
    await page.getByRole('button', { name: 'התנתקות מהחשבון' }).click();
    await page.getByRole('dialog', { name: 'אישור' }).getByRole('button', { name: 'התנתקות' }).click();
    await expect(page.getByRole('button', { name: /כניסה כספק/ })).toBeVisible();
  });

  test('כפתור החזרה של הטלפון סוגר חלון פתוח בלי לצאת מהמסך', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    await page.getByRole('button', { name: 'הוספת חנות' }).click();
    await expect(page.getByRole('dialog', { name: 'חנות חדשה' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'חנויות', exact: true })).toBeVisible();
    // Closing with the X does not leave an extra step behind.
    await page.getByRole('button', { name: 'הוספת חנות' }).click();
    await page.getByRole('button', { name: 'סגירה' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await nav(page, 'קטלוג ומחירים').click();
    await expect(page.getByRole('heading', { name: 'קטלוג ומחירים', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'חנויות', exact: true })).toBeVisible();
  });

  test('שינוי שם העסק בהגדרות נשמר', async ({ page }) => {
    await openDemo(page, 'admin', 'settings');
    const name = page.getByLabel('שם העסק');
    await name.fill('ספק בדיקה');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.reload();
    await expect(page.getByLabel('שם העסק')).toHaveValue('ספק בדיקה');
  });
});
