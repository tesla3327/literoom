import { expect, test } from '@playwright/test'

/**
 * Export Workflow E2E Tests
 *
 * Tests for the export workflow:
 * - Opening the export modal
 * - Configuring export options (scope, quality, filename template)
 * - Export button state based on configuration
 * - Keyboard shortcuts (Ctrl/Cmd+Shift+E)
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 * Actual file system export is mocked - we test the UI flow only.
 */

test.describe('Export Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    // Wait for scanning to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
  })

  test('opens export modal from export button', async ({ page }) => {
    // Click the export button in the filter bar
    const exportButton = page.locator('[data-testid="export-button"]')
    await expect(exportButton).toBeVisible()
    await exportButton.click()

    // Export modal should be visible
    await expect(page.locator('[data-testid="export-modal"]')).toBeVisible({ timeout: 5000 })
  })

  test('opens export modal with keyboard shortcut', async ({ page }) => {
    // Press Ctrl/Cmd+Shift+E to open export modal
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+e' : 'Control+Shift+e')

    // Export modal should be visible
    await expect(page.locator('[data-testid="export-modal"]')).toBeVisible({ timeout: 5000 })
  })

  test('shows export scope options', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Should show scope buttons
    await expect(page.locator('[data-testid="export-scope-picks"]')).toBeVisible()
    await expect(page.locator('[data-testid="export-scope-selected"]')).toBeVisible()
    await expect(page.locator('[data-testid="export-scope-all"]')).toBeVisible()
  })

  test('can change export scope', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Click "All" scope
    await page.locator('[data-testid="export-scope-all"]').click()

    // Export count should update (demo mode has multiple images)
    const exportCount = page.locator('[data-testid="export-count"]')
    await expect(exportCount).toContainText('images will be exported')
  })

  test('can edit filename template', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Edit filename template
    const templateInput = page.locator('[data-testid="export-filename-template"]')
    await templateInput.fill('{orig}_export_{seq:3}')

    // Template should be updated
    await expect(templateInput).toHaveValue('{orig}_export_{seq:3}')
  })

  test('closes export modal on cancel', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Click cancel button
    await page.locator('[data-testid="export-cancel-button"]').click()

    // Modal should be hidden
    await expect(page.locator('[data-testid="export-modal"]')).toBeHidden()
  })

  test('closes export modal on Escape', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Press Escape
    await page.keyboard.press('Escape')

    // Modal should be hidden
    await expect(page.locator('[data-testid="export-modal"]')).toBeHidden()
  })

  test('export button is disabled when no destination is selected', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Change scope to all to ensure we have images to export
    await page.locator('[data-testid="export-scope-all"]').click()
    await page.waitForTimeout(100)

    // Export submit button should be disabled (no destination folder selected)
    const submitButton = page.locator('[data-testid="export-submit-button"]')
    await expect(submitButton).toBeDisabled()
  })

  test('shows "No folder selected" when destination is empty', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Should show "No folder selected" text
    await expect(page.getByText('No folder selected')).toBeVisible()
  })

  test('scope defaults to picks', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Picks button should be styled as selected (has bg-gray-700 class)
    const picksButton = page.locator('[data-testid="export-scope-picks"]')
    await expect(picksButton).toHaveClass(/bg-gray-700/)
  })

  test('export button shows correct count', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Select "All" scope
    await page.locator('[data-testid="export-scope-all"]').click()
    await page.waitForTimeout(100)

    // Submit button text should include count
    const submitButton = page.locator('[data-testid="export-submit-button"]')
    const buttonText = await submitButton.textContent()
    expect(buttonText).toMatch(/Export \d+ Images?/)
  })

  test('shows filename template tokens help text', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Should show help text about tokens
    await expect(page.getByText('{orig}')).toBeVisible()
    await expect(page.getByText('{seq:4}')).toBeVisible()
    await expect(page.getByText('{date}')).toBeVisible()
  })

  test('shows quality slider', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Should show quality label
    await expect(page.getByText('JPEG Quality:')).toBeVisible()
  })

  test('shows resize options', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Should show resize label
    await expect(page.getByText('Resize (Long Edge)')).toBeVisible()

    // Should show preset options
    await expect(page.getByText('None')).toBeVisible()
    await expect(page.getByText('2048px')).toBeVisible()
  })

  test('export modal header shows correct title', async ({ page }) => {
    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Should show "Export Images" title
    await expect(page.getByText('Export Images')).toBeVisible()
  })

  test('can pick flagged images and export them', async ({ page }) => {
    // First, flag some images as picks
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.click()

    // Press P to flag as pick
    await page.keyboard.press('p')
    await page.waitForTimeout(100)

    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // With "Picks" scope (default), should show 1 image
    const exportCount = page.locator('[data-testid="export-count"]')
    await expect(exportCount).toContainText('1 image will be exported')
  })

  test('switching to selected scope shows selected count', async ({ page }) => {
    // Select multiple thumbnails
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.click()

    // Ctrl/Cmd+click to add second thumbnail to selection
    const secondThumbnail = page.locator('[data-testid="catalog-thumbnail"]').nth(1)
    const isMac = process.platform === 'darwin'
    await secondThumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] })

    // Open export modal
    const exportButton = page.locator('[data-testid="export-button"]')
    await exportButton.click()
    await page.waitForSelector('[data-testid="export-modal"]', { timeout: 5000 })

    // Switch to "Selected" scope
    await page.locator('[data-testid="export-scope-selected"]').click()
    await page.waitForTimeout(100)

    // Should show 2 images selected
    const exportCount = page.locator('[data-testid="export-count"]')
    await expect(exportCount).toContainText('2 images will be exported')
  })
})
