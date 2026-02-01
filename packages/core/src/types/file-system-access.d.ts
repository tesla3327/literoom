/**
 * Type declarations for the File System Access API
 * These are experimental browser APIs that TypeScript doesn't have built-in types for.
 * https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API
 */

/**
 * Permission descriptor for FileSystemHandle permission methods
 */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

/**
 * Options for showDirectoryPicker
 */
interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
}

declare global {
  /**
   * Extend FileSystemDirectoryHandle with experimental methods
   */
  interface FileSystemDirectoryHandle {
    /**
     * Query the current permission state for the handle
     */
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>

    /**
     * Request permission for the handle
     */
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>

    /**
     * Returns an async iterator of the entries (files and subdirectories) in the directory
     */
    values(): AsyncIterableIterator<FileSystemHandle>

    /**
     * Returns an async iterator of [name, handle] pairs for the entries in the directory
     */
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>

    /**
     * Returns an async iterator of the names of entries in the directory
     */
    keys(): AsyncIterableIterator<string>
  }

  /**
   * Extend FileSystemFileHandle with experimental methods
   */
  interface FileSystemFileHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  /**
   * Extend Window interface with showDirectoryPicker
   */
  interface Window {
    /**
     * Shows a directory picker that allows the user to select a directory
     */
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
}

export {}
