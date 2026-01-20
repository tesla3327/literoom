import { expect, test } from '@playwright/test'

test.describe('Home Page', () => {
  test('shows the main heading', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toContainText('Literoom')
  })

  test('has a choose folder button', async ({ page }) => {
    await page.goto('/')

    const button = page.locator('button', { hasText: 'Choose Folder' })
    await expect(button).toBeVisible()
  })
})
