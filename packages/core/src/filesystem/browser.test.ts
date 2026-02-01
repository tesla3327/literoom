import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { BrowserFileSystemProvider, isFileSystemAccessSupported } from './browser'
import type { FileHandle } from './types'
import { FileSystemError } from './types'

// Helper to create a mock native directory handle
function createMockNativeDirectoryHandle(overrides: Partial<FileSystemDirectoryHandle> = {}): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'test-dir',
    isSameEntry: vi.fn(),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    resolve: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
    ...overrides,
  } as unknown as FileSystemDirectoryHandle
}

// Helper to create a mock native file handle
function createMockNativeFileHandle(overrides: Partial<FileSystemFileHandle> = {}): FileSystemFileHandle {
  return {
    kind: 'file',
    name: 'test-file.jpg',
    isSameEntry: vi.fn(),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    getFile: vi.fn(),
    createWritable: vi.fn(),
    ...overrides,
  } as unknown as FileSystemFileHandle
}

// Mock async iterator for directory values
function createMockValuesIterator(entries: FileSystemHandle[]) {
  return function () {
    let index = 0
    return {
      async next() {
        if (index < entries.length) {
          return { done: false as const, value: entries[index++] }
        }
        return { done: true as const, value: undefined }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } as AsyncIterableIterator<FileSystemHandle>
  }
}

// Mock async iterator for directory values with entry descriptors
function createMockValuesIteratorFromDescriptors(
  entries: Array<{ kind: 'file' | 'directory'; name: string; handle?: FileSystemHandle }>
) {
  return function () {
    let index = 0
    return {
      async next() {
        if (index < entries.length) {
          const entry = entries[index++]
          if (entry.handle) {
            return { done: false as const, value: entry.handle }
          }
          const handle = entry.kind === 'file'
            ? createMockNativeFileHandle({ name: entry.name })
            : createMockNativeDirectoryHandle({ name: entry.name })
          return { done: false as const, value: handle as FileSystemHandle }
        }
        return { done: true as const, value: undefined }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } as AsyncIterableIterator<FileSystemHandle>
  }
}

// Helper to create a directory handle with entries for iteration
function createMockNativeDirectoryHandleWithEntries(
  name: string,
  entries: Array<{ kind: 'file' | 'directory'; name: string; handle?: FileSystemHandle }> = []
): FileSystemDirectoryHandle {
  return createMockNativeDirectoryHandle({
    name,
    values: createMockValuesIteratorFromDescriptors(entries),
  })
}

describe('isFileSystemAccessSupported', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when showDirectoryPicker is available', () => {
    // @ts-expect-error - mocking browser API
    globalThis.window = {
      showDirectoryPicker: vi.fn(),
    }

    expect(isFileSystemAccessSupported()).toBe(true)
  })

  it('returns false when showDirectoryPicker is not available', () => {
    // @ts-expect-error - mocking browser API
    globalThis.window = {}

    expect(isFileSystemAccessSupported()).toBe(false)
  })

  it('returns true even when showDirectoryPicker is undefined (property exists)', () => {
    // Note: The 'in' operator checks if property exists, not if it has a truthy value
    // @ts-expect-error - mocking browser API
    globalThis.window = {
      showDirectoryPicker: undefined as unknown as typeof window.showDirectoryPicker,
    }

    // This returns true because the property exists in the object
    expect(isFileSystemAccessSupported()).toBe(true)
  })

  it('returns true when showDirectoryPicker exists alongside other properties', () => {
    // Use 'as any' since Window type declarations may vary
    (globalThis as any).window = {
      showDirectoryPicker: vi.fn(),
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker: vi.fn(),
      location: { href: 'https://example.com' } as unknown as Location,
    }

    expect(isFileSystemAccessSupported()).toBe(true)
  })
})

