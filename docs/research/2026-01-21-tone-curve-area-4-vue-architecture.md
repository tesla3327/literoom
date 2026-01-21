# Phase 11: Tone Curve - Area 4: Vue/Composable Architecture

**Date**: 2026-01-21
**Status**: Complete
**Research Area**: Vue/Composable architecture for tone curve editing

---

## Executive Summary

This document provides architecture recommendations for implementing tone curve editing in the literoom photo editing application. After reviewing the existing edit store, composables (`useEditPreview`, `useHistogramDisplay`), and component patterns, I recommend a layered architecture that:

1. Stores curve control points in the existing `Adjustments` interface (extended)
2. Uses a dedicated `useToneCurve` composable for Canvas interaction and curve math
3. Coordinates with existing preview pipeline via debounced store updates
4. Leverages schema versioning for undo/reset functionality

---

## 1. Curve State Storage in Edit Store

### Current Architecture Analysis

The existing `edit.ts` store manages:
- `adjustments: ref<Adjustments>` - Reactive adjustment values
- `isDirty: ref<boolean>` - Change tracking
- `setAdjustment()` / `setAdjustments()` - Granular updates
- `reset()` - Return to defaults

The `Adjustments` interface in `packages/core/src/catalog/types.ts` uses numeric values for all current adjustments. The `EditState` interface includes a version number for schema migrations.

### Recommendation: Extend Adjustments with ToneCurve Field

**Option A: Embed curve in Adjustments (Recommended)**

```typescript
// packages/core/src/catalog/types.ts

/**
 * A control point on the tone curve.
 * Coordinates are normalized to [0, 1] range.
 */
export interface ToneCurvePoint {
  /** Input value (x-axis): 0 = shadows, 1 = highlights */
  x: number
  /** Output value (y-axis): 0 = black, 1 = white */
  y: number
}

/**
 * Tone curve definition with control points.
 * The curve always passes through (0,0) and (1,1) implicitly,
 * but these anchor points can be moved by the user.
 */
export interface ToneCurve {
  /** Control points, sorted by x coordinate */
  points: ToneCurvePoint[]
}

/**
 * Default tone curve (linear, no adjustment).
 * Two anchor points at the corners represent identity mapping.
 */
export const DEFAULT_TONE_CURVE: Readonly<ToneCurve> = Object.freeze({
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
})

/**
 * Extended Adjustments interface with tone curve.
 */
export interface Adjustments {
  // ... existing numeric adjustments ...
  temperature: number
  tint: number
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number

  /** Tone curve control points */
  toneCurve: ToneCurve
}

export const DEFAULT_ADJUSTMENTS: Readonly<Adjustments> = Object.freeze({
  // ... existing defaults ...
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  toneCurve: DEFAULT_TONE_CURVE,
})
```

**Rationale:**
- Follows existing pattern where all edits live in `Adjustments`
- Automatic integration with `isDirty`, `hasModifications`, `reset()`
- Clean serialization (JSON-compatible nested object)
- Easy to compare against defaults for detecting modifications
- Minimal store changes required

**Schema Version Bump:**
When adding `toneCurve` to `Adjustments`, increment `EDIT_SCHEMA_VERSION` to 2 and add migration logic:

```typescript
export const EDIT_SCHEMA_VERSION = 2

/**
 * Migrate edit state from older schema versions.
 */
export function migrateEditState(state: EditState): EditState {
  if (state.version === 1) {
    // Version 1 -> 2: Add default tone curve
    return {
      version: 2,
      adjustments: {
        ...state.adjustments,
        toneCurve: DEFAULT_TONE_CURVE,
      },
    }
  }
  return state
}
```

### Store Updates

The existing `setAdjustment` function handles single-key updates. For tone curve, we need a specialized method:

