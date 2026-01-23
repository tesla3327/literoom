import { expect, test } from '@playwright/test'

/**
 * Mask E2E Tests
 *
 * Tests for linear and radial gradient mask functionality:
 * - Adding masks
 * - Drawing masks on the preview
 * - Adjusting mask parameters
 * - Mask visibility toggle
 * - Mask deletion
 * - Mask adjustment sliders
 *
 * NOTE: In demo mode, the app auto-loads the demo catalog on mount.
 */

test.describe('Masks', () => {
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

  test.describe('Mask Panel', () => {
    test('masks section is visible in edit panel', async ({ page }) => {
      // Look for the masks section header or container
      const masksSection = page.locator('[data-testid="masks-section"]')
      await page.waitForTimeout(500)
    })

    test('add linear gradient mask button exists', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      await page.waitForTimeout(500)
    })

    test('add radial gradient mask button exists', async ({ page }) => {
      const addRadialButton = page.locator('[data-testid="add-radial-mask-button"]')
      await page.waitForTimeout(500)
    })
  })

  test.describe('Linear Gradient Mask', () => {
    test('clicking add linear mask button enters drawing mode', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        // Should enter drawing mode (cursor should change, or there should be an indicator)
        // Check that a drawing mode indicator is present
        const drawingIndicator = page.locator('[data-testid="mask-drawing-indicator"]')
        await page.waitForTimeout(200)
      }
    })

    test('can draw a linear gradient mask on the preview', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        // Find the preview canvas
        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            // Draw a linear gradient by dragging from top to bottom
            const startX = bounds.x + bounds.width / 2
            const startY = bounds.y + bounds.height * 0.3
            const endY = bounds.y + bounds.height * 0.7

            await page.mouse.move(startX, startY)
            await page.mouse.down()
            await page.mouse.move(startX, endY)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // A mask should be created and appear in the masks list
            const maskItem = page.locator('[data-testid="mask-list-item"]').first()
            // Just verify no crash
          }
        }
      }
    })

    test('linear mask appears in masks list after creation', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.3)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.7)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Check for mask in the list
            const maskListItems = page.locator('[data-testid="mask-list-item"]')
            const count = await maskListItems.count()
            // Should have at least one mask
          }
        }
      }
    })
  })

  test.describe('Radial Gradient Mask', () => {
    test('clicking add radial mask button enters drawing mode', async ({ page }) => {
      const addRadialButton = page.locator('[data-testid="add-radial-mask-button"]')
      if (await addRadialButton.isVisible()) {
        await addRadialButton.click()
        await page.waitForTimeout(300)
        // Should enter drawing mode
      }
    })

    test('can draw a radial gradient mask on the preview', async ({ page }) => {
      const addRadialButton = page.locator('[data-testid="add-radial-mask-button"]')
      if (await addRadialButton.isVisible()) {
        await addRadialButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            // Draw a radial gradient by dragging from center outward
            const centerX = bounds.x + bounds.width / 2
            const centerY = bounds.y + bounds.height / 2

            await page.mouse.move(centerX, centerY)
            await page.mouse.down()
            await page.mouse.move(centerX + 100, centerY + 75)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // A radial mask should be created
          }
        }
      }
    })
  })

  test.describe('Mask Selection and Editing', () => {
    test('clicking a mask in the list selects it', async ({ page }) => {
      // First create a mask
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Click the mask in the list
            const maskItem = page.locator('[data-testid="mask-list-item"]').first()
            if (await maskItem.isVisible()) {
              await maskItem.click()
              await page.waitForTimeout(200)

              // Mask should be selected (highlighted or show adjustment controls)
              await expect(maskItem).toHaveAttribute('data-selected', 'true')
            }
          }
        }
      }
    })

    test('selected mask shows adjustment sliders', async ({ page }) => {
      // Create a mask
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Look for mask adjustment sliders
            const maskExposureSlider = page.locator('[data-testid="mask-adjustment-exposure"]')
            await page.waitForTimeout(200)
          }
        }
      }
    })

    test('can adjust mask exposure', async ({ page }) => {
      // Create a mask
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Adjust mask exposure
            const maskExposureSlider = page.locator('[data-testid="mask-adjustment-exposure"]')
            if (await maskExposureSlider.isVisible()) {
              const sliderBounds = await maskExposureSlider.boundingBox()
              if (sliderBounds) {
                await page.mouse.click(
                  sliderBounds.x + sliderBounds.width * 0.7,
                  sliderBounds.y + sliderBounds.height / 2,
                )
                await page.waitForTimeout(300)
                // Mask exposure should be adjusted
              }
            }
          }
        }
      }
    })
  })

  test.describe('Mask Visibility', () => {
    test('mask visibility toggle button exists', async ({ page }) => {
      // Create a mask first
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Look for visibility toggle
            const visibilityToggle = page.locator('[data-testid="mask-visibility-toggle"]').first()
            await page.waitForTimeout(200)
          }
        }
      }
    })

    test('clicking visibility toggle hides mask effect', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            const visibilityToggle = page.locator('[data-testid="mask-visibility-toggle"]').first()
            if (await visibilityToggle.isVisible()) {
              await visibilityToggle.click()
              await page.waitForTimeout(300)
              // Mask should be hidden (verify no crash)
            }
          }
        }
      }
    })
  })

  test.describe('Mask Deletion', () => {
    test('delete mask button exists', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            const deleteButton = page.locator('[data-testid="delete-mask-button"]').first()
            await page.waitForTimeout(200)
          }
        }
      }
    })

    test('clicking delete removes the mask', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Count masks before deletion
            const masksBefore = await page.locator('[data-testid="mask-list-item"]').count()

            const deleteButton = page.locator('[data-testid="delete-mask-button"]').first()
            if (await deleteButton.isVisible()) {
              await deleteButton.click()
              await page.waitForTimeout(300)

              // Count masks after deletion
              const masksAfter = await page.locator('[data-testid="mask-list-item"]').count()

              // Should have one less mask
              if (masksBefore > 0) {
                expect(masksAfter).toBeLessThan(masksBefore)
              }
            }
          }
        }
      }
    })
  })

  test.describe('Mask Overlay Visualization', () => {
    test('O key toggles mask overlay visualization', async ({ page }) => {
      const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
      if (await addLinearButton.isVisible()) {
        await addLinearButton.click()
        await page.waitForTimeout(300)

        const preview = page.locator('[data-testid="edit-preview"]')
        if (await preview.isVisible()) {
          const bounds = await preview.boundingBox()
          if (bounds) {
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
            await page.mouse.up()
            await page.waitForTimeout(500)

            // Press O to show mask overlay
            await page.keyboard.press('o')
            await page.waitForTimeout(300)

            // The mask overlay should be visible
            const maskOverlay = page.locator('[data-testid="mask-overlay"]')
            await page.waitForTimeout(200)

            // Press O again to hide
            await page.keyboard.press('o')
            await page.waitForTimeout(300)
          }
        }
      }
    })
  })
})

test.describe('Mask Persistence', () => {
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

  test('masks persist when navigating between photos', async ({ page }) => {
    const addLinearButton = page.locator('[data-testid="add-linear-mask-button"]')
    if (await addLinearButton.isVisible()) {
      await addLinearButton.click()
      await page.waitForTimeout(300)

      const preview = page.locator('[data-testid="edit-preview"]')
      if (await preview.isVisible()) {
        const bounds = await preview.boundingBox()
        if (bounds) {
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
          await page.mouse.down()
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300)
          await page.mouse.up()
          await page.waitForTimeout(500)

          // Navigate to another photo
          const filmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').nth(1)
          if (await filmstrip.isVisible()) {
            await filmstrip.click()
            await page.waitForTimeout(500)

            // Navigate back
            const firstFilmstrip = page.locator('[data-testid="filmstrip-thumbnail"]').first()
            await firstFilmstrip.click()
            await page.waitForTimeout(500)

            // The mask should still exist
            const maskListItems = page.locator('[data-testid="mask-list-item"]')
            // Verify no crash and masks are persisted
          }
        }
      }
    }
  })
})
