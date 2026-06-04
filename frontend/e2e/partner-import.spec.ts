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

const DARGO_THRASIOS_REPAIR_DECKLIST = [
  'Commander',
  '1 Dargo, the Shipwrecker',
  '1 Thrasios, Triton Hero',
  '',
  'Deck',
  '1 Scalding Tarn',
  '1 Scalding Tarn',
  '1 Sol Ring',
  '95 Island',
].join('\n');

const LAND_NAME_HINTS = new Set([
  'Ancient Tomb',
  'Arid Mesa',
  'Badlands',
  'Blood Crypt',
  'Bloodstained Mire',
  'Cavern of Souls',
  'City of Brass',
  'Command Tower',
  'Exotic Orchard',
  'Flooded Strand',
  'Godless Shrine',
  'Luxury Suite',
  'Mana Confluence',
  'Marsh Flats',
  'Mountain',
  'Plateau',
  'Polluted Delta',
  'Sacred Foundry',
  'Scalding Tarn',
  'Scrubland',
  'Swamp',
  'Verdant Catacombs',
  'Windswept Heath',
  'Wooded Foothills',
]);

async function visibleHandCards(page: Page): Promise<Array<{ index: number; name: string; type: string }>> {
  await expect(page.getByTestId('human-hand-zone')).toBeVisible({ timeout: 15000 });
  return page.getByTestId('human-hand-card').evaluateAll(nodes =>
    nodes.map((node, index) => ({
      index,
      name: node.getAttribute('data-card-name') || '',
      type: node.getAttribute('data-card-type') || '',
    })),
  );
}

function isLandLike(card: { name: string; type: string }) {
  return /\bland\b/i.test(card.type) || LAND_NAME_HINTS.has(card.name);
}

async function selectHandCard(page: Page, index: number) {
  await page.getByTestId('human-hand-card').nth(index).locator('button').first().click();
}

async function keepPlayableOpeningHand(page: Page) {
  let mulligansTaken = 0;

  while (mulligansTaken < 4) {
    const cards = await visibleHandCards(page);
    if (cards.some(isLandLike)) break;

    for (const card of cards) {
      await selectHandCard(page, card.index);
    }

    const previousHandNames = cards.map(card => card.name).join('|');
    await page.getByRole('button', { name: `Mulligan ${cards.length}` }).click();
    mulligansTaken += 1;
    await expect.poll(
      async () => (await visibleHandCards(page)).map(card => card.name).join('|'),
      { timeout: 15000 },
    ).not.toBe(previousHandNames);
  }

  const keptCards = await visibleHandCards(page);
  expect(keptCards.some(isLandLike), `Expected a land after ${mulligansTaken} mulligan redraw(s)`).toBe(true);

  const keepBottom = page.getByRole('button', { name: /Keep, Bottom \d+/ });
  if (await keepBottom.isVisible().catch(() => false)) {
    const label = await keepBottom.innerText();
    const requiredBottoms = Number(label.match(/\d+/)?.[0] || '0');
    await keepBottom.click();
    await expect(page.getByRole('button', { name: 'Keep Selected' })).toBeVisible({ timeout: 15000 });

    const bottomCandidates = await visibleHandCards(page);
    const nonLands = bottomCandidates.filter(card => !isLandLike(card));
    const picks = (nonLands.length >= requiredBottoms ? nonLands : bottomCandidates).slice(0, requiredBottoms);
    for (const card of picks) {
      await selectHandCard(page, card.index);
    }

    await page.getByRole('button', { name: 'Keep Selected' }).click();
    return;
  }

  await page.getByRole('button', { name: 'Keep' }).click();
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
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('2 commanders detected');
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('1v1 Engine Practice');
  await expect(page.getByText('Deck has 101 cards (maximum is 100)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose Opponent' })).toBeVisible();
});

