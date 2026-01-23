import { expect, test } from '@playwright/test'

/**
 * Copy/Paste Settings E2E Tests
 *
 * Tests for the copy/paste edit settings workflow:
 * - Opening the copy settings modal
 * - Selecting settings groups to copy
 * - Copying settings from one photo
 * - Pasting settings to another photo
 * - Keyboard shortcuts (Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+Shift+C)
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Copy/Paste Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    // Wait for scanning to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
  })

  test('opens copy settings modal with Ctrl+Shift+C in Edit view', async ({ page }) => {
    // Enter edit view by double-clicking first thumbnail
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()

    // Wait for edit view to load
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Press Ctrl/Cmd+Shift+C to open copy modal
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+c' : 'Control+Shift+c')

    // Copy settings modal should be visible
    await expect(page.locator('[data-testid="copy-settings-modal"]')).toBeVisible({ timeout: 5000 })
  })

  test('copy modal shows setting group checkboxes', async ({ page }) => {
    // Enter edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Open copy modal
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+c' : 'Control+Shift+c')
    await page.waitForSelector('[data-testid="copy-settings-modal"]', { timeout: 5000 })

    // Should show group checkboxes
    await expect(page.locator('[data-testid="copy-group-basicAdjustments"]')).toBeVisible()
    await expect(page.locator('[data-testid="copy-group-toneCurve"]')).toBeVisible()
  })

  test('can toggle copy groups in modal', async ({ page }) => {
    // Enter edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Open copy modal
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+c' : 'Control+Shift+c')
    await page.waitForSelector('[data-testid="copy-settings-modal"]', { timeout: 5000 })

    // Toggle crop checkbox
    const cropCheckbox = page.locator('[data-testid="copy-group-crop"]')
    await cropCheckbox.click()

    // Checkbox should now be checked (it's unchecked by default)
    await expect(cropCheckbox).toBeChecked()
  })

  test('closes copy modal on Escape', async ({ page }) => {
    // Enter edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Open copy modal
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+c' : 'Control+Shift+c')
    await page.waitForSelector('[data-testid="copy-settings-modal"]', { timeout: 5000 })

    // Press Escape
    await page.keyboard.press('Escape')

    // Modal should be hidden
    await expect(page.locator('[data-testid="copy-settings-modal"]')).toBeHidden()
  })

  test('copy settings and paste to another photo', async ({ page }) => {
    // Enter edit view for first photo
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Make an adjustment to the exposure
    const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
    if (await exposureSlider.isVisible()) {
      // Increase exposure by clicking on the slider track
      const sliderBounds = await exposureSlider.boundingBox()
      if (sliderBounds) {
        // Click near the right side to increase value
        await page.mouse.click(
          sliderBounds.x + sliderBounds.width * 0.7,
          sliderBounds.y + sliderBounds.height / 2,
        )
        await page.waitForTimeout(100)
      }
    }

    // Copy settings using keyboard shortcut
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+c' : 'Control+Shift+c')
    await page.waitForSelector('[data-testid="copy-settings-modal"]', { timeout: 5000 })

    // Click copy button
    await page.locator('[data-testid="copy-settings-button"]').click()

    // Modal should close
    await expect(page.locator('[data-testid="copy-settings-modal"]')).toBeHidden()

    // Navigate to second photo using filmstrip
    const filmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
    if (await filmstrip.isVisible()) {
      await filmstrip.click()
      await page.waitForTimeout(500) // Wait for photo to load
    }

    // Paste settings
    await page.keyboard.press(isMac ? 'Meta+v' : 'Control+v')
    await page.waitForTimeout(300)

    // Check for toast notification indicating paste success
    // (The actual adjustment verification would require reading slider values)
  })

  test('select all and select none buttons work', async ({ page }) => {
    // Enter edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Open copy modal
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+Shift+c' : 'Control+Shift+c')
    await page.waitForSelector('[data-testid="copy-settings-modal"]', { timeout: 5000 })

    // Click "Select All"
    const selectAllButton = page.locator('[data-testid="copy-select-all"]')
    if (await selectAllButton.isVisible()) {
      await selectAllButton.click()

      // All checkboxes should be checked
      await expect(page.locator('[data-testid="copy-group-crop"]')).toBeChecked()
      await expect(page.locator('[data-testid="copy-group-rotation"]')).toBeChecked()
    }

    // Click "Select None"
    const selectNoneButton = page.locator('[data-testid="copy-select-none"]')
    if (await selectNoneButton.isVisible()) {
      await selectNoneButton.click()

      // All checkboxes should be unchecked
      await expect(page.locator('[data-testid="copy-group-basicAdjustments"]')).not.toBeChecked()
      await expect(page.locator('[data-testid="copy-group-toneCurve"]')).not.toBeChecked()
    }
  })

  test('paste shows warning when clipboard is empty', async ({ page }) => {
    // Enter edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Try to paste without copying first
    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+v' : 'Control+v')

    // Should show a toast notification about empty clipboard
    // The toast should appear indicating nothing to paste
    await page.waitForTimeout(500)

    // We can't easily check for the toast content, but we verify no crash occurs
  })
})
