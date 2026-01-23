import { expect, test } from '@playwright/test'

/**
 * Basic E2E Tests
 *
 * Simple smoke tests to verify the app loads correctly.
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 * The welcome screen is shown briefly then replaced by the catalog grid.
 */

test.describe('Home Page', () => {
  test('app loads and shows catalog', async ({ page }) => {
    await page.goto('/')

    // In demo mode, catalog auto-loads
    // Wait for catalog grid to appear
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // Catalog page should be visible
    await expect(page.locator('[data-testid="catalog-page"]')).toBeVisible()
  })

  test('has filter bar in catalog view', async ({ page }) => {
    await page.goto('/')

    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })

    // Filter bar should be visible
    const filterBar = page.locator('[data-testid="filter-bar"]')
    await expect(filterBar).toBeVisible()
  })
})
