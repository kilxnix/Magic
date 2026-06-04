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
  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await expect(scenarioLab.getByText('Drill-first setup')).toBeVisible();

  await scenarioLab.getByRole('button', { name: /Complex Combat/i }).click();
  await expect(page.getByText('Bookmark This Moment')).toBeVisible();
  await expect(page.getByLabel('Game actions').getByText('Complex Combat QA Pilot has')).toBeVisible();
  await expect(page.getByText('Branch Preview').first()).toBeVisible();
  await expect(page.getByText(/Practice read:/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Bookmark This Moment' }).click();
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await page.getByRole('button', { name: 'Saves' }).click();
  await expect(page.getByText('Practice Progress')).toBeVisible();
  await expect(page.getByText('Open Drill')).toBeVisible();
  await expect(page.getByText('Repeat the latest drill')).toBeVisible();
  await expect(page.getByRole('button', { name: /Repeat the latest drill/i })).toBeVisible();
});

test('Scenario Lab opens Sisay activation with a real activation action', async ({ page }) => {
  await page.goto('/play?e2e=sisay-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /Sisay Activation/i }).click();

  const actions = page.getByLabel('Game actions');
  await expect(actions).toBeVisible();
  const sisayActivation = actions.getByRole('button', { name: /Activate Sisay/i });
  await expect(sisayActivation).toBeVisible();
  await sisayActivation.click();

  await expect(page.getByText(/Sisay Activation|Search your library|Yoshimaru, Ever Faithful/i).first()).toBeVisible();
});

test('Scenario Lab opens fetch and shock land actions', async ({ page }) => {
  await page.goto('/play?e2e=land-entry-fetch-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /Fetch\/Shock Land/i }).click();

  const actions = page.getByLabel('Game actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('button', { name: /Play Stomping Ground/i })).toBeVisible();
  await expect(actions.getByRole('button', { name: /Activate Scalding Tarn/i })).toBeVisible();
});

test('Scenario Lab resolves scry and surveil library-choice modals', async ({ page }) => {
  await page.goto('/play?e2e=library-manipulation-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /Scry\/Surveil/i }).click();

  const actions = page.getByLabel('Game actions');
  await expect(actions).toBeVisible();
  await actions.getByRole('button', { name: /Cast Opt/i }).click();
  await page.getByRole('button', { name: /^Don't Respond$/i }).click();

  await expect(page.getByRole('button', { name: /^Move to Bottom$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Keep All Top$/i })).toBeVisible();
  await page.getByRole('button', { name: /^Move to Bottom$/i }).click();
  await page.getByRole('button', { name: /^Confirm$/i }).click();

  await expect(actions.getByRole('button', { name: /Cast Consider/i })).toBeVisible();
  await actions.getByRole('button', { name: /Cast Consider/i }).click();
  if (!(await page.getByRole('button', { name: /^Move to Graveyard$/i }).isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Don't Respond$/i }).click();
  }

  await expect(page.getByRole('button', { name: /^Move to Graveyard$/i })).toBeVisible();
  await expect(page.getByText(/Keep top|Graveyard/i).first()).toBeVisible();
  await page.getByRole('button', { name: /^Move to Graveyard$/i }).click();
  await page.getByRole('button', { name: /^Confirm$/i }).click();

  await expect(page.getByRole('button', { name: /^Move to Graveyard$/i })).toHaveCount(0);
});

test('Scenario Lab exposes and resolves modal spell choices with typed targets', async ({ page }) => {
  await page.goto('/play?e2e=modal-choice-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /Modal Choices/i }).click();

  const actions = page.getByLabel('Game actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('button', { name: /deals 3 damage to target creature targeting Grizzly Bears/i }).first()).toBeVisible();
  await expect(actions.getByRole('button', { name: /Destroy target artifact targeting Sol Ring/i }).first()).toBeVisible();

  await actions.getByRole('button', { name: /Destroy target artifact targeting Sol Ring/i }).first().click();
  await page.getByRole('button', { name: /^Don't Respond$/i }).click();

  await expect(actions.getByRole('button', { name: /Destroy target artifact targeting Sol Ring/i })).toHaveCount(0);
  await expect(actions.getByRole('button', { name: /deals 3 damage to target creature targeting Grizzly Bears/i }).first()).toBeVisible();
});

test('Scenario Lab resolves d20 equipment creation and equip action', async ({ page }) => {
  await page.goto('/play?e2e=equipment-d20-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /D20 Equipment/i }).click();

  const actions = page.getByLabel('Game actions');
  await expect(actions).toBeVisible();
  await actions.getByRole('button', { name: /Cast Goblin Morningstar/i }).click();

  await expect(page.getByText(/Goblin Morningstar rolled \d+/i).first()).toBeVisible();
  await expect(page.getByText(/Goblin\s*Token creature/i).first()).toBeVisible();
  const equip = actions.getByRole('button', { name: /Equip Goblin Morningstar/i }).first();
  await expect(equip).toBeVisible();
  await equip.click();
  const targetBear = page.getByRole('button', { name: /Training Bear.*Target/i }).first();
  if (await targetBear.isVisible().catch(() => false)) {
    await targetBear.click();
  }

  await expect(page.getByText(/Training Bear[\s\S]*Goblin Morningstar|attachment changed/i).first()).toBeVisible();
});

test('Scenario Lab stacks matching tokens into one board group', async ({ page }) => {
  await page.goto('/play?e2e=token-stack-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /Token Board/i }).click();

  await expect(page.getByRole('button', { name: /Goblin.*Token.*x3/i }).first()).toBeVisible();
});

test('Scenario Lab supports selecting cards to mulligan and bottom after redraw', async ({ page }) => {
  await page.goto('/play?e2e=mulligan-selection-scenario');
  await clearOverlays(page);

  const scenarioLab = page.getByTestId('scenario-lab-panel');
  await expect(scenarioLab).toBeVisible();
  await scenarioLab.getByRole('button', { name: /Mulligan Selection/i }).click();

  await expect(page.getByRole('button', { name: 'Pick Cards First' })).toBeDisabled();
  await page.locator('[data-testid="human-hand-card"][data-card-name="Lightning Bolt"]').click();
  await expect(page.getByRole('button', { name: 'Mulligan 1' })).toBeEnabled();
  await page.getByRole('button', { name: 'Mulligan 1' }).click();

  await expect(page.getByText(/Choose 1 to bottom \(0\/1\)/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep Selected' })).toBeDisabled();
  await expect(page.locator('[data-testid="human-hand-card"]')).toHaveCount(7);
  await page.locator('[data-testid="human-hand-card"]').last().click();
  await expect(page.getByText(/Choose 1 to bottom \(1\/1\)/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep Selected' })).toBeEnabled();
  await page.getByRole('button', { name: 'Keep Selected' }).click();

  await expect(page.getByRole('button', { name: 'Keep Selected' })).toHaveCount(0);
  await expect(page.getByLabel('Game actions')).toBeVisible();
});

test('short Archidekt Commander imports are gated before opponent selection', async ({ page, baseURL }) => {
  test.skip(Boolean(baseURL && /127\.0\.0\.1|localhost/.test(baseURL)), 'Requires hosted backend URL import endpoint.');

  await page.goto('/play?e2e=short-archidekt-gate');
  await clearOverlays(page);

  await page.getByPlaceholder('https://www.moxfield.com/decks/...').fill('https://archidekt.com/decks/10024261/storms_typhoon');
  await page.getByRole('button', { name: 'Import Deck' }).click();

  const gate = page.getByTestId('import-count-gate');
  await expect(gate).toBeVisible({ timeout: 60000 });
  await expect(gate).toContainText('Deck not ready for Commander practice');
  await expect(gate).toContainText('missing 5 cards');
  await expect(page.getByText('95 cards', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Deck First' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose Opponent' })).toHaveCount(0);
});
