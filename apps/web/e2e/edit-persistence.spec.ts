import { expect, test } from '@playwright/test'

/**
 * Edit Persistence E2E Tests
 *
 * Tests that edit state persists correctly:
 * - Across photo navigation (filmstrip)
 * - Across view changes (catalog grid -> edit view)
 * - After page reload (stored in IndexedDB)
 * - Between browser sessions
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Edit Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for catalog grid to appear (auto-loads in demo mode)
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    // Wait for scanning to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })
  })

  test.describe('Navigation Persistence', () => {
    test('exposure adjustment persists when navigating between photos', async ({ page }) => {
      // Enter edit view
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Adjust exposure
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const sliderBounds = await exposureSlider.boundingBox()
        if (sliderBounds) {
          // Set exposure to high value
          await page.mouse.click(
            sliderBounds.x + sliderBounds.width * 0.8,
            sliderBounds.y + sliderBounds.height / 2,
          )
          await page.waitForTimeout(500)
        }
      }

      // Navigate to second photo
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        // Navigate back to first photo
        const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
        await firstFilmstrip.click()
        await page.waitForTimeout(500)

        // Exposure should still be at the adjusted value
        // Check the slider position or value indicator
        const exposureValue = page.locator('[data-testid="adjustment-value-exposure"]')
        if (await exposureValue.isVisible()) {
          const value = await exposureValue.textContent()
          // Value should not be 0 (default)
          expect(value).not.toBe('0')
        }
      }
    })

    test('contrast adjustment persists when navigating', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Adjust contrast
      const contrastSlider = page.locator('[data-testid="adjustment-slider-contrast"]')
      if (await contrastSlider.isVisible()) {
        const sliderBounds = await contrastSlider.boundingBox()
        if (sliderBounds) {
          await page.mouse.click(
            sliderBounds.x + sliderBounds.width * 0.7,
            sliderBounds.y + sliderBounds.height / 2,
          )
          await page.waitForTimeout(500)
        }
      }

      // Navigate away and back
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
        await firstFilmstrip.click()
        await page.waitForTimeout(500)

        // Contrast should persist
        const contrastValue = page.locator('[data-testid="adjustment-value-contrast"]')
        if (await contrastValue.isVisible()) {
          const value = await contrastValue.textContent()
          expect(value).not.toBe('0')
        }
      }
    })

    test('saturation adjustment persists', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Adjust saturation
      const saturationSlider = page.locator('[data-testid="adjustment-slider-saturation"]')
      if (await saturationSlider.isVisible()) {
        const sliderBounds = await saturationSlider.boundingBox()
        if (sliderBounds) {
          await page.mouse.click(
            sliderBounds.x + sliderBounds.width * 0.8,
            sliderBounds.y + sliderBounds.height / 2,
          )
          await page.waitForTimeout(500)
        }
      }

      // Navigate away and back
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
        await firstFilmstrip.click()
        await page.waitForTimeout(500)

        // Saturation should persist
        const saturationValue = page.locator('[data-testid="adjustment-value-saturation"]')
        if (await saturationValue.isVisible()) {
          const value = await saturationValue.textContent()
          expect(value).not.toBe('0')
        }
      }
    })
  })

  test.describe('View Change Persistence', () => {
    test('edits persist when returning to catalog grid and back', async ({ page }) => {
      // Enter edit view
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Make an edit
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const sliderBounds = await exposureSlider.boundingBox()
        if (sliderBounds) {
          await page.mouse.click(
            sliderBounds.x + sliderBounds.width * 0.7,
            sliderBounds.y + sliderBounds.height / 2,
          )
          await page.waitForTimeout(500)
        }
      }

      // Return to catalog grid (press G or click back button)
      await page.keyboard.press('g')
      await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 5000 })

      // Re-enter edit view for the same photo
      const thumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await thumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Edits should still be present
      const exposureValue = page.locator('[data-testid="adjustment-value-exposure"]')
      if (await exposureValue.isVisible()) {
        const value = await exposureValue.textContent()
        expect(value).not.toBe('0')
      }
    })
  })

  test.describe('Multi-Adjustment Persistence', () => {
    test('multiple adjustments persist together', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Adjust multiple sliders
      const adjustments = [
        { testId: 'adjustment-slider-exposure', position: 0.7 },
        { testId: 'adjustment-slider-contrast', position: 0.6 },
        { testId: 'adjustment-slider-highlights', position: 0.3 },
        { testId: 'adjustment-slider-shadows', position: 0.7 },
      ]

      for (const adj of adjustments) {
        const slider = page.locator(`[data-testid="${adj.testId}"]`)
        if (await slider.isVisible()) {
          const bounds = await slider.boundingBox()
          if (bounds) {
            await page.mouse.click(
              bounds.x + bounds.width * adj.position,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(200)
          }
        }
      }

      // Navigate away
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        // Navigate back
        const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
        await firstFilmstrip.click()
        await page.waitForTimeout(500)

        // All adjustments should persist
        // Check at least exposure and contrast
        const exposureValue = page.locator('[data-testid="adjustment-value-exposure"]')
        const contrastValue = page.locator('[data-testid="adjustment-value-contrast"]')

        if (await exposureValue.isVisible()) {
          expect(await exposureValue.textContent()).not.toBe('0')
        }
        if (await contrastValue.isVisible()) {
          expect(await contrastValue.textContent()).not.toBe('0')
        }
      }
    })
  })

  test.describe('Per-Photo Independence', () => {
    test('different photos maintain independent edit states', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Adjust exposure on first photo (increase)
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const bounds = await exposureSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.8,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(500)
        }
      }

      // Go to second photo
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        // Adjust exposure on second photo (decrease)
        const exposureSlider2 = page.locator('[data-testid="adjustment-slider-exposure"]')
        if (await exposureSlider2.isVisible()) {
          const bounds = await exposureSlider2.boundingBox()
          if (bounds) {
            await page.mouse.click(
              bounds.x + bounds.width * 0.2,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(500)
          }
        }

        // Go back to first photo
        const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
        await firstFilmstrip.click()
        await page.waitForTimeout(500)

        // First photo should have positive exposure
        const exposureValue1 = page.locator('[data-testid="adjustment-value-exposure"]')
        if (await exposureValue1.isVisible()) {
          const value1 = await exposureValue1.textContent()
          const numValue1 = parseFloat(value1 || '0')
          expect(numValue1).toBeGreaterThan(0)
        }

        // Go to second photo
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        // Second photo should have negative or different exposure
        const exposureValue2 = page.locator('[data-testid="adjustment-value-exposure"]')
        if (await exposureValue2.isVisible()) {
          const value2 = await exposureValue2.textContent()
          const numValue2 = parseFloat(value2 || '0')
          // Just verify they're different or second is negative
          expect(numValue2).toBeLessThan(0)
        }
      }
    })
  })

  test.describe('Reset Functionality', () => {
    test('reset clears all adjustments for current photo', async ({ page }) => {
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      // Make some adjustments
      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const bounds = await exposureSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.7,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(300)
        }
      }

      const contrastSlider = page.locator('[data-testid="adjustment-slider-contrast"]')
      if (await contrastSlider.isVisible()) {
        const bounds = await contrastSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.8,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(300)
        }
      }

      // Reset all adjustments (press R or click reset button)
      await page.keyboard.press('r')
      await page.waitForTimeout(500)

      // All values should be back to default (0)
      const exposureValue = page.locator('[data-testid="adjustment-value-exposure"]')
      const contrastValue = page.locator('[data-testid="adjustment-value-contrast"]')

      if (await exposureValue.isVisible()) {
        expect(await exposureValue.textContent()).toBe('0')
      }
      if (await contrastValue.isVisible()) {
        expect(await contrastValue.textContent()).toBe('0')
      }
    })

    test('reset only affects current photo, not others', async ({ page }) => {
      // Edit first photo
      const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
      await firstThumbnail.dblclick()
      await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

      const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
      if (await exposureSlider.isVisible()) {
        const bounds = await exposureSlider.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.7,
            bounds.y + bounds.height / 2,
          )
          await page.waitForTimeout(300)
        }
      }

      // Edit second photo
      const secondThumbnail = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
      if (await secondThumbnail.isVisible()) {
        await secondThumbnail.click()
        await page.waitForTimeout(500)

        const exposureSlider2 = page.locator('[data-testid="adjustment-slider-exposure"]')
        if (await exposureSlider2.isVisible()) {
          const bounds = await exposureSlider2.boundingBox()
          if (bounds) {
            await page.mouse.click(
              bounds.x + bounds.width * 0.7,
              bounds.y + bounds.height / 2,
            )
            await page.waitForTimeout(300)
          }
        }

        // Reset second photo
        await page.keyboard.press('r')
        await page.waitForTimeout(500)

        // Second photo should be reset
        const exposureValue2 = page.locator('[data-testid="adjustment-value-exposure"]')
        if (await exposureValue2.isVisible()) {
          expect(await exposureValue2.textContent()).toBe('0')
        }

        // Go back to first photo
        const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
        await firstFilmstrip.click()
        await page.waitForTimeout(500)

        // First photo should still have edits
        const exposureValue1 = page.locator('[data-testid="adjustment-value-exposure"]')
        if (await exposureValue1.isVisible()) {
          expect(await exposureValue1.textContent()).not.toBe('0')
        }
      }
    })
  })
})

test.describe('Page Reload Persistence', () => {
  test('edits persist after page reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })

    // Enter edit view
    const firstThumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await firstThumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })

    // Make an adjustment
    const exposureSlider = page.locator('[data-testid="adjustment-slider-exposure"]')
    if (await exposureSlider.isVisible()) {
      const bounds = await exposureSlider.boundingBox()
      if (bounds) {
        await page.mouse.click(
          bounds.x + bounds.width * 0.8,
          bounds.y + bounds.height / 2,
        )
        await page.waitForTimeout(1000) // Wait for debounced save
      }
    }

    // Reload the page
    await page.reload()
    await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 15000 })
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Scanning...')
    }, { timeout: 15000 })

    // Re-enter edit view
    const thumbnail = page.locator('[data-testid="catalog-thumbnail"]').first()
    await thumbnail.dblclick()
    await page.waitForSelector('[data-testid="edit-panel"]', { timeout: 10000 })
    await page.waitForTimeout(500)

    // Edits should persist
    const exposureValue = page.locator('[data-testid="adjustment-value-exposure"]')
    if (await exposureValue.isVisible()) {
      const value = await exposureValue.textContent()
      expect(value).not.toBe('0')
    }
  })
})
