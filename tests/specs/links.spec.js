const { test, expect, openDemo } = require('./helpers');

// 2.17: a store picks suppliers from a list and asks to join; the supplier approves or declines.
test.describe('רשימת ספקים ובקשות הצטרפות', () => {
  test('חנות: הוספת ספק מהרשימה, והבקשה ממתינה לאישור', async ({ page }) => {
    await openDemo(page, 'store', 'suppliers');
    await page.getByRole('link', { name: 'הוספת ספק' }).click();
    await expect(page.getByRole('heading', { name: 'הוספת ספק' })).toBeVisible();
    // The 5 suppliers the store already works with, plus 2 more.
    await expect(page.locator('.sd-card')).toHaveCount(7);
    await expect(page.locator('.sd-card', { hasText: 'מחובר' })).toHaveCount(5);

    await page.getByLabel('חיפוש ספק').fill('קצרין');
    await expect(page.locator('.sd-card')).toHaveCount(1);
    const card = page.locator('.sd-card', { hasText: 'בשר ועוף הגולן' });
    await card.getByRole('button', { name: 'בקשת הצטרפות' }).click();
    await expect(card).toContainText('נשלחה בקשה, ממתין לאישור הספק');
    await expect(card.getByRole('button', { name: 'בקשת הצטרפות' })).toHaveCount(0);

    await page.getByRole('link', { name: 'חזרה לספקים שלי' }).click();
    await expect(page.getByRole('heading', { name: 'הספקים שלי' })).toBeVisible();
    await expect(page.locator('.sup-add')).toContainText('ממתינים לאישור: בשר ועוף הגולן');

    await page.reload();
    await expect(page.locator('.sup-add')).toContainText('ממתינים לאישור: בשר ועוף הגולן');
  });

  test('ספק: מאשר בקשה והחנות נוספת לרשימת החנויות', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    const req = page.locator('.lr-card');
    await expect(req).toHaveCount(1);
    await expect(req).toContainText('פומפות זה אנחנו');
    await expect(req).toContainText('050-1234567');
    await expect(req).toContainText('הנשיא 4, רחובות');
    await expect(page.locator('.st-card')).toHaveCount(2);
    await req.getByRole('button', { name: 'אישור' }).click();
    await expect(page.locator('.lr-card')).toHaveCount(0);
    await expect(page.locator('.st-card')).toHaveCount(3);
    await expect(page.locator('.st-card', { hasText: 'פומפות זה אנחנו' })).toHaveCount(1);
  });

  test('ספק: דוחה בקשה אחרי שאלה, והחנות לא נוספת', async ({ page }) => {
    await openDemo(page, 'admin', 'stores');
    await page.locator('.lr-card').getByRole('button', { name: 'דחייה' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'דחייה' }).click();
    await expect(page.locator('.lr-card')).toHaveCount(0);
    await expect(page.locator('.st-card')).toHaveCount(2);
    await page.reload();
    await expect(page.locator('.lr-card')).toHaveCount(0);
  });
});
