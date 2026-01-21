/**
 * Decode service plugin - client-side only.
 *
 * Creates the DecodeService instance and provides it to the Nuxt app.
 * The service uses a Web Worker to decode images without blocking the main thread.
 */
import { DecodeService } from '@literoom/core'

export default defineNuxtPlugin(async () => {
  const decodeService = await DecodeService.create()

  // Cleanup on page unload to terminate the worker
  if (import.meta.client) {
    window.addEventListener('beforeunload', () => {
      decodeService.destroy()
    })
  }

  return {
    provide: {
      decodeService,
    },
  }
})
