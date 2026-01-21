/**
 * MockFileSystemProvider - Mock implementation for testing and demo mode.
 *
 * This mock implementation of FileSystemProvider can be used in:
 * - Unit tests to avoid browser File System Access API
 * - E2E tests with demo catalog mode
 * - Development without real folder access
 *
 * By default, it returns a predefined set of demo files.
 * Configure with custom options for different test scenarios.
 */

import type {
  FileSystemProvider,
  DirectoryHandle,
  FileHandle,
  FileEntry,
  FileMetadata,
  PermissionState,
} from './types'
import { FileSystemError } from './types'

/**
 * Options for MockFileSystemProvider configuration.
 */
export interface MockFileSystemProviderOptions {
  /** Base URL for loading demo images (default: '/demo-images') */
  demoImageBaseUrl?: string
  /** Simulate permission state (default: 'granted') */
  permissionState?: PermissionState
  /** Number of demo files to generate (default: 50) */
  demoFileCount?: number
  /** Mix of file extensions (default: 75% jpg, 25% arw) */
  rawRate?: number
  /** Whether to include subdirectories (default: false) */
  includeSubdirs?: boolean
  /** Simulate delay for operations in ms (default: 0) */
  operationDelay?: number
  /** Whether to fail selectDirectory (default: false) */
  failSelect?: boolean
  /** Whether to fail readFile (default: false) */
  failRead?: boolean
}

/**
 * Mock directory handle for testing.
 */
export interface MockDirectoryHandle extends DirectoryHandle {
  /** Internal identifier for the mock directory */
  readonly _mockId: string
  /** Path of the mock directory */
  readonly _mockPath: string
}

/**
 * Mock file handle for testing.
 */
export interface MockFileHandle extends FileHandle {
  /** Internal identifier for the mock file */
  readonly _mockId: string
  /** Full path of the mock file */
  readonly _mockPath: string
  /** File extension */
  readonly _extension: string
  /** File size in bytes */
  readonly _size: number
  /** Last modified timestamp */
  readonly _lastModified: number
}

/**
 * Default options for MockFileSystemProvider.
 */
const DEFAULT_OPTIONS: Required<MockFileSystemProviderOptions> = {
  demoImageBaseUrl: '/demo-images',
  permissionState: 'granted',
  demoFileCount: 50,
  rawRate: 0.25,
  includeSubdirs: false,
  operationDelay: 0,
  failSelect: false,
  failRead: false,
}

/**
 * Generate a deterministic file size in bytes.
 */
function generateFileSize(index: number, isRaw: boolean): number {
  const baseSeed = (index * 13) % 100
  if (isRaw) {
    return 15_000_000 + baseSeed * 150_000
  }
  return 2_000_000 + baseSeed * 60_000
}

/**
 * Generate demo file entries based on options.
 */
function generateDemoFiles(options: Required<MockFileSystemProviderOptions>): MockFileHandle[] {
  const files: MockFileHandle[] = []

  for (let i = 0; i < options.demoFileCount; i++) {
    const normalized = ((i * 3) % 100) / 100
    const extension = normalized < options.rawRate ? 'arw' : 'jpg'
    const filename = `IMG_${String(i + 1).padStart(4, '0')}.${extension}`
    const isRaw = extension === 'arw'

    files.push({
      name: filename,
      kind: 'file',
      _mockId: `mock-file-${i}`,
      _mockPath: filename,
      _extension: extension,
      _size: generateFileSize(i, isRaw),
      _lastModified: Date.now() - i * 3600000, // 1 hour apart
    })
  }

  return files
}

/**
 * Mock implementation of FileSystemProvider for testing.
 */
export class MockFileSystemProvider implements FileSystemProvider {
  readonly name = 'mock'
  readonly supportsPersistence = false

  private options: Required<MockFileSystemProviderOptions>
  private savedHandles = new Map<string, MockDirectoryHandle>()
  private demoFiles: MockFileHandle[]

  constructor(options: MockFileSystemProviderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.demoFiles = generateDemoFiles(this.options)
  }

