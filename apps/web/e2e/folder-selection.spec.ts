import { expect, test } from '@playwright/test'

/**
 * Folder Selection E2E Tests
 *
 * Tests for the folder selection workflow in demo mode.
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 * The welcome screen is shown briefly then replaced by the catalog grid.
 * Tests should account for this auto-load behavior.
 */

test.describe('Folder Selection (Demo Mode)', () => {
  test('demo mode auto-loads catalog', async ({ page }) => {
    await page.goto('/')

    // In demo mode, the catalog should auto-load
    // Wait for the catalog grid to appear
    const grid = page.locator('[data-testid="catalog-grid"]')
    await expect(grid).toBeVisible({ timeout: 15000 })

    // Thumbnails should be present
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    await expect(thumbnails.first()).toBeVisible({ timeout: 10000 })
  })

  test('demo mode shows demo folder name in header', async ({ page }) => {
    await page.goto('/')

    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // Demo folder name should be visible somewhere on page
    // Check the folder dropdown or header area
    const demoText = page.getByText('Demo Photos')
    await expect(demoText).toBeVisible({ timeout: 5000 })
  })

  test('filter bar appears after catalog loads', async ({ page }) => {
    await page.goto('/')

    // Wait for grid
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // Filter bar should be visible
    const filterBar = page.locator('[data-testid="filter-bar"]')
    await expect(filterBar).toBeVisible()
  })

  test('catalog page shows correct structure after loading', async ({ page }) => {
    await page.goto('/')

    // Wait for catalog grid (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // Check page structure
    const catalogPage = page.locator('[data-testid="catalog-page"]')
    await expect(catalogPage).toBeVisible()

    // Header should be visible
    const header = page.locator('header')
    await expect(header).toBeVisible()

    // Filter bar
    await expect(page.locator('[data-testid="filter-bar"]')).toBeVisible()

    // Grid
    await expect(page.locator('[data-testid="catalog-grid"]')).toBeVisible()
  })

  test('filter bar shows item counts', async ({ page }) => {
    await page.goto('/')

    // Wait for catalog grid
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // All count should show the total number of items
    const allCount = page.locator('[data-testid="filter-all-count"]')
    await expect(allCount).toBeVisible()

    // Should have some items (demo catalog has 50 items)
    const count = await allCount.textContent()
    expect(parseInt(count || '0', 10)).toBeGreaterThan(0)
  })

  test('thumbnails are visible after catalog loads', async ({ page }) => {
    await page.goto('/')

    // Wait for catalog grid
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // Wait for scanning to complete (no more "Scanning..." text)
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })

    // Thumbnails should be present
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    expect(count).toBeGreaterThan(0)
  })
})
