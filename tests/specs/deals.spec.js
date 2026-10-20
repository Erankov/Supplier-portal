const zlib = require('zlib');
const { test, expect, openDemo, shekels, isPhone } = require('./helpers');

// A small PNG: a red square on a white background, like a product photo.
function productPng() {
  const w = 80, h = 80, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3, red = x > 20 && x < 60 && y > 20 && y < 60;
      raw[i] = red ? 200 : 255; raw[i + 1] = red ? 30 : 255; raw[i + 2] = red ? 30 : 255;
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const live = page => page.locator('.dc-card.a0');

// 2.18: supplier deals and new products in a carousel at the top of the store's order screen.
test.describe('קרוסלת מבצעים', () => {
  test('הקרוסלה מתחלפת לבד כל 4 שניות', async ({ page }) => {
    await openDemo(page, 'store');
    await expect(page.locator('.dc-pos')).toHaveText('1 מתוך 5');
    await expect(page.locator('.dc-pos')).toHaveText('2 מתוך 5', { timeout: 7000 });
  });
});

// The other tests turn the automatic move off (as for people who ask for less motion), so cards stay put.
test.describe('קרוסלת מבצעים בלי תנועה', () => {
  test.use({ reducedMotion: 'reduce' });
  test('חנות: מבצע של הספק נכנס לעגלה במחיר המבצע', async ({ page }, testInfo) => {
    await openDemo(page, 'store');
    const dc = page.locator('.dc');
    await expect(dc.getByRole('heading', { name: 'חדש אצל הספקים' })).toBeVisible();
    await expect(page.locator('.dc-card')).toHaveCount(5);
    await expect(dc.locator('.dc-pos')).toHaveText('1 מתוך 5');
    const card = live(page);
    await expect(card).toContainText('קלין פרו ציוד ניקוי');
    await expect(card).toContainText('₪280');
    await expect(card).toContainText('₪230');
    await card.getByRole('button', { name: 'הוספה לעגלה' }).click();
    await expect(card.getByRole('button', { name: 'בעגלה 1 · הוספת עוד' })).toBeVisible();
    // The product list and the cart charge the deal price.
    const row = page.locator('.plist li', { hasText: '4775-111' });
    await expect(row).toContainText('₪230');
    if (isPhone(testInfo)) await page.locator('.cart-bar').click();
    await expect(page.locator('.cart-panel')).toContainText('₪230');
  });

  test('חנות: ספק שלא עובדים איתו, בקשת הצטרפות מהכרטיס', async ({ page }) => {
    await openDemo(page, 'store');
    await page.getByRole('button', { name: 'הכרטיס הבא' }).click();
    await expect(page.locator('.dc-pos')).toHaveText('2 מתוך 5');
    const card = live(page);
    await expect(card).toHaveAttribute('aria-label', /גריל מאסטר/);
    await expect(card).toContainText('ספק חדש');
    await expect(card.locator('.dc-ban img')).toHaveAttribute('src', /grillmaster-banner/);
    await card.getByRole('button', { name: 'הכירו את הספק' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('בקשת הצטרפות');
    await dlg.getByRole('button', { name: 'בקשת הצטרפות' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.dc-card', { hasText: 'גריל פחמים' })).toContainText('נשלחה בקשה, ממתין לאישור');
    // Both deals of that supplier show the request.
    await expect(page.locator('.dc-card', { hasText: 'מעשנת' })).toContainText('נשלחה בקשה, ממתין לאישור');
    await page.getByRole('button', { name: 'הכרטיס הקודם' }).click();
    await expect(page.locator('.dc-pos')).toHaveText('1 מתוך 5');
  });

  test('ספק: מפרסם מבצע עם תמונה, ומסיים אותו', async ({ page }) => {
    await openDemo(page, 'admin', 'deals');
    await expect(page.getByRole('heading', { name: 'מבצעים', exact: true })).toBeVisible();
    await expect(page.locator('.dl-live')).toHaveCount(1);
    const form = page.locator('.dl-form');
    await form.getByLabel('מוצר מהקטלוג').selectOption({ index: 2 });
    // A deal price must be below the regular price.
    const price = form.getByLabel('מחיר במבצע');
    await price.fill('99999');
    await form.getByRole('button', { name: 'פרסום המבצע' }).click();
    await expect(form.locator('.note.err')).toContainText('מחיר המבצע צריך להיות נמוך');
    await price.fill('1');
    await form.getByLabel('העלאת תמונה של המוצר').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: productPng() });
    await expect(form.locator('.dl-pic')).toContainText('הרקע הוסר');
    // The card color comes from the product.
    await expect(form.locator('.dc-card.pv')).toHaveCSS('background-color', /rgb\(2\d\d, \d+, \d+\)/);
    await expect(form.locator('.dc-card.pv .dc-img')).toBeVisible();
    await form.getByRole('button', { name: 'פרסום המבצע' }).click();
    await expect(page.locator('.dl-live')).toHaveCount(2);
    await page.reload();
    await expect(page.locator('.dl-live')).toHaveCount(2);
    await page.locator('.dl-live').nth(1).getByRole('button', { name: 'סיום המבצע עכשיו' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'סיום המבצע' }).click();
    await expect(page.locator('.dl-live')).toHaveCount(1);
  });

  test('ספק: לחיצה על פרסום בלי מוצר מראה מה חסר', async ({ page }) => {
    await openDemo(page, 'admin', 'deals');
    await page.locator('.dl-form').getByRole('button', { name: 'פרסום המבצע' }).click();
    await expect(page.locator('.toast')).toContainText('בחרו מוצר מהקטלוג');
    await expect(page.getByLabel('מוצר מהקטלוג')).toBeFocused();
  });

  test('ספק: עד 3 מבצעים פעילים', async ({ page }) => {
    await openDemo(page, 'admin', 'deals');
    for (let k = 0; k < 2; k++) {
      const form = page.locator('.dl-form');
      await form.getByLabel('מוצר מהקטלוג').selectOption({ index: k + 2 });
      await form.getByRole('button', { name: 'מוצר חדש' }).click();
      await form.getByRole('button', { name: 'פרסום המבצע' }).click();
      await expect(page.locator('.dl-live')).toHaveCount(k + 2);
    }
    await expect(page.locator('.dl-form')).toHaveCount(0);
    await expect(page.locator('.dl-full')).toContainText('3 מבצעים פעילים');
  });

  test('בעל האתר: מסתיר מבצע, והוא יורד מהקרוסלה', async ({ page }) => {
    await openDemo(page, 'admin', 'account');
    await page.getByRole('link', { name: /כל המבצעים במערכת/ }).click();
    const row = page.locator('.ad-row', { hasText: 'טאבון אבן' });
    await row.getByRole('button', { name: 'הסתרה' }).click();
    await expect(row).toContainText('מוסתר');
    await expect(row.getByRole('button', { name: 'החזרה לתצוגה' })).toBeVisible();
    await page.getByLabel('צפייה בתור').selectOption({ label: 'מרכול השכונה' });
    await expect(page.locator('.dc-card')).toHaveCount(4);
    await expect(page.locator('.dc-card', { hasText: 'טאבון אבן' })).toHaveCount(0);
  });

  test('ספק: תמונת מותג לכרטיסים בהגדרות', async ({ page }) => {
    await openDemo(page, 'admin', 'settings');
    await page.getByLabel('תמונת מותג לכרטיסים').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: productPng() });
    await expect(page.getByRole('img', { name: 'תמונת המותג' })).toBeVisible();
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.reload();
    await expect(page.getByRole('img', { name: 'תמונת המותג' })).toBeVisible();
  });
});
