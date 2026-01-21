import { expect, test } from '@playwright/test'

/**
 * Catalog Grid E2E Tests
 *
 * Tests for the main photo grid display and virtual scrolling.
 * These tests run in demo mode with mock catalog data.
 */

test.describe('Catalog Grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Click choose folder to load demo catalog
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await chooseButton.click()
    // Wait for catalog grid to appear and scanning to finish
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10000 })
    // Wait for scanning to complete (no longer showing "Scanning...")
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 10000 })
  })

  test('displays grid with thumbnails', async ({ page }) => {
    const grid = page.locator('[data-testid="catalog-grid"]')
    await expect(grid).toBeVisible()

    // Demo catalog should have thumbnails visible
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    // Virtual scrolling means not all items are rendered, but some should be visible
    expect(count).toBeGreaterThan(0)
  })

  test('virtual scrolling renders items appropriately', async ({ page }) => {
    // Get the count from the filter bar to know total items
    const allCount = await page.locator('[data-testid="filter-all-count"]').textContent()
    const totalItems = parseInt(allCount || '0', 10)

    // Check rendered items
    const rendered = await page.locator('[data-testid="catalog-thumbnail"]').count()

    // If catalog is small enough to fit in viewport, all items may be rendered
    // Otherwise, virtual scrolling should limit rendered count
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThanOrEqual(totalItems)
  })

  test('scrolling maintains grid functionality', async ({ page }) => {
    const grid = page.locator('[data-testid="catalog-grid"]')

    // Scroll down in the grid
    await grid.evaluate((el) => {
      el.scrollTop = 500
    })

    // Wait for virtualization to update
    await page.waitForTimeout(200)

    // Items should still render after scrolling
    const rendered = await page.locator('[data-testid="catalog-thumbnail"]').count()
    expect(rendered).toBeGreaterThan(0)
  })

  test('clicking thumbnail selects it', async ({ page }) => {
    // Click the first thumbnail
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.click()

    // It should become the current item
    await expect(firstThumbnail).toHaveAttribute('data-current', 'true')
  })

  test('thumbnails show loading or ready state', async ({ page }) => {
    // Thumbnails should be visible
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const firstThumbnail = thumbnails.first()

    await expect(firstThumbnail).toBeVisible()

    // The thumbnail should have either a loading skeleton or an image
    // In demo mode, thumbnails should resolve quickly
    await page.waitForTimeout(500)

    // Check that the thumbnail has content (either loading state or image)
    const hasContent = await firstThumbnail.evaluate((el) => {
      return el.querySelector('img') !== null || el.querySelector('.skeleton') !== null
    })
    expect(hasContent).toBe(true)
  })
})
