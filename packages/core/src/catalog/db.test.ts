/**
 * Unit tests for the catalog database module (db.ts).
 *
 * Uses fake-indexeddb for testing Dexie operations in Node.js.
 */

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  db,
  clearDatabase,
  getAssetCountsByFlag,
  getAssetsByFlag,
  updateAssetFlags,
  assetExistsByPath,
  getFolderByPath,
  saveEditStateToDb,
  loadEditStateFromDb,
  loadAllEditStatesFromDb,
  deleteEditStateFromDb,
  deleteEditStatesFromDb,
  type AssetRecord,
  type FolderRecord,
  type EditStateRecord,
} from './db'

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(async () => {
  // Clear all tables before each test to ensure isolation
  await db.assets.clear()
  await db.folders.clear()
  await db.edits.clear()
  await db.cacheMetadata.clear()
  await db.editStates.clear()
})

afterEach(async () => {
  // Clean up after each test
  await db.assets.clear()
  await db.folders.clear()
  await db.edits.clear()
  await db.cacheMetadata.clear()
  await db.editStates.clear()
})


// ============================================================================
// Edit State Persistence Tests
// ============================================================================

/**
 * Sample edit state structure for testing.
 */
const sampleEditState = {
  version: 4,
  adjustments: {
    exposure: 1.5,
    contrast: 20,
    temperature: 0,
    tint: 0,
    highlights: -10,
    shadows: 15,
    whites: 5,
    blacks: -5,
    vibrance: 25,
    saturation: 10,
    toneCurve: {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  },
  cropTransform: {
    crop: null,
    rotation: { angle: 0, straighten: 0 },
  },
}

/**
 * Sample edit state with modified crop/rotation for testing.
 */
const sampleEditStateWithCrop = {
  version: 4,
  adjustments: {
    exposure: 0.5,
    contrast: 10,
    temperature: 15,
    tint: -5,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    saturation: 0,
    toneCurve: {
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
    },
  },
  cropTransform: {
    crop: { left: 0.1, top: 0.2, width: 0.7, height: 0.6 },
    rotation: { angle: 90, straighten: 2.5 },
  },
}

describe('saveEditStateToDb', () => {
  describe('insert (new record)', () => {
    it('should save a new edit state', async () => {
      const assetUuid = 'test-asset-uuid-1'
      const schemaVersion = 4

      await saveEditStateToDb(assetUuid, sampleEditState, schemaVersion)

      const record = await db.editStates.get(assetUuid)
      expect(record).toBeDefined()
      expect(record?.assetUuid).toBe(assetUuid)
      expect(record?.schemaVersion).toBe(schemaVersion)
      expect(record?.updatedAt).toBeInstanceOf(Date)
    })

    it('should serialize edit state as JSON', async () => {
      const assetUuid = 'test-asset-uuid-2'

      await saveEditStateToDb(assetUuid, sampleEditState, 4)

      const record = await db.editStates.get(assetUuid)
      expect(typeof record?.editState).toBe('string')
      const parsed = JSON.parse(record!.editState)
      expect(parsed.version).toBe(sampleEditState.version)
      expect(parsed.adjustments.exposure).toBe(sampleEditState.adjustments.exposure)
      expect(parsed.adjustments.contrast).toBe(sampleEditState.adjustments.contrast)
    })

    it('should save edit state with crop transform', async () => {
      const assetUuid = 'test-asset-uuid-3'

      await saveEditStateToDb(assetUuid, sampleEditStateWithCrop, 4)

      const record = await db.editStates.get(assetUuid)
      const parsed = JSON.parse(record!.editState)
      expect(parsed.cropTransform.crop).toEqual({ left: 0.1, top: 0.2, width: 0.7, height: 0.6 })
      expect(parsed.cropTransform.rotation.angle).toBe(90)
      expect(parsed.cropTransform.rotation.straighten).toBe(2.5)
    })

    it('should save multiple edit states for different assets', async () => {
      await saveEditStateToDb('asset-1', sampleEditState, 4)
      await saveEditStateToDb('asset-2', sampleEditStateWithCrop, 4)

      const count = await db.editStates.count()
      expect(count).toBe(2)

      const record1 = await db.editStates.get('asset-1')
      const record2 = await db.editStates.get('asset-2')
      expect(record1).toBeDefined()
      expect(record2).toBeDefined()
    })
  })

  describe('upsert (update existing record)', () => {
    it('should update an existing edit state', async () => {
      const assetUuid = 'test-asset-uuid-4'

      // Save initial state
      await saveEditStateToDb(assetUuid, sampleEditState, 4)
      const initialRecord = await db.editStates.get(assetUuid)
      const initialUpdatedAt = initialRecord!.updatedAt

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update with new state
      const updatedState = {
        ...sampleEditState,
        adjustments: { ...sampleEditState.adjustments, exposure: 2.5 },
      }
      await saveEditStateToDb(assetUuid, updatedState, 4)

      const updatedRecord = await db.editStates.get(assetUuid)
      const parsed = JSON.parse(updatedRecord!.editState)
      expect(parsed.adjustments.exposure).toBe(2.5)
      expect(updatedRecord!.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime())
    })

    it('should only have one record after upsert', async () => {
      const assetUuid = 'test-asset-uuid-5'

      await saveEditStateToDb(assetUuid, sampleEditState, 4)
      await saveEditStateToDb(assetUuid, sampleEditStateWithCrop, 4)

      const count = await db.editStates.count()
      const records = await db.editStates.where('assetUuid').equals(assetUuid).toArray()
      expect(count).toBe(1)
      expect(records.length).toBe(1)
    })

    it('should update schema version on upsert', async () => {
      const assetUuid = 'test-asset-uuid-6'

      await saveEditStateToDb(assetUuid, sampleEditState, 3)
      const initialRecord = await db.editStates.get(assetUuid)
      expect(initialRecord?.schemaVersion).toBe(3)

      await saveEditStateToDb(assetUuid, sampleEditState, 4)
      const updatedRecord = await db.editStates.get(assetUuid)
      expect(updatedRecord?.schemaVersion).toBe(4)
    })
  })

  describe('data integrity', () => {
    it('should preserve all adjustment values', async () => {
      const assetUuid = 'test-asset-uuid-7'
      const editState = {
        version: 4,
        adjustments: {
          exposure: -2.5,
          contrast: -100,
          temperature: 50,
          tint: -30,
          highlights: 100,
          shadows: -100,
          whites: 75,
          blacks: -75,
          vibrance: 50,
          saturation: -50,
          toneCurve: {
            points: [
              { x: 0, y: 0.1 },
              { x: 0.25, y: 0.3 },
              { x: 0.75, y: 0.7 },
              { x: 1, y: 0.9 },
            ],
          },
        },
        cropTransform: {
          crop: null,
          rotation: { angle: 0, straighten: 0 },
        },
      }

      await saveEditStateToDb(assetUuid, editState, 4)

      const record = await db.editStates.get(assetUuid)
      const parsed = JSON.parse(record!.editState)
      expect(parsed.adjustments.exposure).toBe(-2.5)
      expect(parsed.adjustments.contrast).toBe(-100)
      expect(parsed.adjustments.temperature).toBe(50)
      expect(parsed.adjustments.tint).toBe(-30)
      expect(parsed.adjustments.highlights).toBe(100)
      expect(parsed.adjustments.shadows).toBe(-100)
      expect(parsed.adjustments.whites).toBe(75)
      expect(parsed.adjustments.blacks).toBe(-75)
      expect(parsed.adjustments.vibrance).toBe(50)
      expect(parsed.adjustments.saturation).toBe(-50)
      expect(parsed.adjustments.toneCurve.points).toHaveLength(4)
    })

    it('should handle empty edit state', async () => {
      const assetUuid = 'test-asset-uuid-8'
      const emptyState = {}

      await saveEditStateToDb(assetUuid, emptyState, 4)

      const record = await db.editStates.get(assetUuid)
      const parsed = JSON.parse(record!.editState)
      expect(parsed).toEqual({})
    })
  })
})

describe('loadEditStateFromDb', () => {
  describe('success cases', () => {
    it('should load an existing edit state', async () => {
      const assetUuid = 'load-test-uuid-1'
      await saveEditStateToDb(assetUuid, sampleEditState, 4)

      const result = await loadEditStateFromDb(assetUuid)

      expect(result).not.toBeNull()
      expect(result?.editState).toEqual(sampleEditState)
      expect(result?.schemaVersion).toBe(4)
      expect(result?.updatedAt).toBeInstanceOf(Date)
    })

    it('should return parsed JSON as editState', async () => {
      const assetUuid = 'load-test-uuid-2'
      await saveEditStateToDb(assetUuid, sampleEditStateWithCrop, 4)

      const result = await loadEditStateFromDb(assetUuid)

      expect(result?.editState).toEqual(sampleEditStateWithCrop)
      expect((result?.editState as typeof sampleEditStateWithCrop).cropTransform.rotation.angle).toBe(90)
    })

    it('should return correct schema version', async () => {
      const assetUuid = 'load-test-uuid-3'
      await saveEditStateToDb(assetUuid, sampleEditState, 3)

      const result = await loadEditStateFromDb(assetUuid)

      expect(result?.schemaVersion).toBe(3)
    })
  })

  describe('not found cases', () => {
    it('should return null for non-existent asset', async () => {
      const result = await loadEditStateFromDb('non-existent-uuid')

      expect(result).toBeNull()
    })

    it('should return null for empty database', async () => {
      const result = await loadEditStateFromDb('any-uuid')

      expect(result).toBeNull()
    })
  })

  describe('JSON parse error handling', () => {
    it('should return null for corrupted JSON data', async () => {
      // Manually insert a record with invalid JSON
      await db.editStates.put({
        assetUuid: 'corrupted-json-uuid',
        schemaVersion: 4,
        updatedAt: new Date(),
        editState: 'this is not valid JSON {{{',
      })

      const result = await loadEditStateFromDb('corrupted-json-uuid')

      expect(result).toBeNull()
    })

    it('should return null for truncated JSON data', async () => {
      await db.editStates.put({
        assetUuid: 'truncated-json-uuid',
        schemaVersion: 4,
        updatedAt: new Date(),
        editState: '{"version": 4, "adjustments": {',
      })

      const result = await loadEditStateFromDb('truncated-json-uuid')

      expect(result).toBeNull()
    })
  })
})

describe('loadAllEditStatesFromDb', () => {
  describe('success cases', () => {
    it('should load all edit states', async () => {
      await saveEditStateToDb('all-test-uuid-1', sampleEditState, 4)
      await saveEditStateToDb('all-test-uuid-2', sampleEditStateWithCrop, 4)

      const result = await loadAllEditStatesFromDb()

      expect(result.size).toBe(2)
      expect(result.has('all-test-uuid-1')).toBe(true)
      expect(result.has('all-test-uuid-2')).toBe(true)
    })

    it('should return correct edit state for each asset', async () => {
      await saveEditStateToDb('all-test-uuid-3', sampleEditState, 4)
      await saveEditStateToDb('all-test-uuid-4', sampleEditStateWithCrop, 4)

      const result = await loadAllEditStatesFromDb()

      const state1 = result.get('all-test-uuid-3') as typeof sampleEditState
      const state2 = result.get('all-test-uuid-4') as typeof sampleEditStateWithCrop

      expect(state1.adjustments.exposure).toBe(1.5)
      expect(state2.adjustments.exposure).toBe(0.5)
      expect(state2.cropTransform.rotation.angle).toBe(90)
    })

    it('should return Map instance', async () => {
      const result = await loadAllEditStatesFromDb()

      expect(result).toBeInstanceOf(Map)
    })
  })

  describe('empty database', () => {
    it('should return empty Map for empty database', async () => {
      const result = await loadAllEditStatesFromDb()

      expect(result.size).toBe(0)
      expect(result).toBeInstanceOf(Map)
    })
  })

  describe('JSON parse error handling', () => {
    it('should skip records with corrupted JSON', async () => {
      // Save valid edit states
      await saveEditStateToDb('valid-uuid-1', sampleEditState, 4)
      await saveEditStateToDb('valid-uuid-2', sampleEditStateWithCrop, 4)

      // Manually insert corrupted record
      await db.editStates.put({
        assetUuid: 'corrupted-uuid',
        schemaVersion: 4,
        updatedAt: new Date(),
        editState: 'invalid json content',
      })

      const result = await loadAllEditStatesFromDb()

      // Should only include valid records
      expect(result.size).toBe(2)
      expect(result.has('valid-uuid-1')).toBe(true)
      expect(result.has('valid-uuid-2')).toBe(true)
      expect(result.has('corrupted-uuid')).toBe(false)
    })

    it('should continue loading after encountering corrupted record', async () => {
      // Insert corrupted record first
      await db.editStates.put({
        assetUuid: 'aaa-corrupted',
        schemaVersion: 4,
        updatedAt: new Date(),
        editState: '{{invalid',
      })

      // Then valid records
      await saveEditStateToDb('bbb-valid', sampleEditState, 4)
      await saveEditStateToDb('ccc-valid', sampleEditStateWithCrop, 4)

      const result = await loadAllEditStatesFromDb()

      expect(result.size).toBe(2)
      expect(result.has('bbb-valid')).toBe(true)
      expect(result.has('ccc-valid')).toBe(true)
    })
  })
})

describe('deleteEditStateFromDb', () => {
  describe('success cases', () => {
    it('should delete an existing edit state', async () => {
      const assetUuid = 'delete-test-uuid-1'
      await saveEditStateToDb(assetUuid, sampleEditState, 4)

      // Verify it exists
      const beforeDelete = await db.editStates.get(assetUuid)
      expect(beforeDelete).toBeDefined()

      await deleteEditStateFromDb(assetUuid)

      const afterDelete = await db.editStates.get(assetUuid)
      expect(afterDelete).toBeUndefined()
    })

    it('should only delete the specified edit state', async () => {
      await saveEditStateToDb('delete-test-uuid-2', sampleEditState, 4)
      await saveEditStateToDb('delete-test-uuid-3', sampleEditStateWithCrop, 4)

      await deleteEditStateFromDb('delete-test-uuid-2')

      const count = await db.editStates.count()
      expect(count).toBe(1)

      const remaining = await db.editStates.get('delete-test-uuid-3')
      expect(remaining).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('should not throw when deleting non-existent edit state', async () => {
      await expect(deleteEditStateFromDb('non-existent-uuid')).resolves.not.toThrow()
    })

    it('should not throw when deleting from empty database', async () => {
      await expect(deleteEditStateFromDb('any-uuid')).resolves.not.toThrow()
    })

    it('should be idempotent (multiple deletes do nothing)', async () => {
      const assetUuid = 'delete-test-uuid-4'
      await saveEditStateToDb(assetUuid, sampleEditState, 4)

      await deleteEditStateFromDb(assetUuid)
      await deleteEditStateFromDb(assetUuid)
      await deleteEditStateFromDb(assetUuid)

      const result = await db.editStates.get(assetUuid)
      expect(result).toBeUndefined()
    })
  })
})

describe('deleteEditStatesFromDb', () => {
  describe('success cases', () => {
    it('should delete multiple edit states', async () => {
      await saveEditStateToDb('bulk-delete-uuid-1', sampleEditState, 4)
      await saveEditStateToDb('bulk-delete-uuid-2', sampleEditStateWithCrop, 4)
      await saveEditStateToDb('bulk-delete-uuid-3', sampleEditState, 4)

      await deleteEditStatesFromDb(['bulk-delete-uuid-1', 'bulk-delete-uuid-2'])

      const count = await db.editStates.count()
      expect(count).toBe(1)

      const remaining = await db.editStates.get('bulk-delete-uuid-3')
      expect(remaining).toBeDefined()
    })

    it('should delete all specified edit states', async () => {
      await saveEditStateToDb('bulk-delete-uuid-4', sampleEditState, 4)
      await saveEditStateToDb('bulk-delete-uuid-5', sampleEditStateWithCrop, 4)

      await deleteEditStatesFromDb(['bulk-delete-uuid-4', 'bulk-delete-uuid-5'])

      const count = await db.editStates.count()
      expect(count).toBe(0)
    })

    it('should handle single item array', async () => {
      await saveEditStateToDb('bulk-delete-uuid-6', sampleEditState, 4)

      await deleteEditStatesFromDb(['bulk-delete-uuid-6'])

      const result = await db.editStates.get('bulk-delete-uuid-6')
      expect(result).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle empty array', async () => {
      await saveEditStateToDb('bulk-delete-uuid-7', sampleEditState, 4)

      await deleteEditStatesFromDb([])

      const count = await db.editStates.count()
      expect(count).toBe(1)
    })

    it('should not throw when some UUIDs do not exist', async () => {
      await saveEditStateToDb('bulk-delete-uuid-8', sampleEditState, 4)

      await expect(
        deleteEditStatesFromDb(['bulk-delete-uuid-8', 'non-existent-1', 'non-existent-2'])
      ).resolves.not.toThrow()

      const count = await db.editStates.count()
      expect(count).toBe(0)
    })

    it('should not throw when all UUIDs do not exist', async () => {
      await expect(
        deleteEditStatesFromDb(['non-existent-1', 'non-existent-2', 'non-existent-3'])
      ).resolves.not.toThrow()
    })

    it('should handle large batch delete', async () => {
      // Create 50 edit states
      const uuids: string[] = []
      for (let i = 0; i < 50; i++) {
        const uuid = `bulk-delete-large-${i}`
        uuids.push(uuid)
        await saveEditStateToDb(uuid, sampleEditState, 4)
      }

      // Delete all 50
      await deleteEditStatesFromDb(uuids)

      const count = await db.editStates.count()
      expect(count).toBe(0)
    })
  })

  describe('data integrity', () => {
    it('should only delete specified UUIDs', async () => {
      const toKeep = ['keep-1', 'keep-2', 'keep-3']
      const toDelete = ['delete-1', 'delete-2', 'delete-3']

      for (const uuid of [...toKeep, ...toDelete]) {
        await saveEditStateToDb(uuid, sampleEditState, 4)
      }

      await deleteEditStatesFromDb(toDelete)

      const count = await db.editStates.count()
      expect(count).toBe(3)

      for (const uuid of toKeep) {
        const record = await db.editStates.get(uuid)
        expect(record).toBeDefined()
      }

      for (const uuid of toDelete) {
        const record = await db.editStates.get(uuid)
        expect(record).toBeUndefined()
      }
    })
  })
})

// ============================================================================
// Asset Utility Functions Tests
// ============================================================================

// ============================================================================
// Test Helpers for Asset Functions
// ============================================================================

/**
 * Create a sample folder record for testing.
 */
function createSampleFolder(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path: '/photos/2024',
    name: '2024',
    handleKey: 'handle-key-1',
    lastScanDate: new Date('2024-01-15'),
    ...overrides,
  }
}

/**
 * Create a sample asset record for testing.
 */
function createSampleAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    uuid: 'test-uuid-1',
    folderId: 1,
    path: 'photo1.jpg',
    filename: 'photo1',
    extension: 'jpg',
    flag: 'none',
    captureDate: new Date('2024-01-15'),
    modifiedDate: new Date('2024-01-15'),
    fileSize: 1024000,
    ...overrides,
  }
}

