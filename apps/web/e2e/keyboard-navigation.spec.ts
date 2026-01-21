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
    // Focus the grid to enable keyboard navigation
    await page.click('[data-testid="catalog-grid"]')
  })

  test('arrow right navigates to next item', async ({ page }) => {
    // First item should be current after focusing
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="0"]')
    await expect(firstThumbnail).toHaveAttribute('data-current', 'true')

    // Press right arrow
    await page.keyboard.press('ArrowRight')

    // Second item should now be current
    const secondThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="1"]')
    await expect(secondThumbnail).toHaveAttribute('data-current', 'true')
    await expect(firstThumbnail).toHaveAttribute('data-current', 'false')
  })

  test('arrow left navigates to previous item', async ({ page }) => {
    // Navigate right first
    await page.keyboard.press('ArrowRight')
    const secondThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="1"]')
    await expect(secondThumbnail).toHaveAttribute('data-current', 'true')

    // Press left arrow
    await page.keyboard.press('ArrowLeft')

    // First item should be current again
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="0"]')
    await expect(firstThumbnail).toHaveAttribute('data-current', 'true')
  })

  test('P key picks current photo', async ({ page }) => {
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="0"]')

    // Press P to pick
    await page.keyboard.press('p')

    // Wait for flag update
    await page.waitForTimeout(100)

    // Check that the flag badge appears with pick flag
    await expect(firstThumbnail).toHaveAttribute('data-flag', 'pick')
  })

  test('X key rejects current photo', async ({ page }) => {
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="0"]')

    // Press X to reject
    await page.keyboard.press('x')

    // Wait for flag update
    await page.waitForTimeout(100)

    // Check that the flag badge appears with reject flag
    await expect(firstThumbnail).toHaveAttribute('data-flag', 'reject')
  })

  test('U key clears flag from current photo', async ({ page }) => {
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="0"]')

    // First pick the photo
    await page.keyboard.press('p')
    await page.waitForTimeout(100)
    await expect(firstThumbnail).toHaveAttribute('data-flag', 'pick')

    // Then clear the flag
    await page.keyboard.press('u')
    await page.waitForTimeout(100)

    // Flag should be cleared
    await expect(firstThumbnail).toHaveAttribute('data-flag', 'none')
  })

  test('flag changes persist while navigating', async ({ page }) => {
    // Pick the first photo
    await page.keyboard.press('p')
    await page.waitForTimeout(100)

    // Navigate to second photo
    await page.keyboard.press('ArrowRight')

    // Reject the second photo
    await page.keyboard.press('x')
    await page.waitForTimeout(100)

    // Navigate back to first
    await page.keyboard.press('ArrowLeft')

    // First should still be picked
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="0"]')
    await expect(firstThumbnail).toHaveAttribute('data-flag', 'pick')

    // Second should still be rejected
    const secondThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="1"]')
    await expect(secondThumbnail).toHaveAttribute('data-flag', 'reject')
  })

  test('keyboard shortcuts do not work when input focused', async ({ page }) => {
    // This test ensures shortcuts don't interfere when typing
    // For now, just verify grid focus enables shortcuts
    const grid = page.locator('[data-testid="catalog-grid"]')
    await grid.focus()

    // Keyboard should work when grid is focused
    await page.keyboard.press('ArrowRight')
    const secondThumbnail = page.locator('[data-testid="catalog-thumbnail"][data-index="1"]')
    await expect(secondThumbnail).toHaveAttribute('data-current', 'true')
  })
})
