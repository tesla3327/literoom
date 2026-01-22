/**
 * Export module for Literoom
 *
 * Provides filename templating, export service, and related utilities.
 */

// Filename templating
export {
  renderTemplate,
  validateTemplate,
  extractOriginalFilename,
  formatDateForTemplate,
  type TemplateContext,
  type TemplateError,
} from './filename-template'

// Export service
export {
  ExportService,
  createExportService,
  filterAssetsForExport,
} from './export-service'

// Export types
export type {
  ExportScope,
  ExportOptions,
  ExportProgress,
  ExportProgressCallback,
  ExportResult,
  ExportFailure,
  ExportEditState,
  ExportServiceDependencies,
} from './types'