/**
 * Helper to create a folder and return its id.
 */
async function insertFolder(folder: FolderRecord): Promise<number> {
  return db.folders.add(folder)
}

/**
 * Helper to create an asset and return its id.
 */
async function insertAsset(asset: AssetRecord): Promise<number> {
  return db.assets.add(asset)
}

// ============================================================================
// clearDatabase Tests
// ============================================================================

describe('clearDatabase', () => {
  it('should clear all tables when they have data', async () => {
    // Insert data into all tables
    const folderId = await insertFolder(createSampleFolder())
    const assetId = await insertAsset(createSampleAsset({ folderId }))

    await db.edits.add({
      assetId,
      schemaVersion: 1,
      updatedAt: new Date(),
      settings: '{}',
    })

    await db.cacheMetadata.add({
      assetId,
      thumbnailReady: true,
      preview1xReady: false,
      preview2xReady: false,
    })

    // Verify data was inserted
    expect(await db.assets.count()).toBe(1)
    expect(await db.folders.count()).toBe(1)
    expect(await db.edits.count()).toBe(1)
    expect(await db.cacheMetadata.count()).toBe(1)

    // Clear the database
    await clearDatabase()

    // Verify all tables are empty
    expect(await db.assets.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)
    expect(await db.edits.count()).toBe(0)
    expect(await db.cacheMetadata.count()).toBe(0)
  })

  it('should handle clearing empty tables without error', async () => {
    // Tables are already empty from beforeEach
    expect(await db.assets.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)

    // Should not throw
    await clearDatabase()

    expect(await db.assets.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)
  })

  it('should clear tables within a transaction (all or nothing)', async () => {
    // Insert multiple records
    const folderId = await insertFolder(createSampleFolder())
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId }))

    expect(await db.assets.count()).toBe(3)
    expect(await db.folders.count()).toBe(1)

    await clearDatabase()

    // All should be cleared atomically
    expect(await db.assets.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)
  })
})