```typescript
// apps/web/app/stores/edit.ts

/**
 * Update the tone curve control points.
 */
function setToneCurve(curve: ToneCurve): void {
  adjustments.value = {
    ...adjustments.value,
    toneCurve: { points: [...curve.points] },
  }
  isDirty.value = true
  error.value = null
}

/**
 * Add a control point to the tone curve.
 */
function addCurvePoint(point: ToneCurvePoint): void {
  const newPoints = [...adjustments.value.toneCurve.points, point]
    .sort((a, b) => a.x - b.x)
  setToneCurve({ points: newPoints })
}

/**
 * Update a specific control point.
 */
function updateCurvePoint(index: number, point: ToneCurvePoint): void {
  const newPoints = [...adjustments.value.toneCurve.points]
  newPoints[index] = point
  // Re-sort in case x coordinate changed
  newPoints.sort((a, b) => a.x - b.x)
  setToneCurve({ points: newPoints })
}

/**
 * Remove a control point by index.
 * Cannot remove anchor points (first and last).
 */
function removeCurvePoint(index: number): void {
  const points = adjustments.value.toneCurve.points
  // Protect anchor points
  if (index === 0 || index === points.length - 1) {
    return
  }
  const newPoints = points.filter((_, i) => i !== index)
  setToneCurve({ points: newPoints })
}

/**
 * Reset only the tone curve to default.
 */
function resetToneCurve(): void {
  setToneCurve(DEFAULT_TONE_CURVE)
}
```

---

## 2. Composable Pattern for Interactive Curve Editing

### Existing Composable Analysis

**useEditPreview pattern:**
- Accepts `assetId: Ref<string>` parameter
- Manages internal state with `ref()`
- Uses `computed()` for derived values
- Watches store changes with `watch()`
- Implements debouncing for expensive operations
- Cleans up with `onUnmounted()`
- Returns reactive refs and methods

**useHistogramDisplay pattern:**
- Provides `canvasRef: Ref<HTMLCanvasElement | null>` for template binding
- Renders to Canvas via helper functions
- Debounces computation (500ms) to prioritize preview
- Watches for data changes and re-renders

### Recommended: useToneCurve Composable

