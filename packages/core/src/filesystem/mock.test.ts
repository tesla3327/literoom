import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  MockFileSystemProvider,
  createMockFileHandle,
  createMockDirectoryHandle,
  type MockDirectoryHandle,
  type MockFileHandle,
} from './mock'
import { FileSystemError } from './types'

describe('MockFileSystemProvider', () => {
  let provider: MockFileSystemProvider

  beforeEach(() => {
    provider = new MockFileSystemProvider()
  })

  describe('constructor', () => {
    it('creates provider with default options', () => {
      expect(provider.name).toBe('mock')
      expect(provider.supportsPersistence).toBe(false)
    })

    it('generates default demo files', () => {
      const files = provider.getDemoFiles()

      expect(files.length).toBe(50)
    })

    it('respects custom demoFileCount', () => {
      provider = new MockFileSystemProvider({ demoFileCount: 10 })
      const files = provider.getDemoFiles()

      expect(files.length).toBe(10)
    })
  })

  describe('selectDirectory', () => {
    it('returns a mock directory handle', async () => {
      const handle = await provider.selectDirectory()

      expect(handle.name).toBe('Demo Photos')
      expect(handle.kind).toBe('directory')
      expect((handle as MockDirectoryHandle)._mockId).toBe('demo-root')
    })

    it('throws error when configured to fail', async () => {
      provider = new MockFileSystemProvider({ failSelect: true })

      await expect(provider.selectDirectory()).rejects.toThrow(FileSystemError)
    })

    it('simulates delay when configured', async () => {
      provider = new MockFileSystemProvider({ operationDelay: 50 })
      const start = Date.now()

      await provider.selectDirectory()
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45)
    })
  })

  describe('listDirectory', () => {
    it('returns demo files for root directory', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      expect(entries.length).toBe(50)
      expect(entries.every(e => e.kind === 'file')).toBe(true)
    })

    it('includes subdirectory when configured', async () => {
      provider = new MockFileSystemProvider({ includeSubdirs: true })
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      const subdirs = entries.filter(e => e.kind === 'directory')
      expect(subdirs.length).toBe(1)
      expect(subdirs[0].name).toBe('Subfolder')
    })

    it('throws error for invalid handle', async () => {
      const invalidHandle = { name: 'test', kind: 'directory' as const }

      await expect(provider.listDirectory(invalidHandle)).rejects.toThrow(
        FileSystemError
      )
    })

    it('returns file entries with handles', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      for (const entry of entries) {
        expect(entry.handle).toBeDefined()
        expect(entry.handle.name).toBe(entry.name)
      }
    })

    it('generates mix of jpg and arw files', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)

      const jpgFiles = entries.filter(e => e.name.endsWith('.jpg'))
      const arwFiles = entries.filter(e => e.name.endsWith('.arw'))

      expect(jpgFiles.length).toBeGreaterThan(0)
      expect(arwFiles.length).toBeGreaterThan(0)
    })
  })

  describe('readFile', () => {
    it('returns placeholder JPEG data', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const fileHandle = entries[0].handle as MockFileHandle

      const data = await provider.readFile(fileHandle)

      expect(data).toBeInstanceOf(ArrayBuffer)
      expect(data.byteLength).toBeGreaterThan(0)
    })

    it('returns valid JPEG magic bytes', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const fileHandle = entries[0].handle as MockFileHandle

      const data = await provider.readFile(fileHandle)
      const bytes = new Uint8Array(data)

      // JPEG magic bytes: FF D8
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xd8)
    })

    it('throws error when configured to fail', async () => {
      provider = new MockFileSystemProvider({ failRead: true })
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const fileHandle = entries[0].handle as MockFileHandle

      await expect(provider.readFile(fileHandle)).rejects.toThrow(FileSystemError)
    })

    it('throws error for invalid handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.readFile(invalidHandle)).rejects.toThrow(FileSystemError)
    })
  })

  describe('readFileAsBlob', () => {
    it('returns Blob with correct MIME type for JPEG', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const jpgEntry = entries.find(e => e.name.endsWith('.jpg'))
      const fileHandle = jpgEntry!.handle as MockFileHandle

      const blob = await provider.readFileAsBlob(fileHandle)

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('image/jpeg')
    })

    it('returns Blob with correct MIME type for ARW', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const arwEntry = entries.find(e => e.name.endsWith('.arw'))
      const fileHandle = arwEntry!.handle as MockFileHandle

      const blob = await provider.readFileAsBlob(fileHandle)

      expect(blob.type).toBe('image/x-sony-arw')
    })
  })

  describe('getFileMetadata', () => {
    it('returns file metadata', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const fileHandle = entries[0].handle as MockFileHandle

      const metadata = await provider.getFileMetadata(fileHandle)

      expect(metadata.name).toBe(fileHandle.name)
      expect(metadata.size).toBeGreaterThan(0)
      expect(metadata.lastModified).toBeDefined()
    })

    it('returns correct MIME type for JPEG', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const jpgEntry = entries.find(e => e.name.endsWith('.jpg'))
      const fileHandle = jpgEntry!.handle as MockFileHandle

      const metadata = await provider.getFileMetadata(fileHandle)

      expect(metadata.type).toBe('image/jpeg')
    })

    it('throws error for invalid handle', async () => {
      const invalidHandle = { name: 'test.jpg', kind: 'file' as const }

      await expect(provider.getFileMetadata(invalidHandle)).rejects.toThrow(
        FileSystemError
      )
    })
  })

  describe('writeFile', () => {
    it('completes without error (no-op)', async () => {
      const rootHandle = await provider.selectDirectory()
      const entries = await provider.listDirectory(rootHandle)
      const fileHandle = entries[0].handle as MockFileHandle

      await provider.writeFile(fileHandle, new ArrayBuffer(10))
      // Should not throw
    })
  })

  describe('createFile', () => {
    it('returns a mock file handle', async () => {
      const rootHandle = await provider.selectDirectory()

      const fileHandle = await provider.createFile(rootHandle, 'new-file.txt')

      expect(fileHandle.name).toBe('new-file.txt')
      expect(fileHandle.kind).toBe('file')
      expect((fileHandle as MockFileHandle)._mockId).toContain('mock-created')
    })
  })

  describe('createDirectory', () => {
    it('returns a mock directory handle', async () => {
      const rootHandle = await provider.selectDirectory()

      const dirHandle = await provider.createDirectory(rootHandle, 'new-folder')

      expect(dirHandle.name).toBe('new-folder')
      expect(dirHandle.kind).toBe('directory')
    })
  })

  describe('queryPermission', () => {
    it('returns configured permission state', async () => {
      const rootHandle = await provider.selectDirectory()

      const permission = await provider.queryPermission(rootHandle, 'read')

      expect(permission).toBe('granted')
    })

    it('respects custom permission state', async () => {
      provider = new MockFileSystemProvider({ permissionState: 'denied' })
      const rootHandle = await provider.selectDirectory()

      const permission = await provider.queryPermission(rootHandle, 'read')

      expect(permission).toBe('denied')
    })
  })

  describe('requestPermission', () => {
    it('returns configured permission state', async () => {
      const rootHandle = await provider.selectDirectory()

      const permission = await provider.requestPermission(rootHandle, 'read')

      expect(permission).toBe('granted')
    })
  })

  describe('handle persistence', () => {
    describe('saveHandle', () => {
      it('saves handle for later retrieval', async () => {
        const handle = await provider.selectDirectory()

        await provider.saveHandle('test-key', handle)

        const loaded = await provider.loadHandle('test-key')
        expect(loaded).toBeDefined()
        expect(loaded?.name).toBe('Demo Photos')
      })
    })

    describe('loadHandle', () => {
      it('returns null for unknown key', async () => {
        const handle = await provider.loadHandle('unknown-key')

        expect(handle).toBeNull()
      })
    })

    describe('removeHandle', () => {
      it('removes saved handle', async () => {
        const handle = await provider.selectDirectory()
        await provider.saveHandle('test-key', handle)

        await provider.removeHandle('test-key')

        const loaded = await provider.loadHandle('test-key')
        expect(loaded).toBeNull()
      })
    })

    describe('listSavedHandles', () => {
      it('returns empty array initially', async () => {
        const keys = await provider.listSavedHandles()

        expect(keys).toEqual([])
      })

      it('returns all saved handle keys', async () => {
        const handle = await provider.selectDirectory()
        await provider.saveHandle('key1', handle)
        await provider.saveHandle('key2', handle)

        const keys = await provider.listSavedHandles()

        expect(keys).toContain('key1')
        expect(keys).toContain('key2')
      })
    })
  })

  describe('mock-specific methods', () => {
    describe('getDemoFiles', () => {
      it('returns copy of demo files', () => {
        const files = provider.getDemoFiles()

        // Modifying returned array shouldn't affect internal state
        files.pop()
        expect(provider.getDemoFiles().length).toBe(50)
      })
    })

    describe('setDemoFiles', () => {
      it('replaces demo files', async () => {
        const customFiles = [
          createMockFileHandle('custom.jpg', { size: 1000 }),
        ]

        provider.setDemoFiles(customFiles)

        expect(provider.getDemoFiles().length).toBe(1)

        const rootHandle = await provider.selectDirectory()
        const entries = await provider.listDirectory(rootHandle)
        expect(entries.length).toBe(1)
        expect(entries[0].name).toBe('custom.jpg')
      })
    })

    describe('resetDemoFiles', () => {
      it('restores original demo files', async () => {
        provider.setDemoFiles([createMockFileHandle('test.jpg')])
        expect(provider.getDemoFiles().length).toBe(1)

        provider.resetDemoFiles()

        expect(provider.getDemoFiles().length).toBe(50)
      })
    })
  })
})

