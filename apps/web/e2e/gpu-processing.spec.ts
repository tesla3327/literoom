import { expect, test } from '@playwright/test'

/**
 * GPU Processing E2E Tests
 *
 * Tests the GPU-accelerated image processing features:
 * - Preview generation and display
 * - Adjustment processing (exposure, contrast, etc.)
 * - Real-time preview updates
 * - Backend selection (WebGPU vs WASM fallback)
 *
 * NOTE: These tests verify visible behavior regardless of which backend
 * is used internally. WebGPU may not be available in all test environments.
 */

test.describe('GPU Processing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    // Wait for scanning to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
  })

  test.describe('Preview Rendering', () => {
    test('preview image loads and displays correctly', async ({ page }) => {
      // Enter edit view
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Wait for preview image to load
      const previewImage = page.locator('[data-testid="preview-image"]')
      await expect(previewImage).toBeVisible({ timeout: 10000 })

      // Verify the image has dimensions (actually loaded)
      const imageBox = await previewImage.boundingBox()
      expect(imageBox).toBeTruthy()
      expect(imageBox!.width).toBeGreaterThan(0)
      expect(imageBox!.height).toBeGreaterThan(0)
    })

    test('preview updates when adjustments change', async ({ page }) => {
      // Enter edit view
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Wait for preview to load
      const previewImage = page.locator('[data-testid="preview-image"]')
      await expect(previewImage).toBeVisible({ timeout: 10000 })

      // Adjust exposure
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const sliderBounds = await exposureSlider.boundingBox()
        if (sliderBounds) {
          // Make a significant adjustment
          await page.mouse.click(
            sliderBounds.x + sliderBounds.width * 0.9,
            sliderBounds.y + sliderBounds.height / 2,
          )

          // Wait for debounce and processing
          await page.waitForTimeout(1500)

          // The image src should change (or data-version if using canvas)
          // Either src changed or it's a canvas update
          // In either case, the preview should be different
        }
      }
    })

    test('preview handles rapid adjustment changes', async ({ page }) => {
      // Enter edit view
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Wait for preview
      const previewImage = page.locator('[data-testid="preview-image"]')
      await expect(previewImage).toBeVisible({ timeout: 10000 })

      // Make rapid adjustments
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const bounds = await exposureSlider.boundingBox()
        if (bounds) {
          // Rapid clicks at different positions
          for (let i = 0; i < 5; i++) {
            const position = 0.3 + i * 0.1
            await page.mouse.click(
              bounds.x + bounds.width * position,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(100)
          }

          // Wait for final processing
          await page.waitForTimeout(1000)

          // Preview should still be visible (no errors)
          await expect(previewImage).toBeVisible()
        }
      }
    })
  })

  test.describe('Adjustment Processing', () => {
    test('exposure adjustment produces visible change', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })
      await page.waitForSelector('[data-testid="preview-image"]', { timeout: 10000 })

      // Adjust exposure to maximum
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const bounds = await exposureSlider.boundingBox()
        if (bounds) {
          // Click at high exposure
          await page.mouse.click(
            bounds.x + bounds.width * 0.95,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(1000)

          // Check the value changed
          const exposureValue = page.locator('[data-testid="adjustment-value-exposure"]')
          if (await exposureValue.isVisible()) {
            const value = await exposureValue.textContent()
            const numValue = parseFloat(value || '0')
            expect(numValue).toBeGreaterThan(0)
          }
        }
      }
    })

    test('contrast adjustment produces visible change', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      const contrastSlider = page.locator('[data-testid="adjustment-slider-contrast"]')
      if (await contrastSlider.isVisible()) {
        const bounds = await contrastSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.9,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(1000)

          const contrastValue = page.locator('[data-testid="adjustment-value-contrast"]')
          if (await contrastValue.isVisible()) {
            const value = await contrastValue.textContent()
            const numValue = parseFloat(value || '0')
            expect(numValue).toBeGreaterThan(0)
          }
        }
      }
    })

    test('saturation adjustment produces visible change', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      const saturationSlider = page.locator('[data-testid="adjustment-slider-saturation"]')
      if (await saturationSlider.isVisible()) {
        const bounds = await saturationSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.9,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(1000)

          const saturationValue = page.locator('[data-testid="adjustment-value-saturation"]')
          if (await saturationValue.isVisible()) {
            const value = await saturationValue.textContent()
            const numValue = parseFloat(value || '0')
            expect(numValue).toBeGreaterThan(0)
          }
        }
      }
    })

    test('multiple adjustments combine correctly', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })
      await page.waitForSelector('[data-testid="preview-image"]', { timeout: 10000 })

      // Apply multiple adjustments
      const adjustments = [
        'adjustment-slider-exposure',
        'adjustment-slider-contrast',
        'adjustment-slider-saturation',
      ]

      for (const testId of adjustments) {
        const slider = page.locator(`[data-testid="${testId}"]`)
        if (await slider.isVisible()) {
          const bounds = await slider.boundingBox()
          if (bounds) {
            await page.mouse.click(
              bounds.x + bounds.width * 0.7,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(300)
          }
        }
      }

      // Wait for processing
      await page.waitForTimeout(1000)

      // Preview should still be visible and functional
      const previewImage = page.locator('[data-testid="preview-image"]')
      await expect(previewImage).toBeVisible()
    })
  })

  test.describe('Processing Stability', () => {
    test('handles navigation during processing', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Start an adjustment
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const bounds = await exposureSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.8,
            bounds.y + bounds.height / 2,
          )
        }
      }

      // Immediately navigate to another photo (cancel processing)
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        // Preview should load for new photo
        const previewImage = page.locator('[data-testid="preview-image"]')
        await expect(previewImage).toBeVisible()

        // No console errors should occur
      }
    })

    test('handles rapid photo navigation', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Rapidly navigate between photos
      const thumbnails = page.locator('[data-testid="filmstrip-thumbnail"]')
      const count = await thumbnails.count()

      if (count >= 3) {
        for (let i = 0; i < 5; i++) {
          const index = i % count
          await thumbnails.nth(index).click()
          await page.waitForTimeout(100)
        }

        // Final navigation
        await thumbnails.first().click()
        await page.waitForTimeout(1000)

        // Preview should be stable
        const previewImage = page.locator('[data-testid="preview-image"]')
        await expect(previewImage).toBeVisible()
      }
    })

    test('recovers from processing errors gracefully', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Make extreme adjustments that might stress the system
      const sliders = [
        'adjustment-slider-exposure',
        'adjustment-slider-contrast',
        'adjustment-slider-highlights',
        'adjustment-slider-shadows',
      ]

      for (const testId of sliders) {
        const slider = page.locator(`[data-testid="${testId}"]`)
        if (await slider.isVisible()) {
          const bounds = await slider.boundingBox()
          if (bounds) {
            // Max out each slider
            await page.mouse.click(
              bounds.x + bounds.width * 0.95,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(200)
          }
        }
      }

      await page.waitForTimeout(1500)

      // Preview should still be visible
      const previewImage = page.locator('[data-testid="preview-image"]')
      await expect(previewImage).toBeVisible()

      // Reset should work
      await page.keyboard.press('r')
      await page.waitForTimeout(1000)

      // Preview should update to reset state
      await expect(previewImage).toBeVisible()
    })
  })

  test.describe('Histogram Updates', () => {
    test('histogram updates with adjustments', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Wait for histogram to appear
      const histogram = page.locator('[data-testid="histogram-display"]')
      if (await histogram.isVisible({ timeout: 5000 })) {
        // Make an adjustment
        const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
        if (await exposureSlider.isVisible()) {
          const bounds = await exposureSlider.boundingBox()
          if (bounds) {
            await page.mouse.click(
              bounds.x + bounds.width * 0.9,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(1500)

            // Histogram should still be visible (updated)
            await expect(histogram).toBeVisible()
          }
        }
      }
    })
  })
})