```typescript
// apps/web/app/composables/useToneCurve.ts

/**
 * useToneCurve Composable
 *
 * Manages tone curve interaction and rendering:
 * - Canvas rendering with curve visualization
 * - Control point drag interactions
 * - Point add/delete operations
 * - Coordinate conversions (normalized <-> canvas)
 * - Debounced store updates during drag
 */
import type { Ref } from 'vue'
import type { ToneCurve, ToneCurvePoint } from '@literoom/core/catalog'

// ============================================================================
// Types
// ============================================================================

export interface UseToneCurveOptions {
  /** Canvas width (default: 256) */
  width?: number
  /** Canvas height (default: 256) */
  height?: number
  /** Debounce delay for store updates during drag (default: 16ms for 60fps) */
  debounceMs?: number
  /** Histogram data to display as background (optional) */
  histogram?: Ref<HistogramData | null>
}

export interface UseToneCurveReturn {
  /** Ref to bind to the canvas element */
  canvasRef: Ref<HTMLCanvasElement | null>

  /** Current local curve state (may differ from store during drag) */
  localCurve: Ref<ToneCurve>

  /** Index of currently dragged point, or null */
  draggedPointIndex: Ref<number | null>

  /** Index of hovered point, or null */
  hoveredPointIndex: Ref<number | null>

  /** Whether the curve is being actively dragged */
  isDragging: Ref<boolean>

  /** Add a point at canvas coordinates */
  addPointAtCanvas: (canvasX: number, canvasY: number) => void

  /** Delete a point by index (cannot delete anchors) */
  deletePoint: (index: number) => void

  /** Reset curve to linear */
  resetCurve: () => void

  /** Force re-render of the canvas */
  render: () => void
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WIDTH = 256
const DEFAULT_HEIGHT = 256
const POINT_RADIUS = 6
const POINT_HIT_RADIUS = 12 // Larger for easier clicking
const CURVE_LINE_WIDTH = 2

const COLORS = {
  background: '#1a1a1a',
  grid: '#2a2a2a',
  gridMajor: '#333333',
  curve: '#ffffff',
  point: '#ffffff',
  pointHover: '#3b82f6',
  pointDrag: '#60a5fa',
  diagonal: '#404040',
}

// ============================================================================
// Composable
// ============================================================================

export function useToneCurve(
  options: UseToneCurveOptions = {}
): UseToneCurveReturn {
  const {
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    debounceMs = 16,
    histogram,
  } = options

  const editStore = useEditStore()

  // ============================================================================
  // State
  // ============================================================================

  /** Canvas element ref */
  const canvasRef = ref<HTMLCanvasElement | null>(null)

  /**
   * Local curve state for smooth dragging.
   * Synced to store on drag end or debounced during drag.
   */
  const localCurve = ref<ToneCurve>({
    points: [...editStore.adjustments.toneCurve.points]
  })

  /** Currently dragged point index */
  const draggedPointIndex = ref<number | null>(null)

  /** Currently hovered point index */
  const hoveredPointIndex = ref<number | null>(null)

  /** Whether actively dragging */
  const isDragging = computed(() => draggedPointIndex.value !== null)

  // ============================================================================
  // Coordinate Conversions
  // ============================================================================

  /**
   * Convert normalized [0,1] coordinates to canvas coordinates.
   * Canvas Y is inverted (0 at top).
   */
  function toCanvas(point: ToneCurvePoint): { x: number; y: number } {
    return {
      x: point.x * width,
      y: (1 - point.y) * height,
    }
  }

  /**
   * Convert canvas coordinates to normalized [0,1] coordinates.
   */
  function toNormalized(canvasX: number, canvasY: number): ToneCurvePoint {
    return {
      x: Math.max(0, Math.min(1, canvasX / width)),
      y: Math.max(0, Math.min(1, 1 - canvasY / height)),
    }
  }

  /**
   * Find the point index at given canvas coordinates, or null.
   */
  function findPointAtCanvas(canvasX: number, canvasY: number): number | null {
    const points = localCurve.value.points
    for (let i = 0; i < points.length; i++) {
      const canvasPoint = toCanvas(points[i]!)
      const dx = canvasX - canvasPoint.x
      const dy = canvasY - canvasPoint.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance <= POINT_HIT_RADIUS) {
        return i
      }
    }
    return null
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Render the complete curve editor to canvas.
   */
  function render(): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, width, height)

    // Draw histogram background if available
    if (histogram?.value) {
      drawHistogramBackground(ctx, histogram.value)
    }

    // Draw grid
    drawGrid(ctx)

    // Draw diagonal reference line
    drawDiagonal(ctx)

    // Draw the curve
    drawCurve(ctx, localCurve.value)

    // Draw control points
    drawControlPoints(ctx, localCurve.value)
  }

  /**
   * Draw histogram as semi-transparent background.
   */
  function drawHistogramBackground(
    ctx: CanvasRenderingContext2D,
    hist: HistogramData
  ): void {
    const max = hist.maxValue || 1
    if (max === 0) return

    ctx.globalAlpha = 0.15
    ctx.fillStyle = '#666666'

    // Draw luminance histogram (average of RGB for simplicity)
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width
      const barWidth = Math.ceil(width / 256)

      // Average of RGB channels
      const avgValue = (hist.red[i]! + hist.green[i]! + hist.blue[i]!) / 3
      const barHeight = (avgValue / max) * height

      ctx.fillRect(x, height - barHeight, barWidth, barHeight)
    }

    ctx.globalAlpha = 1
  }

  /**
   * Draw grid lines.
   */
  function drawGrid(ctx: CanvasRenderingContext2D): void {
    // Minor grid lines at 25% intervals
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1

    for (let i = 1; i < 4; i++) {
      const pos = (i / 4) * width

      // Vertical
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, height)
      ctx.stroke()

      // Horizontal
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(width, pos)
      ctx.stroke()
    }

    // Major grid line at 50%
    ctx.strokeStyle = COLORS.gridMajor
    ctx.beginPath()
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
  }

  /**
   * Draw the diagonal reference line (linear mapping).
   */
  function drawDiagonal(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.diagonal
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, height)
    ctx.lineTo(width, 0)
    ctx.stroke()
    ctx.setLineDash([])
  }

  /**
   * Draw the interpolated curve.
   */
  function drawCurve(ctx: CanvasRenderingContext2D, curve: ToneCurve): void {
    const points = curve.points
    if (points.length < 2) return

    ctx.strokeStyle = COLORS.curve
    ctx.lineWidth = CURVE_LINE_WIDTH
    ctx.beginPath()

    // Sample the interpolated curve at high resolution
    const samples = 256
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const y = interpolateCurve(points, t)
      const canvasX = t * width
      const canvasY = (1 - y) * height

      if (i === 0) {
        ctx.moveTo(canvasX, canvasY)
      } else {
        ctx.lineTo(canvasX, canvasY)
      }
    }

    ctx.stroke()
  }

  /**
   * Draw control points.
   */
  function drawControlPoints(
    ctx: CanvasRenderingContext2D,
    curve: ToneCurve
  ): void {
    const points = curve.points

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!
      const canvasPoint = toCanvas(point)

      // Determine point color based on state
      let fillColor = COLORS.point
      if (draggedPointIndex.value === i) {
        fillColor = COLORS.pointDrag
      } else if (hoveredPointIndex.value === i) {
        fillColor = COLORS.pointHover
      }

      // Draw point
      ctx.fillStyle = fillColor
      ctx.beginPath()
      ctx.arc(canvasPoint.x, canvasPoint.y, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fill()

      // Draw border
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // ============================================================================
  // Curve Interpolation (Monotonic Cubic Spline)
  // ============================================================================

  /**
   * Interpolate the curve value at a given x position.
   * Uses monotonic cubic interpolation (Fritsch-Carlson method).
   */
  function interpolateCurve(points: ToneCurvePoint[], x: number): number {
    if (points.length === 0) return x
    if (points.length === 1) return points[0]!.y

    // Clamp to curve bounds
    if (x <= points[0]!.x) return points[0]!.y
    if (x >= points[points.length - 1]!.x) return points[points.length - 1]!.y

    // Find the segment containing x
    let i = 0
    while (i < points.length - 1 && points[i + 1]!.x < x) {
      i++
    }

    const p0 = points[i]!
    const p1 = points[i + 1]!

    // Linear interpolation for two-point curves
    if (points.length === 2) {
      const t = (x - p0.x) / (p1.x - p0.x)
      return p0.y + t * (p1.y - p0.y)
    }

    // Monotonic cubic interpolation
    return monotonicCubicInterpolate(points, i, x)
  }

  /**
   * Monotonic cubic interpolation (Fritsch-Carlson method).
   * Ensures the curve doesn't overshoot between control points.
   */
  function monotonicCubicInterpolate(
    points: ToneCurvePoint[],
    segmentIndex: number,
    x: number
  ): number {
    const n = points.length

    // Calculate secant slopes
    const secants: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const dx = points[i + 1]!.x - points[i]!.x
      const dy = points[i + 1]!.y - points[i]!.y
      secants.push(dx === 0 ? 0 : dy / dx)
    }

    // Calculate tangent slopes using Fritsch-Carlson method
    const tangents: number[] = []
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        tangents.push(secants[0]!)
      } else if (i === n - 1) {
        tangents.push(secants[n - 2]!)
      } else {
        const m0 = secants[i - 1]!
        const m1 = secants[i]!

        // If signs differ, tangent is 0 (monotonicity constraint)
        if (m0 * m1 <= 0) {
          tangents.push(0)
        } else {
          // Harmonic mean for smooth monotonic interpolation
          tangents.push(2 / (1 / m0 + 1 / m1))
        }
      }
    }

    // Apply monotonicity constraints
    for (let i = 0; i < n - 1; i++) {
      const m = secants[i]!
      if (m === 0) {
        tangents[i] = 0
        tangents[i + 1] = 0
      } else {
        const alpha = tangents[i]! / m
        const beta = tangents[i + 1]! / m
        const s = alpha * alpha + beta * beta
        if (s > 9) {
          const t = 3 / Math.sqrt(s)
          tangents[i] = t * alpha * m
          tangents[i + 1] = t * beta * m
        }
      }
    }

    // Hermite interpolation on the segment
    const i = segmentIndex
    const p0 = points[i]!
    const p1 = points[i + 1]!
    const h = p1.x - p0.x
    const t = (x - p0.x) / h

    const t2 = t * t
    const t3 = t2 * t

    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2

    return h00 * p0.y + h10 * h * tangents[i]! + h01 * p1.y + h11 * h * tangents[i + 1]!
  }

  // ============================================================================
  // Point Operations
  // ============================================================================

  /**
   * Add a point at canvas coordinates.
   */
  function addPointAtCanvas(canvasX: number, canvasY: number): void {
    const normalized = toNormalized(canvasX, canvasY)

    // Don't add if too close to existing point
    const existingIndex = findPointAtCanvas(canvasX, canvasY)
    if (existingIndex !== null) return

    const newPoints = [...localCurve.value.points, normalized]
      .sort((a, b) => a.x - b.x)

    localCurve.value = { points: newPoints }
    editStore.setToneCurve(localCurve.value)
    render()
  }

  /**
   * Delete a point by index (cannot delete anchors).
   */
  function deletePoint(index: number): void {
    const points = localCurve.value.points

    // Cannot delete anchor points (first and last)
    if (index === 0 || index === points.length - 1) return
    if (points.length <= 2) return

    const newPoints = points.filter((_, i) => i !== index)
    localCurve.value = { points: newPoints }
    editStore.setToneCurve(localCurve.value)
    render()
  }

  /**
   * Reset curve to linear.
   */
  function resetCurve(): void {
    editStore.resetToneCurve()
    localCurve.value = { points: [...editStore.adjustments.toneCurve.points] }
    render()
  }

  // ============================================================================
  // Mouse/Touch Event Handlers
  // ============================================================================

  /**
   * Debounced store update during drag for performance.
   */
  const debouncedStoreUpdate = debounce(() => {
    editStore.setToneCurve(localCurve.value)
  }, debounceMs)

  function handleMouseDown(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const canvasX = (e.clientX - rect.left) * scaleX
    const canvasY = (e.clientY - rect.top) * scaleY

    const pointIndex = findPointAtCanvas(canvasX, canvasY)

    if (pointIndex !== null) {
      // Start dragging existing point
      draggedPointIndex.value = pointIndex
    } else {
      // Add new point on click
      addPointAtCanvas(canvasX, canvasY)
    }
  }

  function handleMouseMove(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const canvasX = (e.clientX - rect.left) * scaleX
    const canvasY = (e.clientY - rect.top) * scaleY

    if (draggedPointIndex.value !== null) {
      // Update point position during drag
      const normalized = toNormalized(canvasX, canvasY)
      const points = [...localCurve.value.points]
      const index = draggedPointIndex.value

      // Constrain x movement for non-anchor points
      if (index > 0 && index < points.length - 1) {
        // Keep between neighbors
        const minX = points[index - 1]!.x + 0.01
        const maxX = points[index + 1]!.x - 0.01
        normalized.x = Math.max(minX, Math.min(maxX, normalized.x))
      } else {
        // Anchor points: lock x position
        normalized.x = points[index]!.x
      }

      points[index] = normalized
      localCurve.value = { points }

      // Debounced update to store for preview
      debouncedStoreUpdate()
      render()
    } else {
      // Update hover state
      const newHover = findPointAtCanvas(canvasX, canvasY)
      if (newHover !== hoveredPointIndex.value) {
        hoveredPointIndex.value = newHover
        render()
      }
    }
  }

  function handleMouseUp(): void {
    if (draggedPointIndex.value !== null) {
      // Commit final position to store
      debouncedStoreUpdate.cancel()
      editStore.setToneCurve(localCurve.value)
      draggedPointIndex.value = null
      render()
    }
  }

  function handleMouseLeave(): void {
    hoveredPointIndex.value = null
    if (draggedPointIndex.value !== null) {
      handleMouseUp()
    }
    render()
  }

  function handleDoubleClick(e: MouseEvent): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const canvasX = (e.clientX - rect.left) * scaleX
    const canvasY = (e.clientY - rect.top) * scaleY

    const pointIndex = findPointAtCanvas(canvasX, canvasY)
    if (pointIndex !== null) {
      deletePoint(pointIndex)
    }
  }

  // ============================================================================
  // Canvas Event Binding
  // ============================================================================

  function setupCanvasEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('dblclick', handleDoubleClick)
  }

  function teardownCanvasEvents(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('mousedown', handleMouseDown)
    canvas.removeEventListener('mousemove', handleMouseMove)
    canvas.removeEventListener('mouseup', handleMouseUp)
    canvas.removeEventListener('mouseleave', handleMouseLeave)
    canvas.removeEventListener('dblclick', handleDoubleClick)
  }

  // ============================================================================
  // Watchers
  // ============================================================================

  /**
   * Sync local curve from store when store changes externally
   * (e.g., reset, undo, load different asset).
   */
  watch(
    () => editStore.adjustments.toneCurve,
    (storeCurve) => {
      // Only sync if not currently dragging
      if (!isDragging.value) {
        localCurve.value = { points: [...storeCurve.points] }
        render()
      }
    },
    { deep: true }
  )

  /**
   * Watch for histogram changes to re-render background.
   */
  if (histogram) {
    watch(histogram, () => {
      render()
    })
  }

  /**
   * Setup/teardown canvas events when ref changes.
   */
  watch(canvasRef, (newCanvas, oldCanvas) => {
    if (oldCanvas) {
      teardownCanvasEvents(oldCanvas)
    }
    if (newCanvas) {
      setupCanvasEvents(newCanvas)
      render()
    }
  })

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMounted(() => {
    if (canvasRef.value) {
      setupCanvasEvents(canvasRef.value)
      render()
    }
  })

  onUnmounted(() => {
    debouncedStoreUpdate.cancel()
    if (canvasRef.value) {
      teardownCanvasEvents(canvasRef.value)
    }
  })

  return {
    canvasRef,
    localCurve,
    draggedPointIndex,
    hoveredPointIndex,
    isDragging,
    addPointAtCanvas,
    deletePoint,
    resetCurve,
    render,
  }
}

// ============================================================================
// Debounce Utility
// ============================================================================

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced as T & { cancel: () => void }
}
```

