/**
 * Ensure Catalog Middleware
 *
 * Waits for the catalog service to be initialized AND ensures catalog data
 * is loaded before allowing navigation to edit pages.
 *
 * This prevents crashes when users navigate directly to edit pages via URL.
 *
 * The catalog plugin is async and may not finish initializing before route
 * handlers execute. This middleware ensures:
 * 1. The $catalogService is available
 * 2. The catalog has assets loaded (via $initializeCatalog)
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

  // Initialize catalog data if not already populated
  // In demo mode: auto-loads demo catalog
  // In real mode: restores from database or redirects to home
  if (nuxtApp.$initializeCatalog) {
    const initialized = await nuxtApp.$initializeCatalog()
    if (!initialized) {
      // Real mode: couldn't restore from database, redirect to home
      // User needs to select a folder first
      return navigateTo('/')
    }
  }
})