test('Moxfield-exported partner commander singleton duplicates are repaired before engine practice', async ({ page, baseURL }) => {
  test.skip(Boolean(baseURL && /127\.0\.0\.1|localhost/.test(baseURL)), 'Requires hosted backend URL import endpoint.');

  await page.goto('/play?e2e=partner-moxfield-repair');
  await clearOverlays(page);

  await page.getByRole('button', { name: 'Paste Decklist' }).click();
  await page.locator('textarea').fill(DARGO_THRASIOS_REPAIR_DECKLIST);
  await page.getByRole('button', { name: 'Import Deck' }).click();

  await expect(page.getByText('Dargo, the Shipwrecker // Thrasios, Triton Hero')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('100 cards')).toBeVisible();
  await expect(page.getByText("Duplicate non-basic card: 'Scalding Tarn'")).toHaveCount(0);
  await expect(page.getByText('Deck has only 99 cards')).toHaveCount(0);
  await expect(page.getByText('Removed duplicate non-basic copy for Commander singleton rules: Scalding Tarn')).toBeVisible();
  await expect(page.getByText('Filled 1 missing card for practice.')).toBeVisible();
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('2 commanders detected');
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('Dargo, the Shipwrecker');
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('Thrasios, Triton Hero');
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('Duplicate singleton repair was applied');
  await expect(page.getByRole('button', { name: 'Choose Opponent' })).toBeVisible();
});

test('Moxfield URL partner commander deck imports, repairs, starts, and plays from browser', async ({ page, baseURL }) => {
  test.skip(Boolean(baseURL && /127\.0\.0\.1|localhost/.test(baseURL)), 'Requires hosted backend URL import and Shelector services.');

  await page.goto('/play?e2e=moxfield-url-partner-start');
  await clearOverlays(page);

  await page.getByPlaceholder('https://www.moxfield.com/decks/...').fill('https://moxfield.com/decks/6PzAgSJtFUirDSqAxkRV6Q');
  await page.getByRole('button', { name: 'Import Deck' }).click();

  await expect(page.getByText('Dargo, the Shipwrecker // Thrasios, Triton Hero')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('100 cards')).toBeVisible();
  await expect(page.getByText("Duplicate non-basic card: 'Scalding Tarn'")).toHaveCount(0);
  await expect(page.getByText('Deck has only 99 cards')).toHaveCount(0);
  await expect(page.getByText('Removed duplicate non-basic copy for Commander singleton rules: Scalding Tarn')).toBeVisible();
  await expect(page.getByText('Filled 1 missing card for practice.')).toBeVisible();
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('2 commanders detected');
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('Dargo, the Shipwrecker');
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('Thrasios, Triton Hero');

  await page.getByRole('button', { name: 'Choose Opponent' }).click();
  await expect(page.getByRole('button', { name: 'Start 1v1' })).toBeVisible();
  await page.getByRole('button', { name: 'Start 1v1' }).click();

  await expect(page.getByText('You — Dargo, the Shipwrecker // Thrasios, Triton Hero')).toBeVisible({ timeout: 45000 });
  const humanCommandZone = page.getByTestId('human-command-zone');
  await expect(humanCommandZone).toBeVisible();
  await expect(humanCommandZone.getByText('2 Commanders')).toBeVisible();
  await expect(humanCommandZone.getByText('Dargo, the Shipwrecker')).toBeVisible();
  await expect(humanCommandZone.getByText('Thrasios, Triton Hero')).toBeVisible();

  await keepPlayableOpeningHand(page);
  const playableLand = page.getByRole('button', { name: /^Play / }).first();
  await expect(playableLand).toBeVisible({ timeout: 15000 });
  await playableLand.click();
  await expect(page.getByText('Lands', { exact: true }).first()).toBeVisible();
  await expect(humanCommandZone.getByText('Dargo, the Shipwrecker')).toBeVisible();
  await expect(humanCommandZone.getByText('Thrasios, Triton Hero')).toBeVisible();
});

