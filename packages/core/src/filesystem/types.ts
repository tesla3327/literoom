/**
 * File System Abstraction Types
 *
 * These types define a platform-agnostic interface for file system operations
 * that can be implemented by both the browser File System Access API and Tauri.
 */

/**
 * Permission state for a file or directory handle
 */
export type PermissionState = 'granted' | 'denied' | 'prompt'

/**
 * Abstract directory handle that works across platforms
 */
export interface DirectoryHandle {
  /** Name of the directory */
  readonly name: string
  /** Kind is always 'directory' */
  readonly kind: 'directory'
}

/**
 * Abstract file handle that works across platforms
 */
export interface FileHandle {
  /** Name of the file */
  readonly name: string
  /** Kind is always 'file' */
  readonly kind: 'file'
}

/**
 * Entry in a directory listing
 */
export interface FileEntry {
  /** Name of the file or directory */
  name: string
  /** Type of entry */
  kind: 'file' | 'directory'
  /** Handle to the entry */
  handle: FileHandle | DirectoryHandle
}

/**
 * File metadata
 */
export interface FileMetadata {
  /** File name */
  name: string
  /** File size in bytes */
  size: number
  /** MIME type (if available) */
  type?: string
  /** Last modified timestamp */
  lastModified: number
}

/**
 * File System Provider Interface
 *
 * This interface abstracts file system operations to work across
 * different platforms (browser File System Access API, Tauri, etc.)
 */
export interface FileSystemProvider {
  /** Name of the provider (e.g., 'browser', 'tauri') */
  readonly name: string

  /** Whether this provider supports persistent handles across sessions */
  readonly supportsPersistence: boolean

  /**
   * Show a directory picker dialog
   * @returns A handle to the selected directory
   */
  selectDirectory(): Promise<DirectoryHandle>

  /**
   * List contents of a directory
   * @param handle - Directory handle to list
   * @param recursive - Whether to list recursively
   */
  listDirectory(handle: DirectoryHandle, recursive?: boolean): Promise<FileEntry[]>

  /**
   * Read a file as an ArrayBuffer
   * @param handle - File handle to read
   */
  readFile(handle: FileHandle): Promise<ArrayBuffer>

  /**
   * Read a file as a Blob
   * @param handle - File handle to read
   */
  readFileAsBlob(handle: FileHandle): Promise<Blob>

  /**
   * Get metadata for a file
   * @param handle - File handle to get metadata for
   */
  getFileMetadata(handle: FileHandle): Promise<FileMetadata>

  /**
   * Write data to a file (requires write permission)
   * @param handle - File handle to write to
   * @param data - Data to write
   */
  writeFile(handle: FileHandle, data: ArrayBuffer | Blob | string): Promise<void>

  /**
   * Create a new file in a directory
   * @param directory - Directory to create file in
   * @param name - Name of the new file
   */
  createFile(directory: DirectoryHandle, name: string): Promise<FileHandle>

  /**
   * Create a new subdirectory
   * @param parent - Parent directory
   * @param name - Name of the new directory
   */
  createDirectory(parent: DirectoryHandle, name: string): Promise<DirectoryHandle>

  /**
   * Check permission state for a handle
   * @param handle - Handle to check
   * @param mode - Permission mode to check
   */
  queryPermission(
    handle: DirectoryHandle | FileHandle,
    mode: 'read' | 'readwrite'
  ): Promise<PermissionState>

  /**
   * Request permission for a handle
   * @param handle - Handle to request permission for
   * @param mode - Permission mode to request
   */
  requestPermission(
    handle: DirectoryHandle | FileHandle,
    mode: 'read' | 'readwrite'
  ): Promise<PermissionState>

  /**
   * Save a handle for later retrieval (persistence)
   * @param key - Storage key
   * @param handle - Handle to save
   */
  saveHandle(key: string, handle: DirectoryHandle): Promise<void>

  /**
   * Load a previously saved handle
   * @param key - Storage key
   */
  loadHandle(key: string): Promise<DirectoryHandle | null>

  /**
   * Remove a saved handle
   * @param key - Storage key
   */
  removeHandle(key: string): Promise<void>

  /**
   * List all saved handle keys
   */
  listSavedHandles(): Promise<string[]>
}

/**
 * Error thrown when a file system operation fails
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'PERMISSION_DENIED'
      | 'NOT_SUPPORTED'
      | 'ABORTED'
      | 'INVALID_STATE'
      | 'UNKNOWN',
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'FileSystemError'
  }
}
