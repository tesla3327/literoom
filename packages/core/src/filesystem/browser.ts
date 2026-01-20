/**
 * Browser File System Access API Provider
 *
 * Implements the FileSystemProvider interface using the browser's
 * File System Access API (available in Chromium-based browsers).
 */

import type {
  DirectoryHandle,
  FileEntry,
  FileHandle,
  FileMetadata,
  FileSystemProvider,
  PermissionState,
} from './types'
import { FileSystemError } from './types'

// Internal symbol to store native handles
const NATIVE_HANDLE = Symbol('nativeHandle')

interface BrowserDirectoryHandle extends DirectoryHandle {
  [NATIVE_HANDLE]: FileSystemDirectoryHandle
}

interface BrowserFileHandle extends FileHandle {
  [NATIVE_HANDLE]: FileSystemFileHandle
}

/**
 * Wrap a native FileSystemDirectoryHandle in our abstraction
 */
function wrapDirectoryHandle(native: FileSystemDirectoryHandle): BrowserDirectoryHandle {
  return {
    name: native.name,
    kind: 'directory',
    [NATIVE_HANDLE]: native,
  }
}

/**
 * Wrap a native FileSystemFileHandle in our abstraction
 */
function wrapFileHandle(native: FileSystemFileHandle): BrowserFileHandle {
  return {
    name: native.name,
    kind: 'file',
    [NATIVE_HANDLE]: native,
  }
}

/**
 * Get the native handle from our abstraction
 */
function unwrapDirectoryHandle(handle: DirectoryHandle): FileSystemDirectoryHandle {
  const native = (handle as BrowserDirectoryHandle)[NATIVE_HANDLE]
  if (!native) {
    throw new FileSystemError('Invalid directory handle', 'INVALID_STATE')
  }
  return native
}

function unwrapFileHandle(handle: FileHandle): FileSystemFileHandle {
  const native = (handle as BrowserFileHandle)[NATIVE_HANDLE]
  if (!native) {
    throw new FileSystemError('Invalid file handle', 'INVALID_STATE')
  }
  return native
}

/**
 * Check if the File System Access API is available
 */
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window
}

/**
 * Browser implementation of FileSystemProvider using File System Access API
 */
export class BrowserFileSystemProvider implements FileSystemProvider {
  readonly name = 'browser'
  readonly supportsPersistence = true

  private db: IDBDatabase | null = null
  private readonly DB_NAME = 'literoom-fs'
  private readonly STORE_NAME = 'handles'