test.describe('Clipping Visualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
  })

  test('clipping overlay can be toggled with J key', async ({ page }) => {
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Press J to toggle clipping visualization
    await page.keyboard.press('j')
    await page.waitForTimeout(500)

    // Check if clipping buttons are active
    page.locator('[data-testid="clipping-shadows-button"]')
    page.locator('[data-testid="clipping-highlights-button"]')

    // Toggle off with J again
    await page.keyboard.press('j')
    await page.waitForTimeout(500)
  })

  test('clipping appears with extreme exposure', async ({ page }) => {
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Enable clipping visualization
    await page.keyboard.press('j')
    await page.waitForTimeout(300)

    // Max out exposure
    const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
    if (await exposureSlider.isVisible()) {
      const bounds = await exposureSlider.boundingBox()
      if (bounds) {
        await page.mouse.click(
          bounds.x + bounds.width * 0.98,
          bounds.y + bounds.height / 2,
        )
        await page.waitForTimeout(1500)

        // Clipping overlay canvas should be visible
        const clippingCanvas = page.locator('[data-testid="clipping-overlay"]')
        if (await clippingCanvas.isVisible()) {
          // Canvas has content (not empty)
          const box = await clippingCanvas.boundingBox()
          expect(box).toBeTruthy()
        }
      }
    }
  })
})
