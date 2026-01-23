import { expect, test } from '@playwright/test'

/**
 * Help Modal E2E Tests
 *
 * Tests for the keyboard shortcuts help modal including:
 * - Opening/closing the modal
 * - Keyboard shortcuts (? and Cmd/Ctrl+/)
 * - Modal content verification
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Help Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
  })

  test('? key opens help modal', async ({ page }) => {
    // Press ? key
    await page.keyboard.press('?')

    // Modal should appear
    const modal = page.locator('[data-testid="help-modal"]')
    await expect(modal).toBeVisible({ timeout: 5000 })
  })

  test('Escape closes help modal', async ({ page }) => {
    // Open modal first
    await page.keyboard.press('?')
    const modal = page.locator('[data-testid="help-modal"]')
    await expect(modal).toBeVisible()

    // Press Escape
    await page.keyboard.press('Escape')

    // Modal should be hidden
    await expect(modal).not.toBeVisible()
  })

  test('? key toggles help modal', async ({ page }) => {
    const modal = page.locator('[data-testid="help-modal"]')

    // Initially hidden
    await expect(modal).not.toBeVisible()

    // First ? opens it
    await page.keyboard.press('?')
    await expect(modal).toBeVisible()

    // Second ? closes it
    await page.keyboard.press('?')
    await expect(modal).not.toBeVisible()
  })

  test('help modal shows keyboard shortcuts', async ({ page }) => {
    // Open modal
    await page.keyboard.press('?')
    const modal = page.locator('[data-testid="help-modal"]')
    await expect(modal).toBeVisible()

    // Check for common shortcuts in the modal
    // Navigation shortcuts
    await expect(modal.getByText('Arrow Keys')).toBeVisible()

    // Flag shortcuts
    await expect(modal.getByText(/P.*Pick/i)).toBeVisible()
    await expect(modal.getByText(/X.*Reject/i)).toBeVisible()
    await expect(modal.getByText(/U.*Unflag/i)).toBeVisible()

    // View shortcuts
    await expect(modal.getByText(/E.*Edit/i)).toBeVisible()
    await expect(modal.getByText(/G.*Grid/i)).toBeVisible()
  })

  test('clicking outside modal closes it', async ({ page }) => {
    // Open modal
    await page.keyboard.press('?')
    const modal = page.locator('[data-testid="help-modal"]')
    await expect(modal).toBeVisible()

    // Click outside the modal (on the overlay/backdrop)
    // The overlay should be behind the modal
    await page.locator('[data-testid="help-modal-overlay"]').click({ force: true })

    // Modal should close
    await expect(modal).not.toBeVisible()
  })

  test('close button closes modal', async ({ page }) => {
    // Open modal
    await page.keyboard.press('?')
    const modal = page.locator('[data-testid="help-modal"]')
    await expect(modal).toBeVisible()

    // Click close button
    const closeButton = modal.locator('[data-testid="help-modal-close"]')
    await closeButton.click()

    // Modal should close
    await expect(modal).not.toBeVisible()
  })

  test('help modal works in edit view', async ({ page }) => {
    // Navigate to edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()

    // Wait for edit view to load
    await page.waitForSelector('[data-testid="edit-preview"]', { timeout: 15000 })

    // Press ? to open help modal
    await page.keyboard.press('?')

    // Modal should appear
    const modal = page.locator('[data-testid="help-modal"]')
    await expect(modal).toBeVisible()

    // Should show edit-specific shortcuts
    await expect(modal.getByText(/J.*Clipping/i)).toBeVisible()
  })

  test('shortcuts are ignored when typing in input', async ({ page }) => {
    // Find an input field if available or create test scenario
    // For now, just verify the modal doesn't open when an input is focused

    // This test would need an actual input field on the page
    // Skip if no input is easily accessible in demo mode
    test.skip(true, 'Need input field for this test')
  })
})