describe('BrowserFileSystemProvider', () => {
  let provider: BrowserFileSystemProvider
  let mockShowDirectoryPicker: ReturnType<typeof vi.fn>

  beforeEach(() => {
    provider = new BrowserFileSystemProvider()
    mockShowDirectoryPicker = vi.fn()
    // @ts-expect-error - mocking browser API
    globalThis.window = {
      showDirectoryPicker: mockShowDirectoryPicker,
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('provider properties', () => {
    it('has correct name', () => {
      expect(provider.name).toBe('browser')
    })

    it('supports persistence', () => {
      expect(provider.supportsPersistence).toBe(true)
    })
  })

  describe('wrapDirectoryHandle (via public API)', () => {
    it('wraps native directory handle via selectDirectory', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        name: 'Test Directory',
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()

      expect(handle.name).toBe('Test Directory')
      expect(handle.kind).toBe('directory')
    })

    it('wraps nested directory handles via listDirectory', async () => {
      const mockSubDir = createMockNativeDirectoryHandle({ name: 'Subfolder' })
      const mockNativeHandle = createMockNativeDirectoryHandle({
        name: 'Root',
        values: createMockValuesIterator([mockSubDir]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('Subfolder')
      expect(entries[0].kind).toBe('directory')
      expect(entries[0].handle.kind).toBe('directory')
    })

    it('wraps directory handle via createDirectory', async () => {
      const mockSubDir = createMockNativeDirectoryHandle({ name: 'new-folder' })
      const mockNativeHandle = createMockNativeDirectoryHandle({
        name: 'Root',
        getDirectoryHandle: vi.fn().mockResolvedValue(mockSubDir),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const rootHandle = await provider.selectDirectory()
      const dirHandle = await provider.createDirectory(rootHandle, 'new-folder')

      expect(dirHandle.name).toBe('new-folder')
      expect(dirHandle.kind).toBe('directory')
    })
  })

  describe('wrapFileHandle (via public API)', () => {
    it('wraps native file handle via listDirectory', async () => {
      const mockFileHandle = createMockNativeFileHandle({ name: 'photo.jpg' })
      const mockNativeHandle = createMockNativeDirectoryHandle({
        name: 'Root',
        values: createMockValuesIterator([mockFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('photo.jpg')
      expect(entries[0].kind).toBe('file')
      expect(entries[0].handle.kind).toBe('file')
    })

    it('wraps file handle via createFile', async () => {
      const mockFileHandle = createMockNativeFileHandle({ name: 'new-file.txt' })
      const mockNativeHandle = createMockNativeDirectoryHandle({
        name: 'Root',
        getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const rootHandle = await provider.selectDirectory()
      const fileHandle = await provider.createFile(rootHandle, 'new-file.txt')

      expect(fileHandle.name).toBe('new-file.txt')
      expect(fileHandle.kind).toBe('file')
    })

    it('wraps multiple file and directory handles via listDirectory', async () => {
      const mockFile1 = createMockNativeFileHandle({ name: 'image1.jpg' })
      const mockFile2 = createMockNativeFileHandle({ name: 'image2.png' })
      const mockSubDir = createMockNativeDirectoryHandle({ name: 'photos' })
      const mockNativeHandle = createMockNativeDirectoryHandle({
        name: 'Root',
        values: createMockValuesIterator([mockFile1, mockSubDir, mockFile2]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      expect(entries).toHaveLength(3)
      expect(entries[0].name).toBe('image1.jpg')
      expect(entries[0].kind).toBe('file')
      expect(entries[1].name).toBe('photos')
      expect(entries[1].kind).toBe('directory')
      expect(entries[2].name).toBe('image2.png')
      expect(entries[2].kind).toBe('file')
    })
  })

  describe('unwrapDirectoryHandle error cases (via public API)', () => {
    it('throws FileSystemError with INVALID_STATE when listing invalid directory', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.listDirectory(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.listDirectory(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when creating file in invalid directory', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.createFile(invalidHandle, 'file.txt')).rejects.toThrow(FileSystemError)
      await expect(provider.createFile(invalidHandle, 'file.txt')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when creating subdirectory in invalid directory', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.createDirectory(invalidHandle, 'subdir')).rejects.toThrow(FileSystemError)
      await expect(provider.createDirectory(invalidHandle, 'subdir')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when querying permission on invalid directory', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.queryPermission(invalidHandle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.queryPermission(invalidHandle, 'read')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when requesting permission on invalid directory', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.requestPermission(invalidHandle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.requestPermission(invalidHandle, 'read')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('error message indicates invalid directory handle', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      try {
        await provider.listDirectory(invalidHandle)
        expect.fail('Expected error to be thrown')
      }
      catch (error) {
        expect(error).toBeInstanceOf(FileSystemError)
        expect((error as FileSystemError).message).toBe('Invalid directory handle')
      }
    })
  })

  describe('unwrapFileHandle error cases (via public API)', () => {
    it('throws FileSystemError with INVALID_STATE when reading invalid file', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.readFile(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.readFile(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when reading blob from invalid file', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.readFileAsBlob(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.readFileAsBlob(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when getting metadata from invalid file', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.getFileMetadata(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.getFileMetadata(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when writing to invalid file', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.writeFile(invalidHandle, new ArrayBuffer(10))).rejects.toThrow(FileSystemError)
      await expect(provider.writeFile(invalidHandle, new ArrayBuffer(10))).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when querying permission on invalid file', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.queryPermission(invalidHandle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.queryPermission(invalidHandle, 'read')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with INVALID_STATE when requesting permission on invalid file', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.requestPermission(invalidHandle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.requestPermission(invalidHandle, 'read')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('error message indicates invalid file handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      try {
        await provider.readFile(invalidHandle)
        expect.fail('Expected error to be thrown')
      }
      catch (error) {
        expect(error).toBeInstanceOf(FileSystemError)
        expect((error as FileSystemError).message).toBe('Invalid file handle')
      }
    })
  })

  describe('selectDirectory()', () => {
    it('returns wrapped directory handle on success', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({ name: 'TestFolder' })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const result = await provider.selectDirectory()

      expect(result.name).toBe('TestFolder')
      expect(result.kind).toBe('directory')
      expect(mockShowDirectoryPicker).toHaveBeenCalledWith({ mode: 'read' })
    })

    it('throws FileSystemError with code NOT_SUPPORTED when API not available', async () => {
      // @ts-expect-error - mocking browser API without showDirectoryPicker
      globalThis.window = {}

      await expect(provider.selectDirectory()).rejects.toThrow(FileSystemError)
      await expect(provider.selectDirectory()).rejects.toMatchObject({
        code: 'NOT_SUPPORTED',
        message: 'File System Access API is not supported in this browser',
      })
    })

    it('throws FileSystemError with code ABORTED when user cancels (AbortError DOMException)', async () => {
      const abortError = new DOMException('User cancelled', 'AbortError')
      mockShowDirectoryPicker.mockRejectedValue(abortError)

      await expect(provider.selectDirectory()).rejects.toThrow(FileSystemError)
      await expect(provider.selectDirectory()).rejects.toMatchObject({
        code: 'ABORTED',
        message: 'User cancelled directory selection',
      })
    })

    it('throws FileSystemError with code PERMISSION_DENIED on SecurityError', async () => {
      const securityError = new DOMException('Security error', 'SecurityError')
      mockShowDirectoryPicker.mockRejectedValue(securityError)

      await expect(provider.selectDirectory()).rejects.toThrow(FileSystemError)
      await expect(provider.selectDirectory()).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
      })
    })

    it('throws FileSystemError with code UNKNOWN for other errors', async () => {
      const genericError = new Error('Something went wrong')
      mockShowDirectoryPicker.mockRejectedValue(genericError)

      await expect(provider.selectDirectory()).rejects.toThrow(FileSystemError)
      await expect(provider.selectDirectory()).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Failed to select directory',
      })
    })

    it('throws FileSystemError with code UNKNOWN for non-AbortError/SecurityError DOMException', async () => {
      const otherDOMError = new DOMException('Some error', 'NotFoundError')
      mockShowDirectoryPicker.mockRejectedValue(otherDOMError)

      await expect(provider.selectDirectory()).rejects.toThrow(FileSystemError)
      await expect(provider.selectDirectory()).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })
  })

  describe('listDirectory()', () => {
    it('returns file entries with wrapped handles', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('TestFolder', [
        { kind: 'file', name: 'photo1.jpg' },
        { kind: 'file', name: 'photo2.jpg' },
        { kind: 'file', name: 'document.pdf' },
      ])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)

      expect(entries).toHaveLength(3)
      expect(entries[0].name).toBe('photo1.jpg')
      expect(entries[0].kind).toBe('file')
      expect(entries[0].handle).toBeDefined()
      expect(entries[0].handle.kind).toBe('file')
      expect(entries[1].name).toBe('photo2.jpg')
      expect(entries[2].name).toBe('document.pdf')
    })

    it('returns directory entries with wrapped handles', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('TestFolder', [
        { kind: 'directory', name: 'Subfolder1' },
        { kind: 'directory', name: 'Subfolder2' },
      ])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)

      expect(entries).toHaveLength(2)
      expect(entries[0].name).toBe('Subfolder1')
      expect(entries[0].kind).toBe('directory')
      expect(entries[0].handle).toBeDefined()
      expect(entries[0].handle.kind).toBe('directory')
      expect(entries[1].name).toBe('Subfolder2')
    })

    it('returns mixed file and directory entries', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('TestFolder', [
        { kind: 'file', name: 'photo.jpg' },
        { kind: 'directory', name: 'Vacation' },
        { kind: 'file', name: 'notes.txt' },
      ])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)

      expect(entries).toHaveLength(3)

      const files = entries.filter(e => e.kind === 'file')
      const dirs = entries.filter(e => e.kind === 'directory')

      expect(files).toHaveLength(2)
      expect(dirs).toHaveLength(1)
      expect(dirs[0].name).toBe('Vacation')
    })

    it('supports recursive listing (nesting subdirectories)', async () => {
      // Create subdirectory with its own files
      const subDirHandle = createMockNativeDirectoryHandleWithEntries('Vacation', [
        { kind: 'file', name: 'beach.jpg' },
        { kind: 'file', name: 'sunset.jpg' },
      ])

      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('TestFolder', [
        { kind: 'file', name: 'photo.jpg' },
        { kind: 'directory', name: 'Vacation', handle: subDirHandle },
      ])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle, true)

      // Should have: photo.jpg, Vacation/, Vacation/beach.jpg, Vacation/sunset.jpg
      expect(entries).toHaveLength(4)

      const rootFile = entries.find(e => e.name === 'photo.jpg')
      expect(rootFile).toBeDefined()
      expect(rootFile?.kind).toBe('file')

      const vacationDir = entries.find(e => e.name === 'Vacation')
      expect(vacationDir).toBeDefined()
      expect(vacationDir?.kind).toBe('directory')

      const beachFile = entries.find(e => e.name === 'Vacation/beach.jpg')
      expect(beachFile).toBeDefined()
      expect(beachFile?.kind).toBe('file')

      const sunsetFile = entries.find(e => e.name === 'Vacation/sunset.jpg')
      expect(sunsetFile).toBeDefined()
      expect(sunsetFile?.kind).toBe('file')
    })

    it('supports deeply nested recursive listing', async () => {
      // Create nested structure: root -> subdir1 -> subdir2 -> file
      const deepSubDir = createMockNativeDirectoryHandleWithEntries('Level2', [
        { kind: 'file', name: 'deep-file.jpg' },
      ])

      const subDir = createMockNativeDirectoryHandleWithEntries('Level1', [
        { kind: 'directory', name: 'Level2', handle: deepSubDir },
      ])

      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('Root', [
        { kind: 'directory', name: 'Level1', handle: subDir },
      ])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle, true)

      // Should have: Level1/, Level1/Level2/, Level1/Level2/deep-file.jpg
      expect(entries).toHaveLength(3)

      const deepFile = entries.find(e => e.name === 'Level1/Level2/deep-file.jpg')
      expect(deepFile).toBeDefined()
      expect(deepFile?.kind).toBe('file')
    })

    it('throws FileSystemError on invalid handle', async () => {
      // Create an invalid handle without the native handle symbol
      const invalidHandle = { name: 'Invalid', kind: 'directory' as const }

      await expect(provider.listDirectory(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.listDirectory(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
        message: 'Invalid directory handle',
      })
    })

    it('throws FileSystemError on iteration error', async () => {
      // Create a handle that throws during iteration
      const erroringHandle = createMockNativeDirectoryHandle({
        name: 'ErrorFolder',
        values: () => ({
          async next() {
            throw new Error('Iteration failed')
          },
          [Symbol.asyncIterator]() {
            return this
          },
        }),
      })
      mockShowDirectoryPicker.mockResolvedValue(erroringHandle)

      const dirHandle = await provider.selectDirectory()

      await expect(provider.listDirectory(dirHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.listDirectory(dirHandle)).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Failed to list directory',
      })
    })

    it('returns empty array for empty directory', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('EmptyFolder', [])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)

      expect(entries).toEqual([])
    })

    it('non-recursive listing does not include subdirectory contents', async () => {
      const subDirHandle = createMockNativeDirectoryHandleWithEntries('Subfolder', [
        { kind: 'file', name: 'hidden.jpg' },
      ])

      const mockNativeHandle = createMockNativeDirectoryHandleWithEntries('TestFolder', [
        { kind: 'file', name: 'visible.jpg' },
        { kind: 'directory', name: 'Subfolder', handle: subDirHandle },
      ])
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle, false)

      // Should only have: visible.jpg, Subfolder/
      expect(entries).toHaveLength(2)

      const hiddenFile = entries.find(e => e.name === 'Subfolder/hidden.jpg')
      expect(hiddenFile).toBeUndefined()
    })
  })

  describe('queryPermission()', () => {
    it('returns granted when permission is granted', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        queryPermission: vi.fn().mockResolvedValue('granted'),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.queryPermission(handle, 'read')

      expect(result).toBe('granted')
      expect(mockNativeHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    })

    it('returns denied when permission is denied', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        queryPermission: vi.fn().mockResolvedValue('denied'),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.queryPermission(handle, 'read')

      expect(result).toBe('denied')
    })

    it('returns prompt when permission needs prompt', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        queryPermission: vi.fn().mockResolvedValue('prompt'),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.queryPermission(handle, 'read')

      expect(result).toBe('prompt')
    })

    it('returns prompt on error (catches errors gracefully)', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        queryPermission: vi.fn().mockRejectedValue(new Error('Some error')),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.queryPermission(handle, 'read')

      expect(result).toBe('prompt')
    })

    it('works with directory handles', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        queryPermission: vi.fn().mockResolvedValue('granted'),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.queryPermission(handle, 'readwrite')

      expect(result).toBe('granted')
      expect(mockNativeHandle.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    })

    it('works with file handles', async () => {
      const mockNativeFileHandle = createMockNativeFileHandle({
        queryPermission: vi.fn().mockResolvedValue('granted'),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      const result = await provider.queryPermission(fileHandle, 'read')

      expect(result).toBe('granted')
      expect(mockNativeFileHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    })

    it('throws FileSystemError with code INVALID_STATE on invalid handle', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.queryPermission(invalidHandle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.queryPermission(invalidHandle, 'read')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })
  })

  describe('requestPermission()', () => {
    it('returns granted when permission is granted', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        requestPermission: vi.fn().mockResolvedValue('granted'),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.requestPermission(handle, 'read')

      expect(result).toBe('granted')
      expect(mockNativeHandle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
    })

    it('returns denied on NotAllowedError DOMException', async () => {
      const notAllowedError = new DOMException('User denied permission', 'NotAllowedError')
      const mockNativeHandle = createMockNativeDirectoryHandle({
        requestPermission: vi.fn().mockRejectedValue(notAllowedError),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.requestPermission(handle, 'read')

      expect(result).toBe('denied')
    })

    it('throws FileSystemError with code UNKNOWN on other errors', async () => {
      const otherError = new Error('Some other error')
      const mockNativeHandle = createMockNativeDirectoryHandle({
        requestPermission: vi.fn().mockRejectedValue(otherError),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()

      await expect(provider.requestPermission(handle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.requestPermission(handle, 'read')).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })

    it('works with directory handles', async () => {
      const mockNativeHandle = createMockNativeDirectoryHandle({
        requestPermission: vi.fn().mockResolvedValue('granted'),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeHandle)

      const handle = await provider.selectDirectory()
      const result = await provider.requestPermission(handle, 'readwrite')

      expect(result).toBe('granted')
      expect(mockNativeHandle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    })

    it('works with file handles', async () => {
      const mockNativeFileHandle = createMockNativeFileHandle({
        requestPermission: vi.fn().mockResolvedValue('granted'),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      const result = await provider.requestPermission(fileHandle, 'read')

      expect(result).toBe('granted')
      expect(mockNativeFileHandle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
    })

    it('throws FileSystemError with code INVALID_STATE on invalid handle', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.requestPermission(invalidHandle, 'read')).rejects.toThrow(FileSystemError)
      await expect(provider.requestPermission(invalidHandle, 'read')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })
  })

  describe('readFile()', () => {
    it('returns ArrayBuffer from file', async () => {
      const mockArrayBuffer = new ArrayBuffer(100)
      const mockFile = {
        arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
      }
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockResolvedValue(mockFile),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      const result = await provider.readFile(fileHandle)

      expect(result).toBe(mockArrayBuffer)
      expect(mockNativeFileHandle.getFile).toHaveBeenCalled()
      expect(mockFile.arrayBuffer).toHaveBeenCalled()
    })

    it('throws FileSystemError with code INVALID_STATE on invalid handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.readFile(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.readFile(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError with code UNKNOWN on read error', async () => {
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockRejectedValue(new Error('Read failed')),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      await expect(provider.readFile(fileHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.readFile(fileHandle)).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })
  })

  describe('readFileAsBlob()', () => {
    it('returns Blob from file', async () => {
      const mockBlob = new Blob(['test content'], { type: 'image/jpeg' })
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockResolvedValue(mockBlob),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      const result = await provider.readFileAsBlob(fileHandle)

      expect(result).toBe(mockBlob)
      expect(mockNativeFileHandle.getFile).toHaveBeenCalled()
    })

    it('throws FileSystemError on invalid handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.readFileAsBlob(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.readFileAsBlob(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError on read error', async () => {
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockRejectedValue(new Error('Read failed')),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      await expect(provider.readFileAsBlob(fileHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.readFileAsBlob(fileHandle)).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })
  })

  describe('getFileMetadata()', () => {
    it('returns correct metadata (name, size, type, lastModified)', async () => {
      const mockFile = {
        name: 'photo.jpg',
        size: 1024,
        type: 'image/jpeg',
        lastModified: 1700000000000,
      }
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockResolvedValue(mockFile),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      const metadata = await provider.getFileMetadata(fileHandle)

      expect(metadata).toEqual({
        name: 'photo.jpg',
        size: 1024,
        type: 'image/jpeg',
        lastModified: 1700000000000,
      })
    })

    it('handles undefined type gracefully', async () => {
      const mockFile = {
        name: 'unknown.file',
        size: 512,
        type: '',
        lastModified: 1700000000000,
      }
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockResolvedValue(mockFile),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      const metadata = await provider.getFileMetadata(fileHandle)

      expect(metadata.type).toBeUndefined()
    })

    it('throws FileSystemError on invalid handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.getFileMetadata(invalidHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.getFileMetadata(invalidHandle)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })

    it('throws FileSystemError on metadata error', async () => {
      const mockNativeFileHandle = createMockNativeFileHandle({
        getFile: vi.fn().mockRejectedValue(new Error('Metadata fetch failed')),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      await expect(provider.getFileMetadata(fileHandle)).rejects.toThrow(FileSystemError)
      await expect(provider.getFileMetadata(fileHandle)).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })
  })

  describe('writeFile()', () => {
    it('writes ArrayBuffer successfully', async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const mockNativeFileHandle = createMockNativeFileHandle({
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle
      const data = new ArrayBuffer(100)

      await provider.writeFile(fileHandle, data)

      expect(mockNativeFileHandle.createWritable).toHaveBeenCalled()
      expect(mockWritable.write).toHaveBeenCalledWith(data)
      expect(mockWritable.close).toHaveBeenCalled()
    })

    it('writes Blob successfully', async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const mockNativeFileHandle = createMockNativeFileHandle({
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle
      const data = new Blob(['test content'], { type: 'image/jpeg' })

      await provider.writeFile(fileHandle, data)

      expect(mockWritable.write).toHaveBeenCalledWith(data)
      expect(mockWritable.close).toHaveBeenCalled()
    })

    it('writes string successfully', async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const mockNativeFileHandle = createMockNativeFileHandle({
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle
      const data = 'Hello, World!'

      await provider.writeFile(fileHandle, data)

      expect(mockWritable.write).toHaveBeenCalledWith(data)
      expect(mockWritable.close).toHaveBeenCalled()
    })

    it('throws FileSystemError with code PERMISSION_DENIED on NotAllowedError', async () => {
      const notAllowedError = new DOMException('Permission denied', 'NotAllowedError')
      const mockNativeFileHandle = createMockNativeFileHandle({
        createWritable: vi.fn().mockRejectedValue(notAllowedError),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      await expect(provider.writeFile(fileHandle, new ArrayBuffer(10))).rejects.toThrow(FileSystemError)
      await expect(provider.writeFile(fileHandle, new ArrayBuffer(10))).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      })
    })

    it('throws FileSystemError with code UNKNOWN on other write errors', async () => {
      const mockNativeFileHandle = createMockNativeFileHandle({
        createWritable: vi.fn().mockRejectedValue(new Error('Write failed')),
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        values: createMockValuesIterator([mockNativeFileHandle]),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(dirHandle)
      const fileHandle = entries[0].handle as FileHandle

      await expect(provider.writeFile(fileHandle, new ArrayBuffer(10))).rejects.toThrow(FileSystemError)
      await expect(provider.writeFile(fileHandle, new ArrayBuffer(10))).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })

    it('throws FileSystemError with code INVALID_STATE on invalid handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.writeFile(invalidHandle, new ArrayBuffer(10))).rejects.toThrow(
        FileSystemError
      )
      await expect(provider.writeFile(invalidHandle, new ArrayBuffer(10))).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })
  })

  describe('createFile()', () => {
    it('creates file and returns wrapped handle', async () => {
      const newNativeFileHandle = createMockNativeFileHandle({
        name: 'new-file.txt',
      })
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        getFileHandle: vi.fn().mockResolvedValue(newNativeFileHandle),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()
      const result = await provider.createFile(dirHandle, 'new-file.txt')

      expect(result.name).toBe('new-file.txt')
      expect(result.kind).toBe('file')
      expect(mockNativeDirHandle.getFileHandle).toHaveBeenCalledWith('new-file.txt', { create: true })
    })

    it('throws FileSystemError on error', async () => {
      const mockNativeDirHandle = createMockNativeDirectoryHandle({
        getFileHandle: vi.fn().mockRejectedValue(new Error('Creation failed')),
      })
      mockShowDirectoryPicker.mockResolvedValue(mockNativeDirHandle)

      const dirHandle = await provider.selectDirectory()

      await expect(provider.createFile(dirHandle, 'new-file.txt')).rejects.toThrow(FileSystemError)
      await expect(provider.createFile(dirHandle, 'new-file.txt')).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })

    it('throws FileSystemError on invalid directory handle', async () => {
      const invalidDirHandle = { name: 'test-dir', kind: 'directory' as const }

      await expect(provider.createFile(invalidDirHandle, 'new-file.txt')).rejects.toThrow(
        FileSystemError
      )
      await expect(provider.createFile(invalidDirHandle, 'new-file.txt')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })
  })

  describe('createDirectory()', () => {
    it('creates directory and returns wrapped handle', async () => {
      const newNativeDirHandle = createMockNativeDirectoryHandle({
        name: 'new-folder',
      })
      const parentNativeDirHandle = createMockNativeDirectoryHandle({
        getDirectoryHandle: vi.fn().mockResolvedValue(newNativeDirHandle),
      })
      mockShowDirectoryPicker.mockResolvedValue(parentNativeDirHandle)

      const parentHandle = await provider.selectDirectory()
      const result = await provider.createDirectory(parentHandle, 'new-folder')

      expect(result.name).toBe('new-folder')
      expect(result.kind).toBe('directory')
      expect(parentNativeDirHandle.getDirectoryHandle).toHaveBeenCalledWith('new-folder', {
        create: true,
      })
    })

    it('throws FileSystemError on error', async () => {
      const parentNativeDirHandle = createMockNativeDirectoryHandle({
        getDirectoryHandle: vi.fn().mockRejectedValue(new Error('Creation failed')),
      })
      mockShowDirectoryPicker.mockResolvedValue(parentNativeDirHandle)

      const parentHandle = await provider.selectDirectory()

      await expect(provider.createDirectory(parentHandle, 'new-folder')).rejects.toThrow(
        FileSystemError
      )
      await expect(provider.createDirectory(parentHandle, 'new-folder')).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    })

    it('throws FileSystemError on invalid directory handle', async () => {
      const invalidDirHandle = { name: 'parent-dir', kind: 'directory' as const }

      await expect(provider.createDirectory(invalidDirHandle, 'new-folder')).rejects.toThrow(
        FileSystemError
      )
      await expect(provider.createDirectory(invalidDirHandle, 'new-folder')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      })
    })
  })
})

/**
 * Creates a comprehensive mock for IndexedDB
 * Simulates the async callback-based API of IndexedDB
 */
function createMockIndexedDB() {
  const stores = new Map<string, Map<string, any>>()
  let dbVersion = 1
  let isOpen = false

  const mockObjectStore = (storeName: string) => {
    if (!stores.has(storeName)) {
      stores.set(storeName, new Map())
    }
    const store = stores.get(storeName)!

    return {
      put: vi.fn((value: any, key: string) => {
        const request = {
          onsuccess: null as ((event: any) => void) | null,
          onerror: null as ((event: any) => void) | null,
          result: undefined as any,
          error: null as DOMException | null,
        }
        Promise.resolve().then(() => {
          store.set(key, value)
          request.result = key
          if (request.onsuccess) {
            request.onsuccess({ target: request })
          }
        })
        return request
      }),
      get: vi.fn((key: string) => {
        const request = {
          onsuccess: null as ((event: any) => void) | null,
          onerror: null as ((event: any) => void) | null,
          result: undefined as any,
          error: null as DOMException | null,
        }
        Promise.resolve().then(() => {
          request.result = store.get(key)
          if (request.onsuccess) {
            request.onsuccess({ target: request })
          }
        })
        return request
      }),
      delete: vi.fn((key: string) => {
        const request = {
          onsuccess: null as ((event: any) => void) | null,
          onerror: null as ((event: any) => void) | null,
          result: undefined as any,
          error: null as DOMException | null,
        }
        Promise.resolve().then(() => {
          store.delete(key)
          if (request.onsuccess) {
            request.onsuccess({ target: request })
          }
        })
        return request
      }),
      getAllKeys: vi.fn(() => {
        const request = {
          onsuccess: null as ((event: any) => void) | null,
          onerror: null as ((event: any) => void) | null,
          result: undefined as any,
          error: null as DOMException | null,
        }
        Promise.resolve().then(() => {
          request.result = Array.from(store.keys())
          if (request.onsuccess) {
            request.onsuccess({ target: request })
          }
        })
        return request
      }),
    }
  }

  const createMockTransaction = (storeNames: string | string[], _mode: string) => {
    const storeNameArray = Array.isArray(storeNames) ? storeNames : [storeNames]
    return {
      objectStore: vi.fn((name: string) => {
        if (!storeNameArray.includes(name)) {
          throw new DOMException('Store not found', 'NotFoundError')
        }
        return mockObjectStore(name)
      }),
      oncomplete: null as ((event: any) => void) | null,
      onerror: null as ((event: any) => void) | null,
      abort: vi.fn(),
    }
  }

  const createMockDB = () => {
    const objectStoreNames = {
      contains: vi.fn((name: string) => stores.has(name)),
      length: stores.size,
    }

    return {
      transaction: vi.fn(createMockTransaction),
      createObjectStore: vi.fn((name: string) => {
        stores.set(name, new Map())
        return mockObjectStore(name)
      }),
      objectStoreNames,
      close: vi.fn(() => {
        isOpen = false
      }),
      name: 'literoom-fs',
      version: dbVersion,
    }
  }

  const mockIndexedDB = {
    open: vi.fn((_name: string, version?: number) => {
      const request = {
        onsuccess: null as ((event: any) => void) | null,
        onerror: null as ((event: any) => void) | null,
        onupgradeneeded: null as ((event: any) => void) | null,
        result: null as any,
        error: null as DOMException | null,
      }

      Promise.resolve().then(() => {
        const db = createMockDB()
        const needsUpgrade = version && version > dbVersion

        if (needsUpgrade) {
          dbVersion = version
          // Trigger upgrade first
          if (request.onupgradeneeded) {
            request.onupgradeneeded({
              target: { result: db },
              oldVersion: dbVersion - 1,
              newVersion: version,
            })
          }
        }

        request.result = db
        isOpen = true

        if (request.onsuccess) {
          request.onsuccess({ target: request })
        }
      })

      return request
    }),
    deleteDatabase: vi.fn((_name: string) => {
      stores.clear()
      const request = {
        onsuccess: null as ((event: any) => void) | null,
        onerror: null as ((event: any) => void) | null,
        result: undefined,
        error: null as DOMException | null,
      }
      Promise.resolve().then(() => {
        if (request.onsuccess) {
          request.onsuccess({ target: request })
        }
      })
      return request
    }),
  }

  return {
    mockIndexedDB,
    stores,
    createMockObjectStore: mockObjectStore,
    isOpen: () => isOpen,
    reset: () => {
      stores.clear()
      dbVersion = 1
      isOpen = false
    },
  }
}

describe('BrowserFileSystemProvider - IndexedDB Handle Persistence', () => {
  let provider: BrowserFileSystemProvider
  let mockIDB: ReturnType<typeof createMockIndexedDB>
  let originalIndexedDB: IDBFactory
  let mockShowDirectoryPicker: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Save original indexedDB
    originalIndexedDB = globalThis.indexedDB

    // Create and install mock
    mockIDB = createMockIndexedDB()
    globalThis.indexedDB = mockIDB.mockIndexedDB as unknown as IDBFactory

    // Mock window.showDirectoryPicker
    mockShowDirectoryPicker = vi.fn()
    // @ts-expect-error - mocking browser API
    globalThis.window = {
      showDirectoryPicker: mockShowDirectoryPicker,
    }

    // Create fresh provider for each test
    provider = new BrowserFileSystemProvider()
  })

  afterEach(() => {
    // Restore original indexedDB
    globalThis.indexedDB = originalIndexedDB
    mockIDB.reset()
    vi.clearAllMocks()
  })

  describe('saveHandle()', () => {
    it('saves handle to IndexedDB', async () => {
      // Create a wrapped handle with the native handle
      const nativeHandle = createMockNativeDirectoryHandle({ name: 'Photos' })
      mockShowDirectoryPicker.mockResolvedValue(nativeHandle)

      const handle = await provider.selectDirectory()
      await provider.saveHandle('test-key', handle)

      // Verify the handle was stored
      expect(mockIDB.stores.get('handles')?.get('test-key')).toBe(nativeHandle)
    })

    it('throws FileSystemError on IndexedDB error', async () => {
      // Create a mock that simulates an IndexedDB error during put
      const errorMockIDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request = {
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            result: null as any,
            error: null as DOMException | null,
          }

          Promise.resolve().then(() => {
            const mockDB = {
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  put: vi.fn(() => {
                    const putRequest = {
                      onsuccess: null as ((event: any) => void) | null,
                      onerror: null as ((event: any) => void) | null,
                      result: undefined,
                      error: new DOMException('Write error', 'UnknownError'),
                    }
                    Promise.resolve().then(() => {
                      if (putRequest.onerror) {
                        putRequest.onerror({ target: putRequest })
                      }
                    })
                    return putRequest
                  }),
                })),
              })),
              objectStoreNames: { contains: () => true },
            }

            request.result = mockDB
            if (request.onsuccess) {
              request.onsuccess({ target: request })
            }
          })

          return request
        }),
      }

      globalThis.indexedDB = errorMockIDB as unknown as IDBFactory

      const newProvider = new BrowserFileSystemProvider()
      const nativeHandle = createMockNativeDirectoryHandle({ name: 'Photos' })
      mockShowDirectoryPicker.mockResolvedValue(nativeHandle)

      const handle = await newProvider.selectDirectory()

      await expect(newProvider.saveHandle('key', handle))
        .rejects.toThrow(FileSystemError)
    })
  })

  describe('loadHandle()', () => {
    it('returns saved handle', async () => {
      // Pre-populate the store with a mock handle
      const mockHandle = createMockNativeDirectoryHandle({ name: 'Saved Photos' })
      mockIDB.stores.set('handles', new Map([['saved-key', mockHandle]]))

      const result = await provider.loadHandle('saved-key')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Saved Photos')
      expect(result?.kind).toBe('directory')
    })

    it('returns null for unknown key', async () => {
      mockIDB.stores.set('handles', new Map())

      const result = await provider.loadHandle('nonexistent-key')

      expect(result).toBeNull()
    })

    it('throws FileSystemError on IndexedDB error', async () => {
      // Create a mock that succeeds on open but fails on get
      const errorOnGetMockIDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request = {
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            result: null as any,
            error: null as DOMException | null,
          }

          Promise.resolve().then(() => {
            const mockDB = {
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  get: vi.fn(() => {
                    const getRequest = {
                      onsuccess: null as ((event: any) => void) | null,
                      onerror: null as ((event: any) => void) | null,
                      result: undefined,
                      error: new DOMException('Read error', 'UnknownError'),
                    }
                    Promise.resolve().then(() => {
                      if (getRequest.onerror) {
                        getRequest.onerror({ target: getRequest })
                      }
                    })
                    return getRequest
                  }),
                })),
              })),
              objectStoreNames: { contains: () => true },
            }

            request.result = mockDB
            if (request.onsuccess) {
              request.onsuccess({ target: request })
            }
          })

          return request
        }),
      }

      globalThis.indexedDB = errorOnGetMockIDB as unknown as IDBFactory

      const newProvider = new BrowserFileSystemProvider()

      await expect(newProvider.loadHandle('any-key'))
        .rejects.toThrow(FileSystemError)
    })
  })

  describe('removeHandle()', () => {
    it('removes saved handle', async () => {
      // Pre-populate the store
      const mockHandle = createMockNativeDirectoryHandle({ name: 'To Remove' })
      mockIDB.stores.set('handles', new Map([['remove-key', mockHandle]]))

      await provider.removeHandle('remove-key')

      // Verify it's gone
      const result = await provider.loadHandle('remove-key')
      expect(result).toBeNull()
    })

    it('throws FileSystemError on IndexedDB error', async () => {
      const errorOnDeleteMockIDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request = {
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            result: null as any,
            error: null as DOMException | null,
          }

          Promise.resolve().then(() => {
            const mockDB = {
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  delete: vi.fn(() => {
                    const deleteRequest = {
                      onsuccess: null as ((event: any) => void) | null,
                      onerror: null as ((event: any) => void) | null,
                      result: undefined,
                      error: new DOMException('Delete error', 'UnknownError'),
                    }
                    Promise.resolve().then(() => {
                      if (deleteRequest.onerror) {
                        deleteRequest.onerror({ target: deleteRequest })
                      }
                    })
                    return deleteRequest
                  }),
                })),
              })),
              objectStoreNames: { contains: () => true },
            }

            request.result = mockDB
            if (request.onsuccess) {
              request.onsuccess({ target: request })
            }
          })

          return request
        }),
      }

      globalThis.indexedDB = errorOnDeleteMockIDB as unknown as IDBFactory

      const newProvider = new BrowserFileSystemProvider()

      await expect(newProvider.removeHandle('any-key'))
        .rejects.toThrow(FileSystemError)
    })
  })

  describe('listSavedHandles()', () => {
    it('returns all saved handle keys', async () => {
      // Pre-populate the store with multiple handles
      const mockHandle1 = createMockNativeDirectoryHandle({ name: 'Photos' })
      const mockHandle2 = createMockNativeDirectoryHandle({ name: 'Documents' })
      const mockHandle3 = createMockNativeDirectoryHandle({ name: 'Downloads' })

      mockIDB.stores.set('handles', new Map([
        ['photos-key', mockHandle1],
        ['docs-key', mockHandle2],
        ['downloads-key', mockHandle3],
      ]))

      const keys = await provider.listSavedHandles()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('photos-key')
      expect(keys).toContain('docs-key')
      expect(keys).toContain('downloads-key')
    })

    it('returns empty array when no handles saved', async () => {
      // Ensure the store exists but is empty
      mockIDB.stores.set('handles', new Map())

      const keys = await provider.listSavedHandles()

      expect(keys).toEqual([])
    })

    it('throws FileSystemError on IndexedDB error', async () => {
      const errorOnGetAllKeysMockIDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request = {
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            result: null as any,
            error: null as DOMException | null,
          }

          Promise.resolve().then(() => {
            const mockDB = {
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  getAllKeys: vi.fn(() => {
                    const getAllKeysRequest = {
                      onsuccess: null as ((event: any) => void) | null,
                      onerror: null as ((event: any) => void) | null,
                      result: undefined,
                      error: new DOMException('GetAllKeys error', 'UnknownError'),
                    }
                    Promise.resolve().then(() => {
                      if (getAllKeysRequest.onerror) {
                        getAllKeysRequest.onerror({ target: getAllKeysRequest })
                      }
                    })
                    return getAllKeysRequest
                  }),
                })),
              })),
              objectStoreNames: { contains: () => true },
            }

            request.result = mockDB
            if (request.onsuccess) {
              request.onsuccess({ target: request })
            }
          })

          return request
        }),
      }

      globalThis.indexedDB = errorOnGetAllKeysMockIDB as unknown as IDBFactory

      const newProvider = new BrowserFileSystemProvider()

      await expect(newProvider.listSavedHandles())
        .rejects.toThrow(FileSystemError)
    })
  })

  describe('getDB() internal method (tested via public methods)', () => {
    it('opens IndexedDB successfully', async () => {
      mockIDB.stores.set('handles', new Map())

      // Trigger DB open via listSavedHandles
      await provider.listSavedHandles()

      // Verify open was called with correct parameters
      expect(mockIDB.mockIndexedDB.open).toHaveBeenCalledWith('literoom-fs', 1)
    })

    it('creates object store on upgrade', async () => {
      // Track whether createObjectStore was called
      let createObjectStoreCalled = false
      let storeCreatedName = ''

      const upgradeMockIDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request = {
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            result: null as any,
            error: null as DOMException | null,
          }

          Promise.resolve().then(() => {
            const mockDB = {
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  getAllKeys: vi.fn(() => {
                    const req = {
                      onsuccess: null as ((event: any) => void) | null,
                      onerror: null as ((event: any) => void) | null,
                      result: [],
                      error: null,
                    }
                    Promise.resolve().then(() => {
                      if (req.onsuccess) req.onsuccess({ target: req })
                    })
                    return req
                  }),
                })),
              })),
              objectStoreNames: {
                contains: vi.fn((name: string) => {
                  // Return false to simulate store doesn't exist yet
                  return name !== 'handles'
                }),
              },
              createObjectStore: vi.fn((name: string) => {
                createObjectStoreCalled = true
                storeCreatedName = name
                return {}
              }),
            }

            // Trigger onupgradeneeded first
            if (request.onupgradeneeded) {
              request.onupgradeneeded({
                target: { result: mockDB },
                oldVersion: 0,
                newVersion: 1,
              })
            }

            request.result = mockDB
            if (request.onsuccess) {
              request.onsuccess({ target: request })
            }
          })

          return request
        }),
      }

      globalThis.indexedDB = upgradeMockIDB as unknown as IDBFactory

      const newProvider = new BrowserFileSystemProvider()
      await newProvider.listSavedHandles()

      expect(createObjectStoreCalled).toBe(true)
      expect(storeCreatedName).toBe('handles')
    })

    it('throws FileSystemError on open error', async () => {
      const failOpenMockIDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request = {
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            result: null as any,
            error: new DOMException('Failed to open database', 'UnknownError'),
          }

          Promise.resolve().then(() => {
            if (request.onerror) {
              request.onerror({ target: request })
            }
          })

          return request
        }),
      }

      globalThis.indexedDB = failOpenMockIDB as unknown as IDBFactory

      const newProvider = new BrowserFileSystemProvider()

      await expect(newProvider.listSavedHandles())
        .rejects.toThrow(FileSystemError)
    })

    it('reuses existing connection', async () => {
      mockIDB.stores.set('handles', new Map())

      // Call multiple methods that use getDB
      await provider.listSavedHandles()
      await provider.loadHandle('key1')
      await provider.listSavedHandles()

      // open should only be called once
      expect(mockIDB.mockIndexedDB.open).toHaveBeenCalledTimes(1)
    })
  })

  describe('integration scenarios', () => {
    it('save then load returns the same handle', async () => {
      mockIDB.stores.set('handles', new Map())

      // Create and save a handle
      const nativeHandle = createMockNativeDirectoryHandle({ name: 'Integration Test' })
      mockShowDirectoryPicker.mockResolvedValue(nativeHandle)

      const handle = await provider.selectDirectory()
      await provider.saveHandle('integration-key', handle)

      // Load it back
      const loaded = await provider.loadHandle('integration-key')

      expect(loaded).not.toBeNull()
      expect(loaded?.name).toBe('Integration Test')
      expect(loaded?.kind).toBe('directory')
    })

    it('save, remove, then load returns null', async () => {
      mockIDB.stores.set('handles', new Map())

      // Save a handle
      const nativeHandle = createMockNativeDirectoryHandle({ name: 'To Be Removed' })
      mockShowDirectoryPicker.mockResolvedValue(nativeHandle)

      const handle = await provider.selectDirectory()
      await provider.saveHandle('remove-test-key', handle)

      // Verify it exists
      const before = await provider.loadHandle('remove-test-key')
      expect(before).not.toBeNull()

      // Remove it
      await provider.removeHandle('remove-test-key')

      // Verify it's gone
      const after = await provider.loadHandle('remove-test-key')
      expect(after).toBeNull()
    })

    it('multiple handles can be saved and listed', async () => {
      mockIDB.stores.set('handles', new Map())

      // Save multiple handles
      const handleConfigs = [
        { key: 'photos', name: 'Photos' },
        { key: 'documents', name: 'Documents' },
        { key: 'music', name: 'Music' },
      ]

      for (const config of handleConfigs) {
        const nativeHandle = createMockNativeDirectoryHandle({ name: config.name })
        mockShowDirectoryPicker.mockResolvedValue(nativeHandle)
        const handle = await provider.selectDirectory()
        await provider.saveHandle(config.key, handle)
      }

      // List all keys
      const keys = await provider.listSavedHandles()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('photos')
      expect(keys).toContain('documents')
      expect(keys).toContain('music')

      // Load each and verify
      for (const config of handleConfigs) {
        const loaded = await provider.loadHandle(config.key)
        expect(loaded?.name).toBe(config.name)
      }
    })
  })
})