  /**
   * Initialize IndexedDB for handle persistence
   */
  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1)

      request.onerror = () => {
        reject(new FileSystemError('Failed to open IndexedDB', 'UNKNOWN', request.error ?? undefined))
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME)
        }
      }
    })
  }

  async selectDirectory(): Promise<DirectoryHandle> {
    if (!isFileSystemAccessSupported()) {
      throw new FileSystemError(
        'File System Access API is not supported in this browser',
        'NOT_SUPPORTED'
      )
    }

    try {
      const handle = await window.showDirectoryPicker({
        mode: 'read',
      })
      return wrapDirectoryHandle(handle)
    }
    catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'AbortError') {
          throw new FileSystemError('User cancelled directory selection', 'ABORTED', error)
        }
        if (error.name === 'SecurityError') {
          throw new FileSystemError('Permission denied', 'PERMISSION_DENIED', error)
        }
      }
      throw new FileSystemError('Failed to select directory', 'UNKNOWN', error as Error)
    }
  }

  async listDirectory(handle: DirectoryHandle, recursive = false): Promise<FileEntry[]> {
    const native = unwrapDirectoryHandle(handle)
    const entries: FileEntry[] = []

    try {
      for await (const entry of native.values()) {
        if (entry.kind === 'file') {
          entries.push({
            name: entry.name,
            kind: 'file',
            handle: wrapFileHandle(entry as FileSystemFileHandle),
          })
        }
        else {
          const dirHandle = wrapDirectoryHandle(entry as FileSystemDirectoryHandle)
          entries.push({
            name: entry.name,
            kind: 'directory',
            handle: dirHandle,
          })

          if (recursive) {
            const subEntries = await this.listDirectory(dirHandle, true)
            for (const subEntry of subEntries) {
              entries.push({
                ...subEntry,
                name: `${entry.name}/${subEntry.name}`,
              })
            }
          }
        }
      }
    }
    catch (error) {
      throw new FileSystemError('Failed to list directory', 'UNKNOWN', error as Error)
    }

    return entries
  }

  async readFile(handle: FileHandle): Promise<ArrayBuffer> {
    const native = unwrapFileHandle(handle)

    try {
      const file = await native.getFile()
      return await file.arrayBuffer()
    }
    catch (error) {
      throw new FileSystemError('Failed to read file', 'UNKNOWN', error as Error)
    }
  }

  async readFileAsBlob(handle: FileHandle): Promise<Blob> {
    const native = unwrapFileHandle(handle)

    try {
      return await native.getFile()
    }
    catch (error) {
      throw new FileSystemError('Failed to read file', 'UNKNOWN', error as Error)
    }
  }

  async getFileMetadata(handle: FileHandle): Promise<FileMetadata> {
    const native = unwrapFileHandle(handle)

    try {
      const file = await native.getFile()
      return {
        name: file.name,
        size: file.size,
        type: file.type || undefined,
        lastModified: file.lastModified,
      }
    }
    catch (error) {
      throw new FileSystemError('Failed to get file metadata', 'UNKNOWN', error as Error)
    }
  }

  async writeFile(handle: FileHandle, data: ArrayBuffer | Blob | string): Promise<void> {
    const native = unwrapFileHandle(handle)

    try {
      const writable = await native.createWritable()
      await writable.write(data)
      await writable.close()
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        throw new FileSystemError('Write permission denied', 'PERMISSION_DENIED', error)
      }
      throw new FileSystemError('Failed to write file', 'UNKNOWN', error as Error)
    }
  }

  async createFile(directory: DirectoryHandle, name: string): Promise<FileHandle> {
    const native = unwrapDirectoryHandle(directory)

    try {
      const fileHandle = await native.getFileHandle(name, { create: true })
      return wrapFileHandle(fileHandle)
    }
    catch (error) {
      throw new FileSystemError('Failed to create file', 'UNKNOWN', error as Error)
    }
  }

  async createDirectory(parent: DirectoryHandle, name: string): Promise<DirectoryHandle> {
    const native = unwrapDirectoryHandle(parent)

    try {
      const dirHandle = await native.getDirectoryHandle(name, { create: true })
      return wrapDirectoryHandle(dirHandle)
    }
    catch (error) {
      throw new FileSystemError('Failed to create directory', 'UNKNOWN', error as Error)
    }
  }

  async queryPermission(
    handle: DirectoryHandle | FileHandle,
    mode: 'read' | 'readwrite'
  ): Promise<PermissionState> {
    const native
      = handle.kind === 'directory'
        ? unwrapDirectoryHandle(handle as DirectoryHandle)
        : unwrapFileHandle(handle as FileHandle)

    try {
      const result = await native.queryPermission({ mode })
      return result as PermissionState
    }
    catch {
      return 'prompt'
    }
  }

  async requestPermission(
    handle: DirectoryHandle | FileHandle,
    mode: 'read' | 'readwrite'
  ): Promise<PermissionState> {
    const native
      = handle.kind === 'directory'
        ? unwrapDirectoryHandle(handle as DirectoryHandle)
        : unwrapFileHandle(handle as FileHandle)

    try {
      const result = await native.requestPermission({ mode })
      return result as PermissionState
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return 'denied'
      }
      throw new FileSystemError('Failed to request permission', 'UNKNOWN', error as Error)
    }
  }

  async saveHandle(key: string, handle: DirectoryHandle): Promise<void> {
    const native = unwrapDirectoryHandle(handle)
    const db = await this.getDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite')
      const store = tx.objectStore(this.STORE_NAME)
      const request = store.put(native, key)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        reject(new FileSystemError('Failed to save handle', 'UNKNOWN', request.error ?? undefined))
      }
    })
  }

  async loadHandle(key: string): Promise<DirectoryHandle | null> {
    const db = await this.getDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly')
      const store = tx.objectStore(this.STORE_NAME)
      const request = store.get(key)

      request.onsuccess = () => {
        const native = request.result as FileSystemDirectoryHandle | undefined
        if (native) {
          resolve(wrapDirectoryHandle(native))
        }
        else {
          resolve(null)
        }
      }

      request.onerror = () => {
        reject(new FileSystemError('Failed to load handle', 'UNKNOWN', request.error ?? undefined))
      }
    })
  }

  async removeHandle(key: string): Promise<void> {
    const db = await this.getDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite')
      const store = tx.objectStore(this.STORE_NAME)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        reject(new FileSystemError('Failed to remove handle', 'UNKNOWN', request.error ?? undefined))
      }
    })
  }

  async listSavedHandles(): Promise<string[]> {
    const db = await this.getDB()

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly')
      const store = tx.objectStore(this.STORE_NAME)
      const request = store.getAllKeys()

      request.onsuccess = () => {
        resolve(request.result as string[])
      }

      request.onerror = () => {
        reject(new FileSystemError('Failed to list handles', 'UNKNOWN', request.error ?? undefined))
      }
    })
  }
}