// ============================================================================
// getAssetCountsByFlag Tests
// ============================================================================

describe('getAssetCountsByFlag', () => {
  it('should return all zeros for empty database', async () => {
    const counts = await getAssetCountsByFlag()

    expect(counts).toEqual({
      all: 0,
      picks: 0,
      rejects: 0,
      unflagged: 0,
    })
  })

  it('should count assets by flag status correctly', async () => {
    const folderId = await insertFolder(createSampleFolder())

    // Insert assets with different flags
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'none' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'pick' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-4', folderId, flag: 'pick' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-5', folderId, flag: 'pick' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-6', folderId, flag: 'reject' }))

    const counts = await getAssetCountsByFlag()

    expect(counts.all).toBe(6)
    expect(counts.picks).toBe(3)
    expect(counts.rejects).toBe(1)
    expect(counts.unflagged).toBe(2)
  })

  it('should calculate unflagged as all minus picks minus rejects', async () => {
    const folderId = await insertFolder(createSampleFolder())

    // All unflagged
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'none' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'none' }))

    const counts = await getAssetCountsByFlag()

    expect(counts.all).toBe(3)
    expect(counts.picks).toBe(0)
    expect(counts.rejects).toBe(0)
    expect(counts.unflagged).toBe(3)
  })

  it('should handle all assets being picks', async () => {
    const folderId = await insertFolder(createSampleFolder())

    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'pick' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'pick' }))

    const counts = await getAssetCountsByFlag()

    expect(counts.all).toBe(2)
    expect(counts.picks).toBe(2)
    expect(counts.rejects).toBe(0)
    expect(counts.unflagged).toBe(0)
  })

  it('should handle all assets being rejects', async () => {
    const folderId = await insertFolder(createSampleFolder())

    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'reject' }))
    await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'reject' }))

    const counts = await getAssetCountsByFlag()

    expect(counts.all).toBe(2)
    expect(counts.picks).toBe(0)
    expect(counts.rejects).toBe(2)
    expect(counts.unflagged).toBe(0)
  })
})

