/**
 * Ensure Catalog Middleware
 *
 * Waits for the catalog service to be initialized before allowing navigation.
 * This prevents crashes when users navigate directly to edit pages via URL.
 *
 * The catalog plugin is async and may not finish initializing before route
 * handlers execute. This middleware ensures the $catalogService is available.
 */
export default defineNuxtRouteMiddleware(async () => {
  // Only run on client-side (server has no catalog service)
  if (import.meta.server) {
    return
  }

  const nuxtApp = useNuxtApp()

  // Wait for the catalog plugin to finish initializing
  // $catalogReady is a promise provided early by the plugin
  if (nuxtApp.$catalogReady) {
    await nuxtApp.$catalogReady
  }

  // If catalog service is still not available, redirect to home
  // This shouldn't happen but provides a safety fallback
  if (!nuxtApp.$catalogService) {
    return navigateTo('/')
  }
})
