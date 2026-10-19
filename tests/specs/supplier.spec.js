const { test, expect, openDemo, isPhone } = require('./helpers');

const nav = (page, name) => page.locator('.side-links a', { hasText: name });

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
    for (const [link, heading] of [['חנויות', 'חנויות'], ['קטלוג ומחירים', 'קטלוג ומחירים'], ['הגדרות', 'הגדרות'], ['הזמנות', 'הזמנות']]) {
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
    await page.getByPlaceholder('חיפוש חנות או מספר הזמנה').fill('שנייה');
    await expect(page.locator('tr.ord')).toHaveCount(1);
    await expect(page.locator('tr.ord')).toContainText('חנות שנייה');
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
    await page.locator('tbody tr', { hasText: 'חנות לדוגמה' }).getByRole('button', { name: 'קטלוג ומחירים' }).click();
    const modal = page.locator('.modal');
    await modal.getByRole('button', { name: 'רק מוצרים שבחרתי' }).click();
    await modal.getByLabel('חיפוש בקטלוג החנות').fill('6295-7');
    await modal.getByRole('button', { name: 'סימון כל המוצרים ברשימה' }).click();
    await modal.getByLabel('חיפוש בקטלוג החנות').fill('6295-753');
    await modal.getByLabel(/^מחיר מיוחד:/).fill('50');
    await modal.getByRole('button', { name: 'שמירת הקטלוג' }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: 'חנות לדוגמה' })).toContainText('קטלוג משלה');

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
    await page.locator('tbody tr', { hasText: 'חנות לדוגמה' }).getByRole('button', { name: 'קטלוג ומחירים' }).click();
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
    await expect(page.locator('tbody tr', { hasText: 'חנות בדיקה' })).toBeVisible();
  });

  test('חסימת חנות ושחרור', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    const row = page.locator('tbody tr', { hasText: 'חנות לדוגמה' });
    await row.getByRole('button', { name: 'חסימה' }).click();
    await expect(row.locator('.badge')).toHaveText('חסומה');
    await row.getByRole('button', { name: 'שחרור' }).click();
    await expect(row.locator('.badge')).toHaveText('פעילה');
  });

  test('חיפוש בקטלוג', async ({ page }) => {
    await openDemo(page, 'admin', 'catalog');
    await page.getByLabel('חיפוש מוצר').fill('RM 626');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('סבון כללי 1 ליטר');
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
    for (const link of ['הזמנות', 'חנויות', 'קטלוג ומחירים', 'הגדרות']) {
      await nav(page, link).click();
      await expect(page.locator('.page h1')).toBeVisible();
      const [doc, screen] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(doc, `רוחב הדף במסך ${link}`).toBeLessThanOrEqual(screen);
    }
  });

  test('יצירת קוד לספק חדש, בתוקף ל-15 דקות', async ({ page }) => {
    await openDemo(page, 'admin', 'settings');
    await page.getByRole('button', { name: 'יצירת קוד', exact: true }).click();
    await expect(page.getByLabel('הקוד')).toHaveText(/^[0-9A-Z]{6}$/);
    await expect(page.getByRole('timer')).toContainText(/בתוקף עוד 1[45]:\d\d/);
    await expect(page.getByRole('link', { name: 'שליחה בוואטסאפ' })).toHaveAttribute('href', /wa\.me/);
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
