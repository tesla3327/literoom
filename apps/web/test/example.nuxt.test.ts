import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import App from '~/app.vue'

describe('app', () => {
  it('can mount App component', async () => {
    const component = await mountSuspended(App)
    // Demo mode should show the catalog page with demo photos
    expect(component.html()).toContain('Demo Photos')
  })
})
