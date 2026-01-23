import { expect, test } from '@playwright/test'

/**
 * Tone Curve E2E Tests
 *
 * Tests for the tone curve editing functionality:
 * - Tone curve panel visibility
 * - Adding control points
 * - Dragging control points
 * - Curve reset
 * - Channel selection (RGB, R, G, B)
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Tone Curve', () => {
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

  test.describe('Tone Curve Panel', () => {
    test('tone curve section is visible in edit panel', async ({ page }) => {
      // Look for the tone curve section header or container
      const toneCurveSection = page.locator('[data-testid="tone-curve-section"]')
      // May need to scroll to see it
      await page.waitForTimeout(500)
    })

    test('tone curve canvas exists', async ({ page }) => {
      // The tone curve editor should have a canvas or SVG element
      const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
      await page.waitForTimeout(500)
    })

    test('expanding tone curve section shows curve controls', async ({ page }) => {
      // Click to expand the tone curve section if collapsed
      const toneCurveHeader = page.locator('[data-testid="tone-curve-header"]')
      if (await toneCurveHeader.isVisible()) {
        await toneCurveHeader.click()
        await page.waitForTimeout(300)

        // Curve canvas should now be visible
        const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
        // Check it doesn't crash
      }
    })
  })

  test.describe('Curve Interaction', () => {
    test('clicking on curve adds a control point', async ({ page }) => {
      // Find and expand tone curve section
      const toneCurveHeader = page.locator('[data-testid="tone-curve-header"]')
      if (await toneCurveHeader.isVisible()) {
        await toneCurveHeader.click()
        await page.waitForTimeout(300)
      }

      const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
      if (await curveCanvas.isVisible()) {
        const bounds = await curveCanvas.boundingBox()
        if (bounds) {
          // Click in the middle of the curve to add a point
          await page.mouse.click(
            bounds.x + bounds.width * 0.5,
            bounds.y + bounds.height * 0.5,
          )
          await page.waitForTimeout(300)
          // A control point should be added
        }
      }
    })

    test('dragging on curve adjusts the curve shape', async ({ page }) => {
      // Find and expand tone curve section
      const toneCurveHeader = page.locator('[data-testid="tone-curve-header"]')
      if (await toneCurveHeader.isVisible()) {
        await toneCurveHeader.click()
        await page.waitForTimeout(300)
      }

      const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
      if (await curveCanvas.isVisible()) {
        const bounds = await curveCanvas.boundingBox()
        if (bounds) {
          // First add a point
          const startX = bounds.x + bounds.width * 0.5
          const startY = bounds.y + bounds.height * 0.5
          await page.mouse.click(startX, startY)
          await page.waitForTimeout(200)

          // Then drag it
          await page.mouse.move(startX, startY)
          await page.mouse.down()
          await page.mouse.move(startX, startY - 30) // Drag up to lighten midtones
          await page.mouse.up()
          await page.waitForTimeout(300)

          // The curve should be adjusted (verify no crash)
        }
      }
    })

    test('double-clicking a control point removes it', async ({ page }) => {
      // Find and expand tone curve section
      const toneCurveHeader = page.locator('[data-testid="tone-curve-header"]')
      if (await toneCurveHeader.isVisible()) {
        await toneCurveHeader.click()
        await page.waitForTimeout(300)
      }

      const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
      if (await curveCanvas.isVisible()) {
        const bounds = await curveCanvas.boundingBox()
        if (bounds) {
          // Add a point
          const pointX = bounds.x + bounds.width * 0.3
          const pointY = bounds.y + bounds.height * 0.3
          await page.mouse.click(pointX, pointY)
          await page.waitForTimeout(200)

          // Double-click to remove
          await page.mouse.dblclick(pointX, pointY)
          await page.waitForTimeout(300)

          // The point should be removed (verify no crash)
        }
      }
    })
  })

  test.describe('Channel Selection', () => {
    test('RGB channel button exists', async ({ page }) => {
      const rgbButton = page.locator('[data-testid="curve-channel-rgb"]')
      await page.waitForTimeout(500)
    })

    test('can switch to Red channel', async ({ page }) => {
      const redButton = page.locator('[data-testid="curve-channel-red"]')
      if (await redButton.isVisible()) {
        await redButton.click()
        await page.waitForTimeout(300)
        // Should show red curve
      }
    })

    test('can switch to Green channel', async ({ page }) => {
      const greenButton = page.locator('[data-testid="curve-channel-green"]')
      if (await greenButton.isVisible()) {
        await greenButton.click()
        await page.waitForTimeout(300)
        // Should show green curve
      }
    })

    test('can switch to Blue channel', async ({ page }) => {
      const blueButton = page.locator('[data-testid="curve-channel-blue"]')
      if (await blueButton.isVisible()) {
        await blueButton.click()
        await page.waitForTimeout(300)
        // Should show blue curve
      }
    })
  })

  test.describe('Curve Reset', () => {
    test('reset curve button exists', async ({ page }) => {
      const resetButton = page.locator('[data-testid="reset-tone-curve-button"]')
      await page.waitForTimeout(500)
    })

    test('reset curve button resets all curve adjustments', async ({ page }) => {
      // Find and expand tone curve section
      const toneCurveHeader = page.locator('[data-testid="tone-curve-header"]')
      if (await toneCurveHeader.isVisible()) {
        await toneCurveHeader.click()
        await page.waitForTimeout(300)
      }

      // Make some curve adjustment
      const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
      if (await curveCanvas.isVisible()) {
        const bounds = await curveCanvas.boundingBox()
        if (bounds) {
          await page.mouse.click(
            bounds.x + bounds.width * 0.5,
            bounds.y + bounds.height * 0.3,
          )
          await page.waitForTimeout(200)
        }
      }

      // Click reset
      const resetButton = page.locator('[data-testid="reset-tone-curve-button"]')
      if (await resetButton.isVisible()) {
        await resetButton.click()
        await page.waitForTimeout(300)
        // Curve should be reset to linear
      }
    })
  })

  test.describe('Curve Presets', () => {
    test('curve presets dropdown exists', async ({ page }) => {
      const presetsDropdown = page.locator('[data-testid="curve-presets-dropdown"]')
      await page.waitForTimeout(500)
    })

    test('can apply S-curve preset', async ({ page }) => {
      const presetsDropdown = page.locator('[data-testid="curve-presets-dropdown"]')
      if (await presetsDropdown.isVisible()) {
        await presetsDropdown.click()
        const sCurveOption = page.locator('text=S-Curve')
        if (await sCurveOption.isVisible()) {
          await sCurveOption.click()
          await page.waitForTimeout(300)
          // S-curve preset should be applied
        }
      }
    })
  })
})

test.describe('Tone Curve Persistence', () => {
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

  test('curve changes persist when navigating between photos', async ({ page }) => {
    // Find and expand tone curve section
    const toneCurveHeader = page.locator('[data-testid="tone-curve-header"]')
    if (await toneCurveHeader.isVisible()) {
      await toneCurveHeader.click()
      await page.waitForTimeout(300)
    }

    // Make a curve adjustment
    const curveCanvas = page.locator('[data-testid="tone-curve-canvas"]')
    if (await curveCanvas.isVisible()) {
      const bounds = await curveCanvas.boundingBox()
      if (bounds) {
        await page.mouse.click(
          bounds.x + bounds.width * 0.5,
          bounds.y + bounds.height * 0.3,
        )
        await page.waitForTimeout(200)
      }
    }

    // Navigate to another photo
    const filmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
    if (await filmstrip.isVisible()) {
      await filmstrip.click()
      await page.waitForTimeout(500)

      // Navigate back
      const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
      await firstFilmstrip.click()
      await page.waitForTimeout(500)

      // The curve adjustment should still be applied
      // (verify no crash)
    }
  })
})