---

## 3. Coordinating Curve Changes with Preview Updates

### Existing Preview Pipeline

The `useEditPreview` composable:
1. Watches `editStore.adjustments` with deep watch
2. Triggers debounced render (300ms) on any change
3. Calls `$decodeService.applyAdjustments()` with current adjustments
4. Updates `previewUrl` with rendered result

### Integration Strategy

The tone curve composable must coordinate with this existing pipeline:

**A. During Drag (Real-time feedback)**

```
User drags point
    -> localCurve updated immediately
    -> Canvas re-renders (visual feedback)
    -> Store update debounced (16ms for 60fps feel)
    -> useEditPreview sees store change
    -> Preview render debounced (300ms)
    -> WASM applies curve via LUT
    -> Preview displays
```

**B. On Drag End (Final state)**

```
User releases mouse
    -> Cancel debounce, commit immediately to store
    -> useEditPreview triggers final render
```

**Key Timing Values:**
- Curve canvas redraw: Immediate (no debounce)
- Store update during drag: 16ms debounce
- Preview render: 300ms debounce (existing)
- Histogram update: 500ms debounce (existing)

### Preview Pipeline Extension

The `applyAdjustments` WASM function needs to accept tone curve data:

```typescript
// apps/web/app/composables/useEditPreview.ts

// Extend the adjustments passed to WASM
const adjustments: Adjustments = {
  // ... existing numeric adjustments ...
  toneCurve: editStore.adjustments.toneCurve,
}

// WASM will:
// 1. Build 256-entry LUT from curve points
// 2. Apply LUT to pixels after other adjustments
```