test('MTGGoldfish partner commander deck starts and plays from the browser', async ({ page, baseURL }) => {
  test.skip(Boolean(baseURL && /127\.0\.0\.1|localhost/.test(baseURL)), 'Requires hosted backend URL import and Shelector services.');

  await page.goto('/play?e2e=partner-play');
  await clearOverlays(page);

  await page.getByPlaceholder('https://www.moxfield.com/decks/...').fill('https://www.mtggoldfish.com/deck/7767508#paper');
  await page.getByRole('button', { name: 'Import Deck' }).click();
  await expect(page.getByText('Dargo, the Shipwrecker // Tymna the Weaver')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('100 cards')).toBeVisible();
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('2 commanders detected');

  await page.getByRole('button', { name: 'Choose Opponent' }).click();
  await expect(page.getByRole('button', { name: 'Start 1v1' })).toBeVisible();
  await page.getByRole('button', { name: 'Start 1v1' }).click();

  await expect(page.getByText('You — Dargo, the Shipwrecker // Tymna the Weaver')).toBeVisible({ timeout: 45000 });
  const humanCommandZone = page.getByTestId('human-command-zone');
  await expect(humanCommandZone).toBeVisible();
  await expect(humanCommandZone.getByText('2 Commanders')).toBeVisible();
  await expect(humanCommandZone.getByText('Dargo, the Shipwrecker')).toBeVisible();
  await expect(humanCommandZone.getByText('Tymna the Weaver')).toBeVisible();
  await expect(humanCommandZone.getByText('PARTNER').first()).toBeVisible();

  await keepPlayableOpeningHand(page);
  const playableLand = page.getByRole('button', { name: /^Play / }).first();
  await expect(playableLand).toBeVisible({ timeout: 15000 });
  await playableLand.click();
  await expect(page.getByText('Lands', { exact: true }).first()).toBeVisible();
  await expect(humanCommandZone.getByText('Dargo, the Shipwrecker')).toBeVisible();
  await expect(humanCommandZone.getByText('Tymna the Weaver')).toBeVisible();

  const castHope = page.getByRole('button', { name: 'Cast Hope of Ghirapur' });
  if (await castHope.isVisible().catch(() => false)) {
    await castHope.click();
    await expect(page.getByText('Hope of Ghirapur').first()).toBeVisible({ timeout: 20000 });
  }

  const skipRest = page.getByRole('button', { name: 'Skip Rest of Turn' }).last();
  if (await skipRest.isVisible().catch(() => false)) {
    await skipRest.click();
    await expect(page.getByText('You — Dargo, the Shipwrecker // Tymna the Weaver')).toBeVisible({ timeout: 30000 });
    await expect(humanCommandZone.getByText('Dargo, the Shipwrecker')).toBeVisible();
    await expect(humanCommandZone.getByText('Tymna the Weaver')).toBeVisible();
  }
});

test('Moxfield-exported partner commander command zone remains visible on mobile engine practice', async ({ page, baseURL }) => {
  test.skip(Boolean(baseURL && /127\.0\.0\.1|localhost/.test(baseURL)), 'Requires hosted backend URL import and Shelector services.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/play?e2e=partner-mobile-command-zone');
  await clearOverlays(page);

  await page.getByRole('button', { name: 'Paste Decklist' }).click();
  await page.locator('textarea').fill(DARGO_THRASIOS_REPAIR_DECKLIST);
  await page.getByRole('button', { name: 'Import Deck' }).click();
  await expect(page.getByText('Dargo, the Shipwrecker // Thrasios, Triton Hero')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('partner-engine-readiness')).toContainText('2 commanders detected');

  await page.getByRole('button', { name: 'Choose Opponent' }).click();
  await expect(page.getByRole('button', { name: 'Start 1v1' })).toBeVisible();
  await page.getByRole('button', { name: 'Start 1v1' }).click();

  const humanCommandZone = page.getByTestId('human-command-zone');
  await expect(humanCommandZone).toBeVisible({ timeout: 45000 });
  await expect(humanCommandZone.getByText('2 Commanders')).toBeVisible();
  await expect(humanCommandZone.getByText('Dargo, the Shipwrecker')).toBeVisible();
  await expect(humanCommandZone.getByText('Thrasios, Triton Hero')).toBeVisible();
});
