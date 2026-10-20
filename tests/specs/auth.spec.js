const { test, expect, siteVersion, blockServer } = require('./helpers');

test.describe('כניסה והרשמה', () => {
  test('מסך הכניסה נטען ומציג את הגרסה הנוכחית', async ({ page }) => {
    await blockServer(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'כניסה' })).toBeVisible();
    await expect(page.locator('.version')).toHaveText('גרסה ' + siteVersion());
  });

  test('כפתור העין מציג ומסתיר את הסיסמה', async ({ page }) => {
    await blockServer(page);
    await page.goto('/');
    const pw = page.locator('input[autocomplete=current-password]');
    await pw.fill('abc12345');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'הצגת הסיסמה' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'הסתרת הסיסמה' }).click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('המייל נזכר בכניסה הבאה, ואפשר לבטל', async ({ page }) => {
    await blockServer(page);
    await page.goto('/');
    const remember = page.getByLabel('לזכור את המייל במכשיר הזה');
    await expect(remember).toBeChecked();
    await page.locator('input[type=email]').fill('store@example.com');
    await page.locator('input[autocomplete=current-password]').fill('abc12345');
    await page.getByRole('button', { name: 'כניסה', exact: true }).click();
    await page.reload();
    await expect(page.locator('input[type=email]')).toHaveValue('store@example.com');

    // Unticking forgets it, and stays unticked next time.
    await page.getByLabel('לזכור את המייל במכשיר הזה').uncheck();
    await page.reload();
    await expect(page.locator('input[type=email]')).toHaveValue('');
    await expect(page.getByLabel('לזכור את המייל במכשיר הזה')).not.toBeChecked();
  });

  // 2.6: errors from the server always show in Hebrew.
  for (const [msg, he] of [
    ['Invalid login credentials', 'המייל או הסיסמה לא נכונים'],
    ['Request rate limit reached', 'יותר מדי ניסיונות'],
    ['Some brand new English error', 'משהו השתבש. נסו שוב'],
  ]) {
    test('שגיאה מהשרת מוצגת בעברית: ' + msg, async ({ page }) => {
      await blockServer(page);
      await page.route(/auth\/v1\/token/, r => r.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ code: 400, error_code: 'x', msg }),
      }));
      await page.goto('/');
      await page.locator('input[type=email]').fill('store@example.com');
      await page.locator('input[autocomplete=current-password]').fill('abc12345');
      await page.getByRole('button', { name: 'כניסה', exact: true }).click();
      await expect(page.locator('.toast')).toContainText(he);
      await expect(page.locator('.toast')).not.toContainText(/[A-Za-z]{3}/);
    });
  }

  test('כניסה מקישור עם ?join= שומרת את קוד ההצטרפות', async ({ page }) => {
    await blockServer(page);
    await page.goto('/?join=ABC123');
    expect(await page.evaluate(() => localStorage.getItem('pending_invite'))).toBe('ABC123');
  });

  test.describe('הרשמה', () => {
    let calls;
    test.beforeEach(async ({ page }) => {
      calls = await blockServer(page);
      await page.goto('/');
      await page.getByText('ספק חדש? יצירת חשבון').click();
      await page.locator('input[type=email]').fill('test@example.com');
    });
    const fields = page => page.locator('input[autocomplete=new-password]');
    const signups = () => calls.filter(u => u.includes('/auth/v1/signup'));

    test('הכללים מסומנים ב-✓ בזמן ההקלדה', async ({ page }) => {
      const rules = page.locator('.pw-rules').first().locator('li');
      await expect(rules).toHaveCount(3);
      await expect(page.locator('.pw-rules li.ok')).toHaveCount(0);
      await fields(page).first().fill('abcdefgh');
      await expect(rules.nth(0)).toHaveClass(/ok/);
      await expect(rules.nth(1)).toHaveClass(/ok/);
      await expect(rules.nth(2)).not.toHaveClass(/ok/);
      await fields(page).first().fill('abcdefg1');
      await expect(page.locator('.pw-rules').first().locator('li.ok')).toHaveCount(3);
    });

    test('סיסמה חלשה נחסמת ולא נשלחת לשרת', async ({ page }) => {
      await fields(page).nth(0).fill('abc1');
      await fields(page).nth(1).fill('abc1');
      await page.getByRole('button', { name: 'יצירת חשבון' }).click();
      await expect(page.locator('.toast')).toContainText('לפחות 8 תווים');
      expect(signups()).toHaveLength(0);
    });

    test('סיסמאות לא זהות נחסמות', async ({ page }) => {
      await fields(page).nth(0).fill('abcd1234');
      await fields(page).nth(1).fill('abcd1235');
      await expect(page.getByText('הסיסמאות עדיין לא זהות')).toBeVisible();
      await page.getByRole('button', { name: 'יצירת חשבון' }).click();
      await expect(page.locator('.toast')).toContainText('לא זהות');
      expect(signups()).toHaveLength(0);
    });

    test('קישור אישור המייל שומר את קוד ההצטרפות של החנות', async ({ page }) => {
      await page.evaluate(() => localStorage.setItem('pending_invite', 'TESTCODE'));
      await fields(page).nth(0).fill('abcd1234');
      await fields(page).nth(1).fill('abcd1234');
      await page.getByRole('button', { name: 'יצירת חשבון' }).click();
      await expect.poll(() => signups().length).toBe(1);
      expect(decodeURIComponent(signups()[0])).toContain('?join=TESTCODE');
    });

    test('סיסמה תקינה נשלחת להרשמה', async ({ page }) => {
      await fields(page).nth(0).fill('abcd1234');
      await fields(page).nth(1).fill('abcd1234');
      await expect(page.getByText('הסיסמאות זהות')).toBeVisible();
      await page.getByRole('button', { name: 'יצירת חשבון' }).click();
      await expect.poll(() => signups().length).toBe(1);
    });
  });
});
