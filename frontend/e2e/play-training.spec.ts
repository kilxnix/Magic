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

test('play page exposes practice progress and opens a scenario drill', async ({ page }) => {
  await page.goto('/play?e2e=practice-progress');
  await clearOverlays(page);

  const progress = page.getByTestId('practice-progress-panel');
  await expect(progress).toBeVisible();
  await expect(progress.getByText('Practice Progress')).toBeVisible();
  await expect(progress.getByText('No practice history yet')).toBeVisible();
  await expect(progress.getByRole('button', { name: 'Start Focused Rep', exact: true })).toBeVisible();
  const recommendations = page.getByTestId('practice-recommendations');
  await expect(recommendations).toBeVisible();
  await expect(recommendations.getByText('Recommended Next Reps')).toBeVisible();

  await progress.getByRole('button', { name: 'Open Drill Scenario', exact: true }).click();
  await expect(page.getByText('Bookmark This Moment')).toBeVisible();
  await expect(page.getByLabel('Game actions').getByText('Complex Combat QA Pilot has')).toBeVisible();

  await page.getByRole('button', { name: 'Bookmark This Moment' }).click();
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await page.getByRole('button', { name: 'Saves' }).click();
  await expect(page.getByText('Practice Progress')).toBeVisible();
  await expect(page.getByText('Open Drill')).toBeVisible();
  await expect(page.getByText('Repeat the latest drill')).toBeVisible();
  await expect(page.getByRole('button', { name: /Repeat the latest drill/i })).toBeVisible();
});
