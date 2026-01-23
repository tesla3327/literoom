import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import App from '~/app.vue'

describe('app', () => {
  it('can mount App component', async () => {
    const component = await mountSuspended(App)
    // Demo mode shows welcome screen initially, catalog loads asynchronously
    // Just verify the app mounts successfully with expected structure
    expect(component.html()).toContain('Literoom')
    expect(component.html()).toContain('Demo Mode')
  })
})
