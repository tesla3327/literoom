import { expect, test } from '@playwright/test'

/**
 * Folder Selection E2E Tests
 *
 * Tests for the folder selection workflow in demo mode.
 * - Welcome screen display
 * - Choose folder button
 * - Demo catalog loading
 */

test.describe('Folder Selection (Demo Mode)', () => {
  test('home page shows welcome screen initially', async ({ page }) => {
    await page.goto('/')

    // Welcome screen should be visible
    const welcomeScreen = page.locator('[data-testid="welcome-screen"]')
    await expect(welcomeScreen).toBeVisible()

    // Should show app name
    await expect(page.locator('h1')).toContainText('Literoom')

    // Should show Choose Folder button
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await expect(chooseButton).toBeVisible()
  })

  test('shows demo mode indicator when in demo mode', async ({ page }) => {
    await page.goto('/')

    // Demo mode indicator should be visible
    const demoIndicator = page.getByText('Demo Mode')
    await expect(demoIndicator).toBeVisible()
  })

  test('choose folder button loads demo catalog', async ({ page }) => {
    await page.goto('/')

    // Click the choose folder button
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await chooseButton.click()

    // Wait for grid to appear (indicates catalog loaded)
    const grid = page.locator('[data-testid="catalog-grid"]')
    await expect(grid).toBeVisible({ timeout: 10000 })

    // Thumbnails should be present
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    await expect(thumbnails.first()).toBeVisible()
  })

  test('welcome screen is hidden after folder selection', async ({ page }) => {
    await page.goto('/')

    // Click choose folder
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await chooseButton.click()

    // Wait for grid
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10000 })

    // Welcome screen should be hidden
    const welcomeScreen = page.locator('[data-testid="welcome-screen"]')
    await expect(welcomeScreen).not.toBeVisible()
  })

  test('filter bar appears after folder selection', async ({ page }) => {
    await page.goto('/')

    // Click choose folder
    const chooseButton = page.locator('[data-testid="choose-folder-button"]')
    await chooseButton.click()

    // Wait for grid
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10000 })

    // Filter bar should be visible
    const filterBar = page.locator('[data-testid="filter-bar"]')
    await expect(filterBar).toBeVisible()
  })

  test('catalog page shows correct structure after loading', async ({ page }) => {
    await page.goto('/')

    // Load catalog
    await page.click('[data-testid="choose-folder-button"]')
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10000 })

    // Check page structure
    const catalogPage = page.locator('[data-testid="catalog-page"]')
    await expect(catalogPage).toBeVisible()

    // Header should show folder name
    // In demo mode, the folder path might be "Demo Photos" or similar
    const header = page.locator('.catalog-header')
    await expect(header).toBeVisible()

    // Filter bar
    await expect(page.locator('[data-testid="filter-bar"]')).toBeVisible()

    // Grid
    await expect(page.locator('[data-testid="catalog-grid"]')).toBeVisible()
  })
})
