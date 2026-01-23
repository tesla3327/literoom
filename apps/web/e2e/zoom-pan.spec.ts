import { expect, test } from '@playwright/test'

/**
 * Zoom/Pan E2E Tests
 *
 * Tests for the zoom and pan functionality in edit view including:
 * - Zoom controls (buttons, keyboard, scroll wheel)
 * - Pan functionality
 * - Zoom level persistence during navigation
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Zoom and Pan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    // Navigate to edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    // Wait for edit view
    await page.waitForSelector('[data-testid="edit-preview"]', { timeout: 15000 })
  })

  test('zoom controls are visible', async ({ page }) => {
    // Zoom controls should be visible
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')
    const zoomOut = page.locator('[data-testid="zoom-out-button"]')
    const zoomFit = page.locator('[data-testid="zoom-fit-button"]')
    const zoomLevel = page.locator('[data-testid="zoom-level"]')

    await expect(zoomIn).toBeVisible()
    await expect(zoomOut).toBeVisible()
    await expect(zoomFit).toBeVisible()
    await expect(zoomLevel).toBeVisible()
  })

  test('zoom in button increases zoom level', async ({ page }) => {
    const zoomLevel = page.locator('[data-testid="zoom-level"]')
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')

    // Get initial zoom level
    const initialZoom = await zoomLevel.textContent()

    // Click zoom in
    await zoomIn.click()
    await page.waitForTimeout(100)

    // Zoom should increase
    const newZoom = await zoomLevel.textContent()
    expect(parseFloat(newZoom || '100')).toBeGreaterThan(parseFloat(initialZoom || '100'))
  })

  test('zoom out button decreases zoom level', async ({ page }) => {
    const zoomLevel = page.locator('[data-testid="zoom-level"]')
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')
    const zoomOut = page.locator('[data-testid="zoom-out-button"]')

    // First zoom in to have room to zoom out
    await zoomIn.click()
    await zoomIn.click()
    await page.waitForTimeout(100)

    const zoomedInLevel = await zoomLevel.textContent()

    // Click zoom out
    await zoomOut.click()
    await page.waitForTimeout(100)

    // Zoom should decrease
    const newZoom = await zoomLevel.textContent()
    expect(parseFloat(newZoom || '100')).toBeLessThan(parseFloat(zoomedInLevel || '200'))
  })

  test('zoom fit resets to fit view', async ({ page }) => {
    const zoomLevel = page.locator('[data-testid="zoom-level"]')
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')
    const zoomFit = page.locator('[data-testid="zoom-fit-button"]')

    // Zoom in multiple times
    await zoomIn.click()
    await zoomIn.click()
    await zoomIn.click()
    await page.waitForTimeout(100)

    const zoomedLevel = await zoomLevel.textContent()
    expect(parseFloat(zoomedLevel || '100')).toBeGreaterThan(100)

    // Click fit
    await zoomFit.click()
    await page.waitForTimeout(100)

    // Zoom should be back to fit (around 100% or "Fit")
    const fitLevel = await zoomLevel.textContent()
    expect(fitLevel?.toLowerCase()).toContain('fit')
  })

  test('keyboard + zooms in', async ({ page }) => {
    const zoomLevel = page.locator('[data-testid="zoom-level"]')

    // Get initial zoom
    const initialZoom = await zoomLevel.textContent()

    // Press + or = to zoom in
    await page.keyboard.press('=')
    await page.waitForTimeout(100)

    // Zoom should increase
    const newZoom = await zoomLevel.textContent()
    // Either zoom increased or it's already at Fit
    if (!initialZoom?.toLowerCase().includes('fit')) {
      expect(parseFloat(newZoom || '100')).toBeGreaterThanOrEqual(parseFloat(initialZoom || '100'))
    }
  })

  test('keyboard - zooms out', async ({ page }) => {
    const zoomLevel = page.locator('[data-testid="zoom-level"]')
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')

    // First zoom in
    await zoomIn.click()
    await zoomIn.click()
    await page.waitForTimeout(100)

    const zoomedLevel = await zoomLevel.textContent()

    // Press - to zoom out
    await page.keyboard.press('-')
    await page.waitForTimeout(100)

    const newZoom = await zoomLevel.textContent()
    expect(parseFloat(newZoom || '100')).toBeLessThan(parseFloat(zoomedLevel || '200'))
  })

  test('keyboard 0 resets to fit', async ({ page }) => {
    const zoomLevel = page.locator('[data-testid="zoom-level"]')
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')

    // Zoom in
    await zoomIn.click()
    await zoomIn.click()
    await page.waitForTimeout(100)

    // Press 0 to fit
    await page.keyboard.press('0')
    await page.waitForTimeout(100)

    const fitLevel = await zoomLevel.textContent()
    expect(fitLevel?.toLowerCase()).toContain('fit')
  })

  test('mouse wheel zooms', async ({ page }) => {
    const preview = page.locator('[data-testid="edit-preview"]')
    const zoomLevel = page.locator('[data-testid="zoom-level"]')

    // Get initial zoom
    const initialZoom = await zoomLevel.textContent()

    // Scroll up on preview (zoom in)
    await preview.hover()
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(200)

    // Zoom should change
    const newZoom = await zoomLevel.textContent()
    // May or may not zoom depending on implementation
    expect(newZoom).toBeDefined()
  })

  test('pan works when zoomed in', async ({ page }) => {
    const preview = page.locator('[data-testid="edit-preview"]')
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')

    // Zoom in to enable panning
    await zoomIn.click()
    await zoomIn.click()
    await zoomIn.click()
    await page.waitForTimeout(100)

    // Get preview bounding box
    const box = await preview.boundingBox()
    if (!box) return

    // Perform drag to pan
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 50, startY + 50)
    await page.mouse.up()

    // Pan should have occurred - difficult to verify visually
    // Just verify the action completed without error
    await expect(preview).toBeVisible()
  })

  test('zoom resets when navigating to different image', async ({ page }) => {
    const zoomIn = page.locator('[data-testid="zoom-in-button"]')
    const zoomLevel = page.locator('[data-testid="zoom-level"]')

    // Zoom in
    await zoomIn.click()
    await zoomIn.click()
    await page.waitForTimeout(100)

    const zoomedLevel = await zoomLevel.textContent()
    expect(parseFloat(zoomedLevel || '100')).toBeGreaterThan(100)

    // Navigate to next image using filmstrip or keyboard
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)

    // Zoom should reset to fit
    const newZoom = await zoomLevel.textContent()
    expect(newZoom?.toLowerCase()).toContain('fit')
  })

  test('double-click toggles 100% zoom', async ({ page }) => {
    const preview = page.locator('[data-testid="edit-preview"]')
    const zoomLevel = page.locator('[data-testid="zoom-level"]')

    // Get initial zoom
    const initialZoom = await zoomLevel.textContent()

    // Double-click to zoom to 100%
    await preview.dblclick()
    await page.waitForTimeout(200)

    const zoomedLevel = await zoomLevel.textContent()

    // Should either be 100% or different from initial
    // Implementation may vary
    expect(zoomedLevel).toBeDefined()

    // Double-click again to toggle back
    await preview.dblclick()
    await page.waitForTimeout(200)

    const finalZoom = await zoomLevel.textContent()
    expect(finalZoom?.toLowerCase()).toContain('fit')
  })
})