  /**
   * Helper to simulate async delay.
   */
  private async delay(): Promise<void> {
    if (this.options.operationDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.operationDelay))
    }
  }

  /**
   * Show a directory picker dialog (mocked).
   * Returns a mock handle for 'Demo Photos' folder.
   */
  async selectDirectory(): Promise<DirectoryHandle> {
    await this.delay()

    if (this.options.failSelect) {
      throw new FileSystemError('Mock directory selection failed', 'ABORTED')
    }

    const handle: MockDirectoryHandle = {
      name: 'Demo Photos',
      kind: 'directory',
      _mockId: 'demo-root',
      _mockPath: '/Demo Photos',
    }

    return handle
  }

  /**
   * List contents of a directory.
   * Returns predefined demo files.
   */
  async listDirectory(
    handle: DirectoryHandle,
    _recursive?: boolean
  ): Promise<FileEntry[]> {
    await this.delay()

    const mockHandle = handle as MockDirectoryHandle
    if (!mockHandle._mockId) {
      throw new FileSystemError('Invalid directory handle', 'INVALID_STATE')
    }

    const entries: FileEntry[] = this.demoFiles.map((file) => ({
      name: file.name,
      kind: 'file' as const,
      handle: file,
    }))

    // Optionally add subdirectories
    if (this.options.includeSubdirs && mockHandle._mockId === 'demo-root') {
      entries.push({
        name: 'Subfolder',
        kind: 'directory',
        handle: {
          name: 'Subfolder',
          kind: 'directory',
          _mockId: 'demo-subdir',
          _mockPath: '/Demo Photos/Subfolder',
        } as MockDirectoryHandle,
      })
    }

    return entries
  }

  /**
   * Read a file as an ArrayBuffer.
   * In mock mode, fetches from demo-images URL or returns placeholder data.
   */
  async readFile(handle: FileHandle): Promise<ArrayBuffer> {
    await this.delay()

    if (this.options.failRead) {
      throw new FileSystemError('Mock file read failed', 'NOT_FOUND')
    }

    const mockHandle = handle as MockFileHandle
    if (!mockHandle._mockId) {
      throw new FileSystemError('Invalid file handle', 'INVALID_STATE')
    }

    // Try to fetch from demo images URL
    try {
      const url = `${this.options.demoImageBaseUrl}/${mockHandle.name}`
      const response = await fetch(url)
      if (response.ok) {
        return response.arrayBuffer()
      }
    } catch {
      // Fall through to placeholder
    }

    // Return placeholder image data
    // This is a minimal JPEG header for testing
    return createPlaceholderJpeg()
  }

  /**
   * Read a file as a Blob.
   */
  async readFileAsBlob(handle: FileHandle): Promise<Blob> {
    const buffer = await this.readFile(handle)
    const mockHandle = handle as MockFileHandle
    const mimeType = mockHandle._extension === 'arw' ? 'image/x-sony-arw' : 'image/jpeg'
    return new Blob([buffer], { type: mimeType })
  }

  /**
   * Get metadata for a file.
   */
  async getFileMetadata(handle: FileHandle): Promise<FileMetadata> {
    await this.delay()

    const mockHandle = handle as MockFileHandle
    if (!mockHandle._mockId) {
      throw new FileSystemError('Invalid file handle', 'INVALID_STATE')
    }

    return {
      name: mockHandle.name,
      size: mockHandle._size,
      type: mockHandle._extension === 'arw' ? 'image/x-sony-arw' : 'image/jpeg',
      lastModified: mockHandle._lastModified,
    }
  }

  /**
   * Write data to a file (no-op in mock mode).
   */
  async writeFile(
    _handle: FileHandle,
    _data: ArrayBuffer | Blob | string
  ): Promise<void> {
    await this.delay()
    // No-op for mock
  }

  /**
   * Create a new file (returns a mock handle).
   */
  async createFile(
    _directory: DirectoryHandle,
    name: string
  ): Promise<FileHandle> {
    await this.delay()

    const extension = name.split('.').pop()?.toLowerCase() ?? ''
    return {
      name,
      kind: 'file',
      _mockId: `mock-created-${Date.now()}`,
      _mockPath: `/${name}`,
      _extension: extension,
      _size: 0,
      _lastModified: Date.now(),
    } as MockFileHandle
  }

  /**
   * Create a new subdirectory (returns a mock handle).
   */
  async createDirectory(
    _parent: DirectoryHandle,
    name: string
  ): Promise<DirectoryHandle> {
    await this.delay()

    return {
      name,
      kind: 'directory',
      _mockId: `mock-dir-${Date.now()}`,
      _mockPath: `/${name}`,
    } as MockDirectoryHandle
  }

  /**
   * Check permission state (always returns configured state).
   */
  async queryPermission(
    _handle: DirectoryHandle | FileHandle,
    _mode: 'read' | 'readwrite'
  ): Promise<PermissionState> {
    await this.delay()
    return this.options.permissionState
  }

  /**
   * Request permission (always returns configured state).
   */
  async requestPermission(
    _handle: DirectoryHandle | FileHandle,
    _mode: 'read' | 'readwrite'
  ): Promise<PermissionState> {
    await this.delay()
    return this.options.permissionState
  }

  /**
   * Save a handle for later retrieval (in-memory only).
   */
  async saveHandle(key: string, handle: DirectoryHandle): Promise<void> {
    await this.delay()
    this.savedHandles.set(key, handle as MockDirectoryHandle)
  }

  /**
   * Load a previously saved handle.
   */
  async loadHandle(key: string): Promise<DirectoryHandle | null> {
    await this.delay()
    return this.savedHandles.get(key) ?? null
  }

  /**
   * Remove a saved handle.
   */
  async removeHandle(key: string): Promise<void> {
    await this.delay()
    this.savedHandles.delete(key)
  }

  /**
   * List all saved handle keys.
   */
  async listSavedHandles(): Promise<string[]> {
    await this.delay()
    return Array.from(this.savedHandles.keys())
  }

  /**
   * Get the demo files for testing access.
   */
  getDemoFiles(): MockFileHandle[] {
    return [...this.demoFiles]
  }

  /**
   * Set custom demo files for specific test scenarios.
   */
  setDemoFiles(files: MockFileHandle[]): void {
    this.demoFiles = files
  }

  /**
   * Reset to default demo files.
   */
  resetDemoFiles(): void {
    this.demoFiles = generateDemoFiles(this.options)
  }
}

