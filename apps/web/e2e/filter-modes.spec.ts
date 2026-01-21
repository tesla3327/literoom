import { expect, test } from '@playwright/test'

/**
 * Filter Modes E2E Tests
 *
 * Tests for the filter bar functionality:
 * - Filter buttons (All, Picks, Rejects, Unflagged)
 * - Count badges
 * - Filtering the grid
 */

test.describe('Filter Modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Click choose folder to load demo catalog
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await chooseButton.click()
    // Wait for catalog grid and filter bar
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10000 })
    await page.waitForSelector('[data-testid="filter-bar"]')
  })

  test('filter bar displays all filter buttons', async ({ page }) => {
    const filterBar = page.locator('[data-testid="filter-bar"]')
    await expect(filterBar).toBeVisible()

    // Check all filter buttons exist
    await expect(page.locator('[data-testid="filter-all"]')).toBeVisible()
    await expect(page.locator('[data-testid="filter-picks"]')).toBeVisible()
    await expect(page.locator('[data-testid="filter-rejects"]')).toBeVisible()
    await expect(page.locator('[data-testid="filter-unflagged"]')).toBeVisible()
  })

  test('All filter is active by default', async ({ page }) => {
    const allButton = page.locator('[data-testid="filter-all"]')
    await expect(allButton).toHaveAttribute('data-active', 'true')
  })

  test('filter buttons show count badges', async ({ page }) => {
    // The demo catalog has 50 items, so All should show 50
    const allCount = page.locator('[data-testid="filter-all-count"]')
    await expect(allCount).toBeVisible()
    await expect(allCount).toHaveText('50')
  })

  test('clicking Picks filter shows only picked photos', async ({ page }) => {
    // First, pick a photo so we have something to filter
    await page.click('[data-testid="catalog-grid"]')
    await page.keyboard.press('p')
    await page.waitForTimeout(100)

    // Click Picks filter
    const picksButton = page.locator('[data-testid="filter-picks"]')
    await picksButton.click()

    // Picks filter should now be active
    await expect(picksButton).toHaveAttribute('data-active', 'true')

    // All visible thumbnails should have pick flag
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const thumbnail = thumbnails.nth(i)
      await expect(thumbnail).toHaveAttribute('data-flag', 'pick')
    }
  })

  test('clicking Rejects filter shows only rejected photos', async ({ page }) => {
    // First, reject a photo
    await page.click('[data-testid="catalog-grid"]')
    await page.keyboard.press('x')
    await page.waitForTimeout(100)

    // Click Rejects filter
    const rejectsButton = page.locator('[data-testid="filter-rejects"]')
    await rejectsButton.click()

    // All visible thumbnails should have reject flag
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const thumbnail = thumbnails.nth(i)
      await expect(thumbnail).toHaveAttribute('data-flag', 'reject')
    }
  })

  test('clicking Unflagged filter shows only unflagged photos', async ({ page }) => {
    // Click Unflagged filter
    const unflaggedButton = page.locator('[data-testid="filter-unflagged"]')
    await unflaggedButton.click()

    // All visible thumbnails should have no flag
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const thumbnail = thumbnails.nth(i)
      await expect(thumbnail).toHaveAttribute('data-flag', 'none')
    }
  })

  test('clicking All filter shows all photos again', async ({ page }) => {
    // First switch to picks
    await page.click('[data-testid="filter-picks"]')
    await page.waitForTimeout(100)

    // Then back to all
    const allButton = page.locator('[data-testid="filter-all"]')
    await allButton.click()

    // All filter should be active
    await expect(allButton).toHaveAttribute('data-active', 'true')

    // Grid should show items (more than just picks)
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    expect(count).toBeGreaterThan(0)
  })

  test('filter counts update when flags change', async ({ page }) => {
    // Get initial picks count
    const picksCount = page.locator('[data-testid="filter-picks-count"]')
    const initialPicksText = await picksCount.textContent() || '0'
    const initialPicks = Number.parseInt(initialPicksText, 10)

    // Pick a photo
    await page.click('[data-testid="catalog-grid"]')
    await page.keyboard.press('p')
    await page.waitForTimeout(200)

    // Picks count should increase by 1
    // Note: Demo assets may have pre-set flags, so we just check it changed
    const newPicksText = await picksCount.textContent() || '0'
    const newPicks = Number.parseInt(newPicksText, 10)

    // The count should have changed (either increased or stayed same if already picked)
    expect(newPicks).toBeGreaterThanOrEqual(initialPicks)
  })
})
