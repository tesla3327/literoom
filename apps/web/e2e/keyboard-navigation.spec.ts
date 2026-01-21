import { expect, test } from '@playwright/test'

/**
 * Keyboard Navigation E2E Tests
 *
 * Tests for keyboard shortcuts including:
 * - Arrow key navigation in grid
 * - Flag shortcuts (P/X/U)
 * - View mode switching
 */

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Click choose folder to load demo catalog
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await chooseButton.click()
    // Wait for catalog grid to appear
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10000 })
    // Wait for scanning to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 10000 })
    // Click first thumbnail to select it (more reliable than focus)
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.click()
    // Wait for selection to be applied
    await expect(firstThumbnail).toHaveAttribute('data-current', 'true')
  })

  test('arrow right navigates to next item', async ({ page }) => {
    // First item should be current after setup
    const currentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    const currentIndex = await currentThumbnail.getAttribute('data-index')

    // Press right arrow
    await page.keyboard.press('ArrowRight')

    // A different item should now be current
    const newCurrentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    await expect(newCurrentThumbnail).toBeVisible()
    const newIndex = await newCurrentThumbnail.getAttribute('data-index')
    expect(parseInt(newIndex || '0', 10)).toBe(parseInt(currentIndex || '0', 10) + 1)
  })

  test('arrow left navigates to previous item', async ({ page }) => {
    // Navigate right first to have room to go left
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(50)

    const currentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    const currentIndex = await currentThumbnail.getAttribute('data-index')

    // Press left arrow
    await page.keyboard.press('ArrowLeft')

    // Previous item should be current
    const newCurrentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    await expect(newCurrentThumbnail).toBeVisible()
    const newIndex = await newCurrentThumbnail.getAttribute('data-index')
    expect(parseInt(newIndex || '1', 10)).toBe(parseInt(currentIndex || '1', 10) - 1)
  })

  test('P key picks current photo', async ({ page }) => {
    const currentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')

    // Press P to pick
    await page.keyboard.press('p')

    // Wait for flag update
    await page.waitForTimeout(100)

    // Check that the flag is set to pick
    await expect(currentThumbnail).toHaveAttribute('data-flag', 'pick')
  })

  test('X key rejects current photo', async ({ page }) => {
    const currentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')

    // Press X to reject
    await page.keyboard.press('x')

    // Wait for flag update
    await page.waitForTimeout(100)

    // Check that the flag is set to reject
    await expect(currentThumbnail).toHaveAttribute('data-flag', 'reject')
  })

  test('U key clears flag from current photo', async ({ page }) => {
    const currentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')

    // First pick the photo (to ensure it has a flag to clear)
    await page.keyboard.press('p')
    await page.waitForTimeout(100)
    await expect(currentThumbnail).toHaveAttribute('data-flag', 'pick')

    // Then clear the flag
    await page.keyboard.press('u')
    await page.waitForTimeout(100)

    // Flag should be cleared
    await expect(currentThumbnail).toHaveAttribute('data-flag', 'none')
  })

  test('flag changes persist while navigating', async ({ page }) => {
    // Get current item and pick it
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    const firstAssetId = await firstThumbnail.getAttribute('data-asset-id')
    await page.keyboard.press('p')
    await page.waitForTimeout(100)

    // Navigate to second photo
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(50)

    // Reject the second photo
    const secondThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    const secondAssetId = await secondThumbnail.getAttribute('data-asset-id')
    await page.keyboard.press('x')
    await page.waitForTimeout(100)

    // Navigate back to first
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(50)

    // First should still be picked (find by asset id)
    const firstByAssetId = page.locator(`[data-testid="catalog-thumbnail"][data-asset-id="${firstAssetId}"]`)
    await expect(firstByAssetId).toHaveAttribute('data-flag', 'pick')

    // Second should still be rejected
    const secondByAssetId = page.locator(`[data-testid="catalog-thumbnail"][data-asset-id="${secondAssetId}"]`)
    await expect(secondByAssetId).toHaveAttribute('data-flag', 'reject')
  })

  test('arrow navigation works when grid is focused', async ({ page }) => {
    // Get current position
    const currentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    await expect(currentThumbnail).toBeVisible()

    // Keyboard should work - navigate right
    await page.keyboard.press('ArrowRight')

    // A new item should be current
    const newCurrentThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    await expect(newCurrentThumbnail).toBeVisible()
  })
})
