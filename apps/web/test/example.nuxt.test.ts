import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import App from '~/app/app.vue'

describe('app', () => {
  it('can mount App component', async () => {
    const component = await mountSuspended(App)
    expect(component.html()).toContain('Literoom')
  })
})
