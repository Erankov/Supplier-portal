const { test, expect, openDemo, blockServer } = require('./helpers');

// 2.15: join requests, one-time codes and payments.
test.describe('פניות, קודים ותשלומים', () => {
  test('טופס ההצטרפות: בדיקת שדות ושליחה', async ({ page }) => {
    const calls = await blockServer(page);
    await page.goto('/');
    await page.getByRole('link', { name: /הצטרפות למערכת/ }).click();
    await expect(page.getByRole('heading', { name: 'הצטרפות למערכת' })).toBeVisible();
    await page.getByRole('button', { name: 'שליחת הפנייה' }).click();
    await expect(page.locator('.field-err', { hasText: 'נא למלא את שם העסק' })).toBeVisible();
    expect(calls.filter(u => u.includes('submit_join_request'))).toHaveLength(0);

    await page.getByRole('button', { name: 'ספק' }).click();
    await page.getByLabel('שם העסק').fill('מאפיית הבדיקה');
    await page.getByLabel('שם איש קשר').fill('משה');
    await page.getByLabel('מייל').fill('moshe@example.com');
    await page.getByLabel('טלפון').fill('0521234');
    await page.getByLabel('כתובת').fill('הרצל 1, חיפה');
    await page.getByLabel('שעות פעילות').fill('א׳-ה׳ 8:00-17:00');
    await page.getByText('גולד').click();
    await page.getByRole('button', { name: 'שליחת הפנייה' }).click();
    await expect(page.locator('.field-err', { hasText: 'מספר הטלפון לא תקין' })).toBeVisible();
    expect(calls.filter(u => u.includes('submit_join_request'))).toHaveLength(0);

    await page.getByLabel('טלפון').fill('052-1234567');
    await page.getByRole('button', { name: 'שליחת הפנייה' }).click();
    await expect(page.getByRole('heading', { name: 'הפנייה התקבלה' })).toBeVisible();
    await expect(page.locator('.jn-sum')).toContainText('מאפיית הבדיקה (ספק)');
    await expect(page.locator('.jn-sum')).toContainText('גולד');
    expect(calls.filter(u => u.includes('submit_join_request'))).toHaveLength(1);
  });

  test('קישור עם קוד פותח את יצירת החשבון עם הקוד', async ({ page }) => {
    await blockServer(page);
    await page.goto('/#/code/K7M2QX');
    await expect(page.getByRole('heading', { name: 'יצירת חשבון' })).toBeVisible();
    await expect(page.getByLabel('הקוד שקיבלתם')).toHaveValue('K7M2QX');
  });

  test('פנייה חדשה מההדגמה מופיעה ברשימה של בעל האתר', async ({ page, context }) => {
    await page.goto('/?demo#/apply');
    await page.getByLabel('שם העסק').fill('קיוסק הבדיקה');
    await page.getByLabel('שם איש קשר').fill('רינה');
    await page.getByLabel('מייל').fill('rina@example.com');
    await page.getByLabel('טלפון').fill('054-1112222');
    await page.getByLabel('כתובת').fill('הנביאים 3, ירושלים');
    await page.getByLabel('שעות פעילות').fill('א׳-ו׳ 7:00-20:00');
    await page.getByRole('button', { name: 'שליחת הפנייה' }).click();
    await expect(page.getByRole('heading', { name: 'הפנייה התקבלה' })).toBeVisible();

    const owner = await context.newPage();
    await openDemo(owner, 'admin', 'leads');
    const row = owner.locator('.ld-row', { hasText: 'קיוסק הבדיקה' });
    await expect(row).toContainText('פנייה חדשה');
    await expect(row).toContainText('סילבר');
  });

  test('רשימת הפניות מסננת לפי סוג וסטטוס', async ({ page }) => {
    await openDemo(page, 'admin', 'leads');
    await expect(page.locator('.ld-row')).toHaveCount(7);
    await page.locator('.ld-kind').getByRole('button', { name: 'ספקים' }).click();
    await expect(page.locator('.ld-row')).toHaveCount(2);
    await page.locator('.ld-kind').getByRole('button', { name: 'הכל' }).click();
    await page.locator('.ld-chips').getByRole('button', { name: 'באיחור' }).click();
    await expect(page.locator('.ld-row')).toHaveCount(1);
    await expect(page.locator('.ld-row')).toContainText('מכולת רחוב הגפן');
    await expect(page.locator('.ld-row')).toContainText(/ייחסם בעוד \d+ שעות/);
  });

  test('שליחת קוד חד פעמי: קוד, מייל ווואטסאפ עם הודעה מוכנה', async ({ page }) => {
    await openDemo(page, 'admin', 'leads');
    await page.locator('.ld-row', { hasText: 'מינימרקט הגליל' }).click();
    await expect(page.getByRole('heading', { name: 'מינימרקט הגליל' })).toBeVisible();
    await page.getByRole('button', { name: 'שליחת קוד חד פעמי' }).click();
    const dlg = page.getByRole('dialog');
    const code = dlg.getByLabel('הקוד');
    await expect(code).toHaveText(/^[A-Z2-9]{6}$/);
    await expect(dlg).toContainText('נשלח במייל ל-moshe@example.com');
    const wa = dlg.getByRole('link', { name: /שליחה בוואטסאפ/ });
    await expect(wa).toHaveAttribute('href', new RegExp('^https://wa\\.me/972521234567\\?text=.*' + await code.textContent()));
    await dlg.getByRole('button', { name: 'סיום' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('קוד נשלח');
    await expect(page.getByRole('button', { name: 'שליחת קוד חדש' })).toBeVisible();
  });

  test('לקוח רשום: שינוי מסלול וסימון ששולם', async ({ page }) => {
    await openDemo(page, 'admin', 'leads/l7');
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('באיחור');
    await page.getByLabel('מסלול').selectOption('gold');
    await expect(page.getByText('המסלול עודכן לגולד')).toBeVisible();
    await page.getByRole('button', { name: 'סימון "שולם"' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'סימון שולם' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('לקוח רשום');
    await expect(page.locator('.ld-facts')).toContainText('גולד');
  });

  test('תשלום באיחור: התראה עם ספירה לאחור, ואחרי 48 שעות חסימה', async ({ page, context }) => {
    const ymd = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    await openDemo(page, 'admin', 'leads/l5');
    await page.getByLabel('מועד התשלום הבא').fill(ymd(-1));
    await page.getByRole('button', { name: 'שמירת המועד' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('באיחור');

    const store = await context.newPage();
    await openDemo(store, 'store');
    const alert = store.getByRole('dialog', { name: 'התשלום על המנוי לא התקבל' });
    await expect(alert.getByRole('timer')).toHaveText(/^\d{1,2}:\d\d$/);
    await alert.getByRole('button', { name: 'הבנתי' }).click();
    await expect(alert).toBeHidden();
    await store.reload();
    await expect(store.locator('.shop-top')).toBeVisible();
    await expect(alert).toBeHidden();

    await page.getByLabel('מועד התשלום הבא').fill(ymd(-4));
    await page.getByRole('button', { name: 'שמירת המועד' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('חסום');
    await store.reload();
    await expect(store.getByRole('heading', { name: 'החשבון חסום עד לתשלום' })).toBeVisible();

    await page.getByRole('button', { name: 'סימון "שולם"' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'סימון שולם' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('לקוח רשום');
    await store.reload();
    await expect(store.locator('.shop-top')).toBeVisible();
  });

  test('חסימה ידנית וביטול החסימה', async ({ page }) => {
    await openDemo(page, 'admin', 'leads/l6');
    await page.getByRole('button', { name: 'חסימה עכשיו' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'חסימה' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('חסום');
    await page.getByRole('button', { name: 'ביטול החסימה' }).click();
    await expect(page.locator('.ld-head .ld-badge')).toHaveText('לקוח רשום');
  });
});

test('בהתראה על התשלום יש כפתור וואטסאפ לבעל האתר', async ({ page, context }) => {
  const ymd = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  await openDemo(page, 'admin', 'leads/l5');
  await page.getByLabel('מועד התשלום הבא').fill(ymd(-1));
  await page.getByRole('button', { name: 'שמירת המועד' }).click();
  await expect(page.locator('.ld-head .ld-badge')).toHaveText('באיחור');
  const store = await context.newPage();
  await openDemo(store, 'store');
  await expect(store.getByRole('dialog').getByRole('link', { name: 'יצירת קשר בוואטסאפ לתשלום' })).toHaveAttribute('href', /^https:\/\/wa\.me\/972543455648\?text=/);
});

test('בעל האתר שולח ללקוחות קישור לטופס ההצטרפות', async ({ page }) => {
  await openDemo(page, 'admin', 'leads');
  const box = page.locator('.ld-link');
  await expect(box.locator('.ld-url')).toHaveText(/\/#\/apply$/);
  await expect(box.getByRole('link', { name: 'שליחה בוואטסאפ' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*%23%2Fapply/);
  await expect(box.getByRole('button', { name: 'העתקת הקישור' })).toBeVisible();
});
