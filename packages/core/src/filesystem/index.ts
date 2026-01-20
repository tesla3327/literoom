/**
 * File System Abstraction Layer
 *
 * Provides a unified interface for file system operations that works
 * across different platforms (browser, Tauri, etc.)
 */

export * from './types'
export { BrowserFileSystemProvider, isFileSystemAccessSupported } from './browser'

import type { FileSystemProvider } from './types'
import { FileSystemError } from './types'
import { BrowserFileSystemProvider, isFileSystemAccessSupported } from './browser'

/**
 * Detect the current environment and return the appropriate provider
 */
export function detectEnvironment(): 'browser' | 'tauri' | 'unsupported' {
  // Check for Tauri
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    return 'tauri'
  }

  // Check for browser File System Access API
  if (typeof window !== 'undefined' && isFileSystemAccessSupported()) {
    return 'browser'
  }

  return 'unsupported'
}

/**
 * Create a file system provider for the current environment
 *
 * @returns A FileSystemProvider instance appropriate for the current platform
 * @throws FileSystemError if no supported provider is available
 */
export function createFileSystemProvider(): FileSystemProvider {
  const env = detectEnvironment()

  switch (env) {
    case 'browser':
      return new BrowserFileSystemProvider()

    case 'tauri':
      // TODO: Implement TauriFileSystemProvider when needed
      throw new FileSystemError(
        'Tauri file system provider is not yet implemented',
        'NOT_SUPPORTED'
      )

    default:
      throw new FileSystemError(
        'No supported file system API available. Please use a Chromium-based browser (Chrome, Edge, Brave) for full functionality.',
        'NOT_SUPPORTED'
      )
  }
}

/**
 * Utility to check if a file is an image based on its name
 */
export function isImageFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'].includes(ext ?? '')
}

/**
 * Utility to check if a file is a RAW image
 */
export function isRawFile(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop()
  // Sony RAW format (ARW) is our primary target
  // Other common RAW formats included for future support
  return ['arw', 'cr2', 'cr3', 'nef', 'orf', 'rw2', 'dng', 'raf'].includes(ext ?? '')
}

/**
 * Utility to check if a file is supported by Literoom
 */
export function isSupportedFile(name: string): boolean {
  return isImageFile(name) || isRawFile(name)
}