---

## 4. Undo/Reset Functionality

### Reset Curve Only

The `resetToneCurve()` method in the store resets just the tone curve to default while preserving other adjustments:

```typescript
// Already shown in store additions
function resetToneCurve(): void {
  setToneCurve(DEFAULT_TONE_CURVE)
}
```

### Reset All (Existing)

The existing `reset()` method resets all adjustments including tone curve:

```typescript
function reset(): void {
  adjustments.value = { ...DEFAULT_ADJUSTMENTS }
  isDirty.value = true
  error.value = null
}
```

Since `DEFAULT_ADJUSTMENTS` now includes `toneCurve: DEFAULT_TONE_CURVE`, this works automatically.

### Undo Support (Future)

For full undo/redo support, consider:

**Option 1: Command Pattern**
Store each edit as a command that can be reversed:

```typescript
interface EditCommand {
  type: 'adjustment' | 'toneCurve' | 'reset'
  before: Partial<Adjustments>
  after: Partial<Adjustments>
}

const undoStack: EditCommand[] = []
const redoStack: EditCommand[] = []
```

**Option 2: Snapshot History**
Store complete adjustment snapshots:

```typescript
const history: Adjustments[] = []
const historyIndex = ref(0)
const MAX_HISTORY = 50

function recordHistory(): void {
  // Truncate any redo states
  history.length = historyIndex.value + 1
  // Add current state
  history.push(JSON.parse(JSON.stringify(adjustments.value)))
  historyIndex.value = history.length - 1
  // Limit history size
  if (history.length > MAX_HISTORY) {
    history.shift()
    historyIndex.value--
  }
}

function undo(): void {
  if (historyIndex.value > 0) {
    historyIndex.value--
    adjustments.value = JSON.parse(JSON.stringify(history[historyIndex.value]))
  }
}

function redo(): void {
  if (historyIndex.value < history.length - 1) {
    historyIndex.value++
    adjustments.value = JSON.parse(JSON.stringify(history[historyIndex.value]))
  }
}
```