// ============================================================================
// getAssetsByFlag Tests
// ============================================================================

describe('getAssetsByFlag', () => {
  let folderId: number

  beforeEach(async () => {
    folderId = await insertFolder(createSampleFolder())
  })

  describe('flag filtering', () => {
    it('should return all assets when flag is "all"', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'pick' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'reject' }))

      const assets = await getAssetsByFlag('all')

      expect(assets.length).toBe(3)
    })

    it('should return only picked assets when flag is "pick"', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'pick' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'pick' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-4', folderId, flag: 'reject' }))

      const assets = await getAssetsByFlag('pick')

      expect(assets.length).toBe(2)
      expect(assets.every((a) => a.flag === 'pick')).toBe(true)
    })

    it('should return only rejected assets when flag is "reject"', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'pick' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'reject' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-4', folderId, flag: 'reject' }))

      const assets = await getAssetsByFlag('reject')

      expect(assets.length).toBe(2)
      expect(assets.every((a) => a.flag === 'reject')).toBe(true)
    })

    it('should return only unflagged assets when flag is "none"', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'none' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'pick' }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-4', folderId, flag: 'reject' }))

      const assets = await getAssetsByFlag('none')

      expect(assets.length).toBe(2)
      expect(assets.every((a) => a.flag === 'none')).toBe(true)
    })

    it('should return empty array when no assets match the filter', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))

      const assets = await getAssetsByFlag('pick')

      expect(assets).toEqual([])
    })
  })

  describe('sorting by captureDate', () => {
    it('should sort by captureDate in descending order by default', async () => {
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-oldest',
          folderId,
          captureDate: new Date('2024-01-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-middle',
          folderId,
          captureDate: new Date('2024-06-15'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-newest',
          folderId,
          captureDate: new Date('2024-12-31'),
        })
      )

      const assets = await getAssetsByFlag('all')

      expect(assets[0].uuid).toBe('uuid-newest')
      expect(assets[1].uuid).toBe('uuid-middle')
      expect(assets[2].uuid).toBe('uuid-oldest')
    })

    it('should sort by captureDate in ascending order when descending is false', async () => {
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-oldest',
          folderId,
          captureDate: new Date('2024-01-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-middle',
          folderId,
          captureDate: new Date('2024-06-15'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-newest',
          folderId,
          captureDate: new Date('2024-12-31'),
        })
      )

      const assets = await getAssetsByFlag('all', { descending: false })

      expect(assets[0].uuid).toBe('uuid-oldest')
      expect(assets[1].uuid).toBe('uuid-middle')
      expect(assets[2].uuid).toBe('uuid-newest')
    })

    it('should maintain sort order with filtered results', async () => {
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-1',
          folderId,
          flag: 'pick',
          captureDate: new Date('2024-01-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-2',
          folderId,
          flag: 'none',
          captureDate: new Date('2024-06-15'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-3',
          folderId,
          flag: 'pick',
          captureDate: new Date('2024-12-31'),
        })
      )

      const assets = await getAssetsByFlag('pick')

      expect(assets.length).toBe(2)
      expect(assets[0].uuid).toBe('uuid-3') // newest pick first
      expect(assets[1].uuid).toBe('uuid-1') // older pick second
    })
  })

  describe('limit option', () => {
    it('should limit the number of returned assets', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-4', folderId }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-5', folderId }))

      const assets = await getAssetsByFlag('all', { limit: 3 })

      expect(assets.length).toBe(3)
    })

    it('should return all assets when limit exceeds total count', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId }))

      const assets = await getAssetsByFlag('all', { limit: 100 })

      expect(assets.length).toBe(2)
    })

    it('should return empty array when limit is 0', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId }))

      const assets = await getAssetsByFlag('all', { limit: 0 })

      expect(assets).toEqual([])
    })
  })

  describe('offset option', () => {
    it('should skip assets based on offset', async () => {
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-1',
          folderId,
          captureDate: new Date('2024-01-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-2',
          folderId,
          captureDate: new Date('2024-02-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-3',
          folderId,
          captureDate: new Date('2024-03-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-4',
          folderId,
          captureDate: new Date('2024-04-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-5',
          folderId,
          captureDate: new Date('2024-05-01'),
        })
      )

      // Descending order: 5, 4, 3, 2, 1 -> offset 2 skips 5 and 4
      const assets = await getAssetsByFlag('all', { offset: 2 })

      expect(assets.length).toBe(3)
      expect(assets[0].uuid).toBe('uuid-3')
      expect(assets[1].uuid).toBe('uuid-2')
      expect(assets[2].uuid).toBe('uuid-1')
    })

    it('should return empty array when offset exceeds total count', async () => {
      await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId }))
      await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId }))

      const assets = await getAssetsByFlag('all', { offset: 10 })

      expect(assets).toEqual([])
    })

    it('should default to offset 0', async () => {
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-1',
          folderId,
          captureDate: new Date('2024-01-01'),
        })
      )
      await insertAsset(
        createSampleAsset({
          uuid: 'uuid-2',
          folderId,
          captureDate: new Date('2024-12-01'),
        })
      )

      const assets = await getAssetsByFlag('all')

      expect(assets.length).toBe(2)
      expect(assets[0].uuid).toBe('uuid-2') // newest first
    })
  })

  describe('combined options (limit, offset, descending)', () => {
    it('should support pagination with limit and offset', async () => {
      // Insert 10 assets with sequential dates
      for (let i = 1; i <= 10; i++) {
        await insertAsset(
          createSampleAsset({
            uuid: `uuid-${i}`,
            folderId,
            captureDate: new Date(`2024-${String(i).padStart(2, '0')}-01`),
          })
        )
      }

      // Descending order: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
      // Page 1: limit 3, offset 0 -> 10, 9, 8
      const page1 = await getAssetsByFlag('all', { limit: 3, offset: 0 })
      expect(page1.length).toBe(3)
      expect(page1[0].uuid).toBe('uuid-10')
      expect(page1[1].uuid).toBe('uuid-9')
      expect(page1[2].uuid).toBe('uuid-8')

      // Page 2: limit 3, offset 3 -> 7, 6, 5
      const page2 = await getAssetsByFlag('all', { limit: 3, offset: 3 })
      expect(page2.length).toBe(3)
      expect(page2[0].uuid).toBe('uuid-7')
      expect(page2[1].uuid).toBe('uuid-6')
      expect(page2[2].uuid).toBe('uuid-5')

      // Page 4: limit 3, offset 9 -> 1 (only one left)
      const page4 = await getAssetsByFlag('all', { limit: 3, offset: 9 })
      expect(page4.length).toBe(1)
      expect(page4[0].uuid).toBe('uuid-1')
    })

    it('should work with all options combined', async () => {
      for (let i = 1; i <= 6; i++) {
        await insertAsset(
          createSampleAsset({
            uuid: `uuid-${i}`,
            folderId,
            flag: i <= 3 ? 'pick' : 'none',
            captureDate: new Date(`2024-${String(i).padStart(2, '0')}-01`),
          })
        )
      }

      // Get picks (1, 2, 3), ascending order, skip first, limit 2
      // Ascending: 1, 2, 3 -> offset 1: 2, 3 -> limit 2: 2, 3
      const assets = await getAssetsByFlag('pick', {
        limit: 2,
        offset: 1,
        descending: false,
      })

      expect(assets.length).toBe(2)
      expect(assets[0].uuid).toBe('uuid-2')
      expect(assets[1].uuid).toBe('uuid-3')
    })
  })
})

