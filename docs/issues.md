# Issues

- [x] App is using Nuxt v3 and NOT v4, it should be using v4
- [x] App is using Nuxt UI v3 and NOT v4, it should be using v4
- [x] Demo mode thumbnails don't load - shows loading/glimmer state instead of actual images. Fixed by adding `requestThumbnail` calls in `CatalogThumbnail.vue` when component mounts. Also improved thumbnail visuals with gradient patterns.

## Open Issues

- [x] **Edit view preview not loading (Critical)** - Fixed by adding `requestThumbnail()` calls in `useEditPreview` and `useHistogramDisplay` composables. The root cause was that the edit view never requested thumbnail generation, so if navigating directly to edit view (or before thumbnails were ready), the `thumbnailUrl` would be `null` and the preview would never load. Now the composables request thumbnail generation with high priority (0) when the asset changes, and watch for the thumbnail URL to become available. (Fixed 2026-01-21)