**Recommendation:** Start with reset-only in v1. Add full undo in a future phase. The architecture supports both approaches.

---

## 5. Data Serialization Format

### JSON Serialization

The `ToneCurve` interface is already JSON-compatible:

```json
{
  "version": 2,
  "adjustments": {
    "temperature": 0,
    "tint": 0,
    "exposure": 0,
    "contrast": 0,
    "highlights": 0,
    "shadows": 0,
    "whites": 0,
    "blacks": 0,
    "vibrance": 0,
    "saturation": 0,
    "toneCurve": {
      "points": [
        { "x": 0, "y": 0 },
        { "x": 0.25, "y": 0.15 },
        { "x": 0.75, "y": 0.85 },
        { "x": 1, "y": 1 }
      ]
    }
  }
}
```

### Validation

Add validation for loaded curve data:

```typescript
/**
 * Validate a tone curve object.
 */
export function isValidToneCurve(curve: unknown): curve is ToneCurve {
  if (!curve || typeof curve !== 'object') return false
  if (!('points' in curve) || !Array.isArray((curve as ToneCurve).points)) return false

  const points = (curve as ToneCurve).points

  // Minimum 2 points required
  if (points.length < 2) return false

  // Each point must have x and y in [0, 1]
  for (const point of points) {
    if (typeof point.x !== 'number' || typeof point.y !== 'number') return false
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false
  }

  // Points must be sorted by x
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.x <= points[i - 1]!.x) return false
  }

  // First point should be at x=0, last at x=1
  if (points[0]!.x !== 0 || points[points.length - 1]!.x !== 1) return false

  return true
}

/**
 * Sanitize a potentially invalid curve to a valid state.
 */
export function sanitizeToneCurve(curve: unknown): ToneCurve {
  if (isValidToneCurve(curve)) return curve
  return { ...DEFAULT_TONE_CURVE }
}
```

