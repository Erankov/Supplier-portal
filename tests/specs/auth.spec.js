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

    test('סיסמה תקינה נשלחת להרשמה', async ({ page }) => {
      await fields(page).nth(0).fill('abcd1234');
      await fields(page).nth(1).fill('abcd1234');
      await expect(page.getByText('הסיסמאות זהות')).toBeVisible();
      await page.getByRole('button', { name: 'יצירת חשבון' }).click();
      await expect.poll(() => signups().length).toBe(1);
    });
  });
});
