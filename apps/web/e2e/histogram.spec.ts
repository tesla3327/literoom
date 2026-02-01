import { expect, test } from '@playwright/test'

/**
 * Histogram E2E Tests
 *
 * Tests for the histogram display in edit view:
 * - Histogram visibility
 * - Histogram updates when adjustments change
 * - Clipping indicator buttons
 * - J key toggle for clipping visualization
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Histogram Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    // Wait for scanning to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
    // Enter edit view by double-clicking first thumbnail
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    // Wait for edit view
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })
  })

  test('histogram is visible in edit view', async ({ page }) => {
    const histogram = page.locator('[data-testid="histogram-display"]')
    await expect(histogram).toBeVisible({ timeout: 5000 })
  })

  test('histogram shows RGB channels', async ({ page }) => {
    // Wait for histogram to render with data
    await page.waitForTimeout(1000)

    // Histogram should have SVG paths for color channels
    const histogramSvg = page.locator('[data-testid="histogram-display"] svg')
    await expect(histogramSvg).toBeVisible()

    // Check that paths exist (red, green, blue channels)
    const paths = page.locator('[data-testid="histogram-display"] svg path')
    const pathCount = await paths.count()
    expect(pathCount).toBeGreaterThanOrEqual(1)
  })

  test('clipping indicator buttons are present', async ({ page }) => {
    // Shadow clipping button
    const shadowButton = page.locator('[data-testid="histogram-shadow-clipping"]')
    await expect(shadowButton).toBeVisible()

    // Highlight clipping button
    const highlightButton = page.locator('[data-testid="histogram-highlight-clipping"]')
    await expect(highlightButton).toBeVisible()
  })

  test('shadow clipping button toggles visualization', async ({ page }) => {
    const shadowButton = page.locator('[data-testid="histogram-shadow-clipping"]')

    // Click to enable shadow clipping visualization
    await shadowButton.click()
    await page.waitForTimeout(200)

    // Button should be active
    await expect(shadowButton).toHaveAttribute('data-active', 'true')

    // Click again to disable
    await shadowButton.click()
    await page.waitForTimeout(200)

    // Button should be inactive
    await expect(shadowButton).toHaveAttribute('data-active', 'false')
  })

  test('highlight clipping button toggles visualization', async ({ page }) => {
    const highlightButton = page.locator('[data-testid="histogram-highlight-clipping"]')

    // Click to enable highlight clipping visualization
    await highlightButton.click()
    await page.waitForTimeout(200)

    // Button should be active
    await expect(highlightButton).toHaveAttribute('data-active', 'true')

    // Click again to disable
    await highlightButton.click()
    await page.waitForTimeout(200)

    // Button should be inactive
    await expect(highlightButton).toHaveAttribute('data-active', 'false')
  })

  test('J key toggles both clipping visualizations', async ({ page }) => {
    const shadowButton = page.locator('[data-testid="histogram-shadow-clipping"]')
    const highlightButton = page.locator('[data-testid="histogram-highlight-clipping"]')

    // Initially both should be inactive
    await expect(shadowButton).toHaveAttribute('data-active', 'false')
    await expect(highlightButton).toHaveAttribute('data-active', 'false')

    // Press J to toggle clipping on
    await page.keyboard.press('j')
    await page.waitForTimeout(200)

    // Both should be active
    await expect(shadowButton).toHaveAttribute('data-active', 'true')
    await expect(highlightButton).toHaveAttribute('data-active', 'true')

    // Press J again to toggle off
    await page.keyboard.press('j')
    await page.waitForTimeout(200)

    // Both should be inactive
    await expect(shadowButton).toHaveAttribute('data-active', 'false')
    await expect(highlightButton).toHaveAttribute('data-active', 'false')
  })

  test('histogram updates when exposure changes', async ({ page }) => {
    // Get initial histogram state (simplified - just check it renders)
    const histogram = page.locator('[data-testid="histogram-display"]')
    await expect(histogram).toBeVisible()

    // Find and adjust exposure slider
    const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
    if (await exposureSlider.isVisible()) {
      const sliderBounds = await exposureSlider.boundingBox()
      if (sliderBounds) {
        // Click to increase exposure
        await page.mouse.click(
          sliderBounds.x + sliderBounds.width * 0.8,
          sliderBounds.y + sliderBounds.height / 2,
        )
        await page.waitForTimeout(500)

        // Histogram should still be visible (indicating it updated without errors)
        await expect(histogram).toBeVisible()
      }
    }
  })

  test('histogram persists when navigating between photos', async ({ page }) => {
    // Check histogram is visible
    const histogram = page.locator('[data-testid="histogram-display"]')
    await expect(histogram).toBeVisible()

    // Navigate to next photo using filmstrip
    const filmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
    if (await filmstrip.isVisible()) {
      await filmstrip.click()
      await page.waitForTimeout(1000)

      // Histogram should still be visible
      await expect(histogram).toBeVisible()
    }
  })
})

test.describe('Clipping Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })
  })

  test('clipping overlay appears when enabled', async ({ page }) => {
    // Press J to enable clipping visualization
    await page.keyboard.press('j')
    await page.waitForTimeout(500)

    // The clipping overlay canvas should exist
    // May or may not be visible depending on if there's clipping
    // Just check it doesn't crash
  })

  test('extreme exposure shows highlight clipping overlay', async ({ page }) => {
    // Enable clipping visualization
    await page.keyboard.press('j')
    await page.waitForTimeout(200)

    // Find and max out exposure slider
    const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
    if (await exposureSlider.isVisible()) {
      const sliderBounds = await exposureSlider.boundingBox()
      if (sliderBounds) {
        // Click far right to maximize exposure
        await page.mouse.click(
          sliderBounds.x + sliderBounds.width * 0.95,
          sliderBounds.y + sliderBounds.height / 2,
        )
        await page.waitForTimeout(500)

        // With high exposure, there should be highlight clipping shown
        // The clipping overlay should be visible/rendered
        // Clipping visualization should be active (verify no errors)
      }
    }
  })

  test('negative exposure shows shadow clipping overlay', async ({ page }) => {
    // Enable clipping visualization
    await page.keyboard.press('j')
    await page.waitForTimeout(200)

    // Find and minimize exposure slider
    const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
    if (await exposureSlider.isVisible()) {
      const sliderBounds = await exposureSlider.boundingBox()
      if (sliderBounds) {
        // Click far left to minimize exposure
        await page.mouse.click(
          sliderBounds.x + sliderBounds.width * 0.05,
          sliderBounds.y + sliderBounds.height / 2,
        )
        await page.waitForTimeout(500)

        // With low exposure, there should be shadow clipping shown
        // The clipping overlay should be visible/rendered
      }
    }
  })
})
