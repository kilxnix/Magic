import { expect, test, type Page } from '@playwright/test';

async function clearOverlays(page: Page) {
  const declineAds = page.getByRole('button', { name: 'Decline Ads' });
  if (await declineAds.isVisible().catch(() => false)) {
    await declineAds.click();
  }
  const closeGuide = page.getByRole('button', { name: 'Close guided practice prompt' });
  if (await closeGuide.isVisible().catch(() => false)) {
    await closeGuide.click();
  }
  const dismissAlpha = page.getByRole('button', { name: 'Dismiss alpha notice' });
  if (await dismissAlpha.isVisible().catch(() => false)) {
    await dismissAlpha.click();
  }
}

test('MTGGoldfish partner commander decks import without duplicated commanders', async ({ page, baseURL }) => {
  test.skip(Boolean(baseURL && /127\.0\.0\.1|localhost/.test(baseURL)), 'Requires backend URL import endpoint.');

  await page.goto('/play?e2e=partner-import');
  await clearOverlays(page);

  const urlInput = page.getByPlaceholder('https://www.moxfield.com/decks/...');
  await urlInput.scrollIntoViewIfNeeded();
  await urlInput.fill('https://www.mtggoldfish.com/deck/7767508#paper');
  await page.getByRole('button', { name: 'Import Deck' }).click();

  await expect(page.getByText('Dargo, the Shipwrecker // Tymna the Weaver')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('100 cards')).toBeVisible();
  await expect(page.getByText('Deck has 101 cards (maximum is 100)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose Opponent' })).toBeVisible();
});