### Migration Support

When loading old edit states without `toneCurve`:

```typescript
export function migrateEditState(state: EditState): EditState {
  let current = state

  // v1 -> v2: Add tone curve
  if (current.version === 1) {
    current = {
      version: 2,
      adjustments: {
        ...current.adjustments,
        toneCurve: { ...DEFAULT_TONE_CURVE },
      },
    }
  }

  return current
}
```

---

## 6. Component Structure

### ToneCurveEditor.vue

```vue
<script setup lang="ts">
/**
 * ToneCurveEditor Component
 *
 * Interactive tone curve editor with:
 * - Canvas-based curve visualization
 * - Control point drag and drop
 * - Add/delete points
 * - Reset to linear
 * - Optional histogram background
 */
import type { HistogramData } from '@literoom/core/decode'

const props = defineProps<{
  assetId: string
  histogram?: HistogramData | null
}>()

const {
  canvasRef,
  localCurve,
  isDragging,
  resetCurve,
} = useToneCurve({
  width: 256,
  height: 256,
  histogram: toRef(props, 'histogram'),
})

/**
 * Check if curve differs from default (linear).
 */
const hasModifications = computed(() => {
  const points = localCurve.value.points
  if (points.length !== 2) return true
  if (points[0]?.x !== 0 || points[0]?.y !== 0) return true
  if (points[1]?.x !== 1 || points[1]?.y !== 1) return true
  return false
})
</script>

<template>
  <div class="space-y-3" data-testid="tone-curve-editor">
    <!-- Header with reset -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-gray-400">
        Tone Curve
      </h3>
      <div class="flex items-center gap-2">
        <span
          v-if="isDragging"
          class="text-xs text-blue-400"
          data-testid="curve-dragging"
        >
          Adjusting...
        </span>
        <button
          v-if="hasModifications"
          class="text-xs text-gray-500 hover:text-gray-300"
          data-testid="curve-reset"
          @click="resetCurve"
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Canvas container -->
    <div
      class="relative aspect-square bg-gray-900 rounded overflow-hidden cursor-crosshair"
      data-testid="curve-canvas-container"
    >
      <canvas
        ref="canvasRef"
        width="256"
        height="256"
        class="w-full h-full"
        data-testid="curve-canvas"
      />
    </div>

    <!-- Usage hints -->
    <p class="text-xs text-gray-600">
      Click to add point | Drag to adjust | Double-click to delete
    </p>
  </div>
</template>
```

