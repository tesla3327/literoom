/**
 * Unit tests for ThumbnailQueueItemWithEditState extended type.
 *
 * These tests cover the extended queue item interface that includes:
 * - editState: Edit parameters for regenerated thumbnails
 * - generation: Generation number for stale result detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThumbnailQueue, type ThumbnailQueueItemWithEditState } from './thumbnail-queue'
import { ThumbnailPriority } from './types'
import type { EditedThumbnailEditState } from '../decode/worker-messages'

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockItemWithEditState(
  assetId: string,
  priority: ThumbnailPriority = ThumbnailPriority.BACKGROUND,
  editState?: EditedThumbnailEditState,
  generation?: number
): ThumbnailQueueItemWithEditState {
  return {
    assetId,
    priority,
    getBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    editState,
    generation,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ThumbnailQueueItemWithEditState', () => {
  let queue: ThumbnailQueue

  beforeEach(() => {
    queue = new ThumbnailQueue()
  })

  describe('editState property', () => {
    it('should accept items with editState', () => {
      const editState: EditedThumbnailEditState = {
        adjustments: {
          exposure: 1,
          contrast: 10,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          saturation: 0,
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      expect(queue.size).toBe(1)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState).toBeDefined()
      expect(dequeued.editState?.adjustments?.exposure).toBe(1)
    })

    it('should accept items with rotation edit state', () => {
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 45, straighten: 0 },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.rotation?.angle).toBe(45)
    })

    it('should accept items with crop edit state', () => {
      const editState: EditedThumbnailEditState = {
        crop: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.crop?.left).toBe(0.1)
    })

    it('should accept items with tone curve edit state', () => {
      const editState: EditedThumbnailEditState = {
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.toneCurve?.points).toHaveLength(3)
    })

    it('should accept items with masks edit state', () => {
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: true,
              adjustments: { exposure: 1 },
            },
          ],
          radialMasks: [],
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.masks?.linearMasks).toHaveLength(1)
    })
  })

  describe('generation property', () => {
    it('should accept items with generation number', () => {
      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, undefined, 5)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.generation).toBe(5)
    })

    it('should preserve generation through queue operations', () => {
      const item1 = createMockItemWithEditState('asset1', ThumbnailPriority.BACKGROUND, undefined, 1)
      const item2 = createMockItemWithEditState('asset2', ThumbnailPriority.VISIBLE, undefined, 2)

      queue.enqueue(item1)
      queue.enqueue(item2)

      // Higher priority first
      const first = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(first.assetId).toBe('asset2')
      expect(first.generation).toBe(2)

      const second = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(second.assetId).toBe('asset1')
      expect(second.generation).toBe(1)
    })
  })

  describe('combined editState and generation', () => {
    it('should accept items with both editState and generation', () => {
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 45, straighten: 0 },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState, 3)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.rotation?.angle).toBe(45)
      expect(dequeued.generation).toBe(3)
    })

    it('should preserve both properties through priority ordering', async () => {
      const editState1: EditedThumbnailEditState = {
        adjustments: {
          exposure: 1,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          saturation: 0,
        },
      }
      const editState2: EditedThumbnailEditState = {
        adjustments: {
          exposure: 2,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          saturation: 0,
        },
      }

      // Add low priority first
      queue.enqueue(createMockItemWithEditState('low', ThumbnailPriority.BACKGROUND, editState1, 1))
      await new Promise((r) => setTimeout(r, 5))
      // Add high priority second
      queue.enqueue(createMockItemWithEditState('high', ThumbnailPriority.VISIBLE, editState2, 2))

      // High priority should come first
      const first = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(first.assetId).toBe('high')
      expect(first.editState?.adjustments?.exposure).toBe(2)
      expect(first.generation).toBe(2)

      const second = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(second.assetId).toBe('low')
      expect(second.editState?.adjustments?.exposure).toBe(1)
      expect(second.generation).toBe(1)
    })
  })

  describe('backward compatibility', () => {
    it('should work with items without editState (backward compatible)', () => {
      // Standard item without editState
      const item: ThumbnailQueueItemWithEditState = {
        assetId: 'asset1',
        priority: ThumbnailPriority.VISIBLE,
        getBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      }

      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState).toBeUndefined()
      expect(dequeued.generation).toBeUndefined()
    })

    it('should handle mixed items with and without editState', () => {
      // Item without editState
      queue.enqueue({
        assetId: 'plain',
        priority: ThumbnailPriority.BACKGROUND,
        getBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      })

      // Item with editState
      queue.enqueue(
        createMockItemWithEditState(
          'edited',
          ThumbnailPriority.VISIBLE,
          { adjustments: { exposure: 1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0 } },
          1
        )
      )

      expect(queue.size).toBe(2)

      const first = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(first.assetId).toBe('edited')
      expect(first.editState).toBeDefined()

      const second = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(second.assetId).toBe('plain')
      expect(second.editState).toBeUndefined()
    })
  })

  describe('full edit state', () => {
    it('should handle full edit state with all parameters', () => {
      const fullEditState: EditedThumbnailEditState = {
        adjustments: {
          exposure: 0.5,
          contrast: 20,
          highlights: -10,
          shadows: 10,
          whites: 5,
          blacks: -5,
          temperature: 10,
          tint: 5,
          vibrance: 15,
          saturation: 10,
        },
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        },
        crop: {
          left: 0.1,
          top: 0.1,
          width: 0.8,
          height: 0.8,
        },
        rotation: {
          angle: 15,
          straighten: 2,
        },
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: true,
              adjustments: { exposure: -0.5 },
            },
          ],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: false,
              enabled: true,
              adjustments: { contrast: 15 },
            },
          ],
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, fullEditState, 10)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState

      // Verify all properties are preserved
      expect(dequeued.editState?.adjustments?.exposure).toBe(0.5)
      expect(dequeued.editState?.toneCurve?.points).toHaveLength(3)
      expect(dequeued.editState?.crop?.left).toBe(0.1)
      expect(dequeued.editState?.rotation?.angle).toBe(15)
      expect(dequeued.editState?.masks?.linearMasks).toHaveLength(1)
      expect(dequeued.editState?.masks?.radialMasks).toHaveLength(1)
      expect(dequeued.generation).toBe(10)
    })

    it('should handle null crop value', () => {
      const editState: EditedThumbnailEditState = {
        crop: null,
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.crop).toBeNull()
    })

    it('should handle empty masks arrays', () => {
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [],
          radialMasks: [],
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.masks?.linearMasks).toHaveLength(0)
      expect(dequeued.editState?.masks?.radialMasks).toHaveLength(0)
    })
  })
})