// ============================================================================
// updateAssetFlags Tests
// ============================================================================

describe('updateAssetFlags', () => {
  let folderId: number

  beforeEach(async () => {
    folderId = await insertFolder(createSampleFolder())
  })

  it('should update flag for a single asset', async () => {
    const assetId = await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))

    await updateAssetFlags([assetId], 'pick')

    const updated = await db.assets.get(assetId)
    expect(updated?.flag).toBe('pick')
  })

  it('should update flags for multiple assets', async () => {
    const id1 = await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
    const id2 = await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'pick' }))
    const id3 = await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'reject' }))

    await updateAssetFlags([id1, id2, id3], 'pick')

    const asset1 = await db.assets.get(id1)
    const asset2 = await db.assets.get(id2)
    const asset3 = await db.assets.get(id3)

    expect(asset1?.flag).toBe('pick')
    expect(asset2?.flag).toBe('pick')
    expect(asset3?.flag).toBe('pick')
  })

  it('should set flag to none (unflag)', async () => {
    const assetId = await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'pick' }))

    await updateAssetFlags([assetId], 'none')

    const updated = await db.assets.get(assetId)
    expect(updated?.flag).toBe('none')
  })

  it('should set flag to reject', async () => {
    const assetId = await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))

    await updateAssetFlags([assetId], 'reject')

    const updated = await db.assets.get(assetId)
    expect(updated?.flag).toBe('reject')
  })

  it('should handle empty array without error', async () => {
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))

    // Should not throw
    await updateAssetFlags([], 'pick')

    // Verify no assets were changed
    const asset = await db.assets.where('uuid').equals('uuid-1').first()
    expect(asset?.flag).toBe('none')
  })

  it('should only update specified assets, not others', async () => {
    const id1 = await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))
    const id2 = await insertAsset(createSampleAsset({ uuid: 'uuid-2', folderId, flag: 'none' }))
    const id3 = await insertAsset(createSampleAsset({ uuid: 'uuid-3', folderId, flag: 'none' }))

    // Only update id1 and id3
    await updateAssetFlags([id1, id3], 'pick')

    const asset1 = await db.assets.get(id1)
    const asset2 = await db.assets.get(id2)
    const asset3 = await db.assets.get(id3)

    expect(asset1?.flag).toBe('pick')
    expect(asset2?.flag).toBe('none') // Unchanged
    expect(asset3?.flag).toBe('pick')
  })

  it('should handle non-existent asset IDs gracefully', async () => {
    const realId = await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, flag: 'none' }))

    // Mix of real and non-existent IDs
    await updateAssetFlags([realId, 99999, 99998], 'pick')

    const asset = await db.assets.get(realId)
    expect(asset?.flag).toBe('pick')
  })
})