### Integration in EditControlsPanel.vue

```vue
<!-- Tone Curve Section -->
<template #tonecurve-body>
  <ToneCurveEditor
    :asset-id="assetId"
    :histogram="histogramData"
  />
</template>
```

---

## 7. Summary of Files to Create/Modify

### New Files

| File | Description |
|------|-------------|
| `apps/web/app/composables/useToneCurve.ts` | Main composable for curve interaction |
| `apps/web/app/components/edit/ToneCurveEditor.vue` | Curve editor component |

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/catalog/types.ts` | Add `ToneCurve`, `ToneCurvePoint` interfaces; extend `Adjustments`; bump schema version |
| `apps/web/app/stores/edit.ts` | Add curve manipulation methods |
| `apps/web/app/components/edit/EditControlsPanel.vue` | Replace placeholder with `ToneCurveEditor` |
| `apps/web/app/composables/useEditPreview.ts` | Pass curve data to WASM |

### WASM/Rust Changes (Separate Area)

| File | Changes |
|------|---------|
| `packages/wasm/src/adjustments.rs` | Accept curve, build LUT, apply to pixels |
| `packages/wasm/src/lib.rs` | Update bindings |

---

## 8. Architectural Principles Applied

1. **Single Source of Truth**: All edit state lives in `edit.ts` store
2. **Optimistic Local State**: Composable maintains `localCurve` for smooth dragging, syncs to store
3. **Debounced Pipeline**: Prevents excessive renders during interaction
4. **Separation of Concerns**:
   - Store: State management
   - Composable: Interaction logic + Canvas rendering
   - Component: Template binding + UI chrome
5. **Type Safety**: Full TypeScript interfaces for all data structures
6. **JSON Serialization**: All state is JSON-compatible for persistence
7. **Schema Versioning**: Migrations handle backward compatibility

---

## References

- Existing composables: `useEditPreview.ts`, `useHistogramDisplay.ts`
- Store pattern: `apps/web/app/stores/edit.ts`
- Core types: `packages/core/src/catalog/types.ts`
- Component patterns: `EditAdjustmentSlider.vue`, `HistogramDisplay.vue`
