import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import App from '~/app.vue'

describe('app', () => {
  it('can mount App component', async () => {
    const component = await mountSuspended(App)
    // In demo mode, the catalog auto-loads and the main catalog view is shown
    // Just verify the app mounts successfully with expected structure
    // The page should contain the catalog grid or welcome screen
    expect(component.html()).toContain('data-testid="catalog-page"')
  })
})