// ============================================================================
// assetExistsByPath Tests
// ============================================================================

describe('assetExistsByPath', () => {
  let folderId: number

  beforeEach(async () => {
    folderId = await insertFolder(createSampleFolder())
  })

  it('should return true when asset exists at the given path in the folder', async () => {
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, path: 'subfolder/photo.jpg' }))

    const exists = await assetExistsByPath(folderId, 'subfolder/photo.jpg')

    expect(exists).toBe(true)
  })

  it('should return false when asset does not exist at the given path', async () => {
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, path: 'photo.jpg' }))

    const exists = await assetExistsByPath(folderId, 'other-photo.jpg')

    expect(exists).toBe(false)
  })

  it('should return false for non-existent folder', async () => {
    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId, path: 'photo.jpg' }))

    const exists = await assetExistsByPath(99999, 'photo.jpg')

    expect(exists).toBe(false)
  })

  it('should return false for empty database', async () => {
    const exists = await assetExistsByPath(1, 'photo.jpg')

    expect(exists).toBe(false)
  })

  it('should distinguish between different folders with same path', async () => {
    const folder1Id = folderId
    const folder2Id = await insertFolder(
      createSampleFolder({ path: '/photos/2023', handleKey: 'handle-key-2' })
    )

    await insertAsset(createSampleAsset({ uuid: 'uuid-1', folderId: folder1Id, path: 'photo.jpg' }))

    // Same path, different folder
    expect(await assetExistsByPath(folder1Id, 'photo.jpg')).toBe(true)
    expect(await assetExistsByPath(folder2Id, 'photo.jpg')).toBe(false)
  })

  it('should handle paths with special characters', async () => {
    await insertAsset(
      createSampleAsset({
        uuid: 'uuid-1',
        folderId,
        path: 'vacation photos/beach (2024)/sunset.jpg',
      })
    )

    const exists = await assetExistsByPath(folderId, 'vacation photos/beach (2024)/sunset.jpg')

    expect(exists).toBe(true)
  })
})