describe('createMockFileHandle', () => {
  it('creates handle with specified name', () => {
    const handle = createMockFileHandle('test-image.jpg')

    expect(handle.name).toBe('test-image.jpg')
    expect(handle.kind).toBe('file')
    expect(handle._extension).toBe('jpg')
  })

  it('detects extension from filename', () => {
    const jpgHandle = createMockFileHandle('photo.jpg')
    const arwHandle = createMockFileHandle('raw.arw')
    const noExtHandle = createMockFileHandle('noext')

    expect(jpgHandle._extension).toBe('jpg')
    expect(arwHandle._extension).toBe('arw')
    expect(noExtHandle._extension).toBe('')
  })

  it('respects custom size option', () => {
    const handle = createMockFileHandle('test.jpg', { size: 5000000 })

    expect(handle._size).toBe(5000000)
  })

  it('respects custom lastModified option', () => {
    const timestamp = Date.now() - 86400000 // 1 day ago
    const handle = createMockFileHandle('test.jpg', { lastModified: timestamp })

    expect(handle._lastModified).toBe(timestamp)
  })

  it('uses default size when not specified', () => {
    const handle = createMockFileHandle('test.jpg')

    expect(handle._size).toBe(1000000) // Default 1MB
  })
})

describe('createMockDirectoryHandle', () => {
  it('creates handle with specified name', () => {
    const handle = createMockDirectoryHandle('My Photos')

    expect(handle.name).toBe('My Photos')
    expect(handle.kind).toBe('directory')
  })

  it('uses default path when not specified', () => {
    const handle = createMockDirectoryHandle('Photos')

    expect(handle._mockPath).toBe('/Photos')
  })

  it('respects custom path option', () => {
    const handle = createMockDirectoryHandle('Photos', '/custom/path')

    expect(handle._mockPath).toBe('/custom/path')
  })

  it('generates unique mock ID', () => {
    const handle1 = createMockDirectoryHandle('Test')
    const handle2 = createMockDirectoryHandle('Test')

    expect(handle1._mockId).not.toBe(handle2._mockId)
  })
})