/**
 * Create a minimal placeholder JPEG for testing.
 * This is a valid 1x1 pixel JPEG.
 */
function createPlaceholderJpeg(): ArrayBuffer {
  // Minimal valid JPEG: 1x1 red pixel
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xdb, 0x20, 0xa8, 0xf1, 0x45, 0x00,
    0x14, 0x50, 0x01, 0x40, 0x05, 0x00, 0x14, 0x00, 0x50, 0x01, 0x40, 0x05,
    0x00, 0x14, 0x00, 0x50, 0x01, 0x40, 0x05, 0x14, 0x00, 0x50, 0x01, 0x45,
    0x00, 0x14, 0x50, 0x01, 0x45, 0x00, 0x14, 0x00, 0x51, 0x40, 0x05, 0x14,
    0x00, 0x51, 0x40, 0x05, 0x14, 0x01, 0xff, 0xd9,
  ])
  return bytes.buffer
}

/** Counter for generating unique IDs */
let mockIdCounter = 0

/**
 * Create a mock file handle for testing.
 * Useful for setting up specific test scenarios.
 */
export function createMockFileHandle(
  name: string,
  options?: {
    size?: number
    lastModified?: number
  }
): MockFileHandle {
  const lastDot = name.lastIndexOf('.')
  const extension = lastDot !== -1 ? name.slice(lastDot + 1).toLowerCase() : ''
  return {
    name,
    kind: 'file',
    _mockId: `mock-${name}-${Date.now()}-${mockIdCounter++}`,
    _mockPath: `/${name}`,
    _extension: extension,
    _size: options?.size ?? 1000000,
    _lastModified: options?.lastModified ?? Date.now(),
  }
}

/**
 * Create a mock directory handle for testing.
 */
export function createMockDirectoryHandle(
  name: string,
  path?: string
): MockDirectoryHandle {
  return {
    name,
    kind: 'directory',
    _mockId: `mock-dir-${name}-${Date.now()}-${mockIdCounter++}`,
    _mockPath: path ?? `/${name}`,
  }
}