// ============================================================================
// getFolderByPath Tests
// ============================================================================

describe('getFolderByPath', () => {
  it('should return the folder when it exists', async () => {
    const folder = createSampleFolder({ path: '/my/folder/path' })
    await insertFolder(folder)

    const result = await getFolderByPath('/my/folder/path')

    expect(result).toBeDefined()
    expect(result?.path).toBe('/my/folder/path')
    expect(result?.name).toBe('2024')
    expect(result?.handleKey).toBe('handle-key-1')
    expect(result?.id).toBeDefined()
  })

  it('should return undefined when folder does not exist', async () => {
    const result = await getFolderByPath('/non/existent/path')

    expect(result).toBeUndefined()
  })

  it('should return undefined for empty database', async () => {
    const result = await getFolderByPath('/any/path')

    expect(result).toBeUndefined()
  })

  it('should return the correct folder when multiple folders exist', async () => {
    await insertFolder(createSampleFolder({ path: '/photos/2023', handleKey: 'hk-1' }))
    await insertFolder(createSampleFolder({ path: '/photos/2024', handleKey: 'hk-2' }))
    await insertFolder(createSampleFolder({ path: '/photos/2025', handleKey: 'hk-3' }))

    const result = await getFolderByPath('/photos/2024')

    expect(result).toBeDefined()
    expect(result?.path).toBe('/photos/2024')
    expect(result?.handleKey).toBe('hk-2')
  })

  it('should match paths exactly (case-sensitive)', async () => {
    await insertFolder(createSampleFolder({ path: '/Photos/2024' }))

    const exactMatch = await getFolderByPath('/Photos/2024')
    const lowerCase = await getFolderByPath('/photos/2024')

    expect(exactMatch).toBeDefined()
    expect(lowerCase).toBeUndefined()
  })

  it('should include all folder properties in the result', async () => {
    const scanDate = new Date('2024-06-15T10:30:00Z')
    await insertFolder(
      createSampleFolder({
        path: '/complete/folder',
        name: 'MyFolder',
        handleKey: 'my-handle-key',
        lastScanDate: scanDate,
      })
    )

    const result = await getFolderByPath('/complete/folder')

    expect(result).toBeDefined()
    expect(result?.id).toBeTypeOf('number')
    expect(result?.path).toBe('/complete/folder')
    expect(result?.name).toBe('MyFolder')
    expect(result?.handleKey).toBe('my-handle-key')
    expect(result?.lastScanDate).toEqual(scanDate)
  })
})
