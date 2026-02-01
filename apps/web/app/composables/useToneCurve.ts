/**
 * useToneCurve Composable
 *
 * Manages tone curve interaction and rendering:
 * - Canvas rendering with curve visualization
 * - Control point drag interactions
 * - Point add/delete operations
 * - Coordinate conversions
 * - Debounced store updates
 */

import type { Ref } from 'vue'
import type { ToneCurve, CurvePoint, HistogramData } from '@literoom/core/decode'
import { linearInterpolateCurve } from '@literoom/core/decode'

// ============================================================================
// Constants
// ============================================================================

const CANVAS_SIZE = 256
const POINT_RADIUS = 6
const POINT_HIT_RADIUS = 14

const COLORS = {
  background: '#1a1a1a',
  grid: '#2a2a2a',
  gridMajor: '#333',
  diagonal: '#404040',
  curve: '#ffffff',
  point: '#ffffff',
  pointHover: '#3b82f6',
  pointDrag: '#60a5fa',
}

// ============================================================================
// Types
// ============================================================================

export interface UseToneCurveOptions {
  histogram?: Ref<HistogramData | null | undefined>
}

export interface UseToneCurveReturn {
  /** Ref to bind to the canvas element */
  canvasRef: Ref<HTMLCanvasElement | null>
  /** Local curve state (synced with store) */
  localCurve: Ref<ToneCurve>
  /** Index of currently dragged point, or null */
  draggedPointIndex: Ref<number | null>
  /** Index of currently hovered point, or null */
  hoveredPointIndex: Ref<number | null>
  /** Whether a point is being dragged */
  isDragging: ComputedRef<boolean>
  /** Delete a point by index */
  deletePoint: (index: number) => void
  /** Reset curve to linear */
  resetCurve: () => void
  /** Force re-render canvas */
  render: () => void
}

// ============================================================================
// Debounce Utility
// ============================================================================

/**
 * Simple debounce function with cancel capability.
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
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

// ============================================================================
// Composable
// ============================================================================

/**
 * Composable for managing tone curve editor interactions.
 *
 * @param options - Configuration options
 * @returns Tone curve state and controls
 */
export function useToneCurve(options: UseToneCurveOptions = {}): UseToneCurveReturn {
  const editStore = useEditStore()
  const { histogram } = options

  // ============================================================================
  // State
  // ============================================================================

  /** Canvas element ref */
  const canvasRef = ref<HTMLCanvasElement | null>(null)

  /** Local curve state (synced with store but allows immediate updates during drag) */
  const localCurve = ref<ToneCurve>({
    points: [...editStore.adjustments.toneCurve.points],
  })

  /** Index of currently dragged point */
  const draggedPointIndex = ref<number | null>(null)

  /** Index of currently hovered point */
  const hoveredPointIndex = ref<number | null>(null)

  /** Whether a point is being dragged */
  const isDragging = computed(() => draggedPointIndex.value !== null)

  // ============================================================================
  // Coordinate Conversion
  // ============================================================================

  /**
   * Convert normalized curve point to canvas coordinates.
   */
  function toCanvas(point: CurvePoint): { x: number, y: number } {
    return {
      x: point.x * CANVAS_SIZE,
      y: (1 - point.y) * CANVAS_SIZE,
    }
  }

  /**
   * Convert canvas coordinates to normalized curve point.
   */
  function toNormalized(canvasX: number, canvasY: number): CurvePoint {
    return {
      x: Math.max(0, Math.min(1, canvasX / CANVAS_SIZE)),
      y: Math.max(0, Math.min(1, 1 - canvasY / CANVAS_SIZE)),
    }
  }

  /**
   * Find point at canvas coordinates (within hit radius).
   */
  function findPointAt(canvasX: number, canvasY: number): number | null {
    for (let i = 0; i < localCurve.value.points.length; i++) {
      const p = toCanvas(localCurve.value.points[i]!)
      const dist = Math.sqrt((canvasX - p.x) ** 2 + (canvasY - p.y) ** 2)
      if (dist <= POINT_HIT_RADIUS) return i
    }
    return null
  }

  // ============================================================================
  // Curve Interpolation (for UI preview)
  // ============================================================================

  /**
   * Simple linear interpolation for UI curve drawing.
   * The WASM module uses the full monotonic spline for actual processing.
   */
  function evaluateCurve(x: number): number {
    return linearInterpolateCurve(localCurve.value.points, x)
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Main render function.
   */
  function render(): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Histogram background (if available)
    if (histogram?.value) {
      drawHistogram(ctx, histogram.value)
    }

    // Grid
    drawGrid(ctx)

    // Diagonal reference
    drawDiagonal(ctx)

    // Curve
    drawCurve(ctx)

    // Points
    drawPoints(ctx)
  }

  /**
   * Draw histogram as background.
   */
  function drawHistogram(ctx: CanvasRenderingContext2D, hist: HistogramData): void {
    const max = hist.maxValue || 1
    if (max === 0) return

    ctx.globalAlpha = 0.15
    ctx.fillStyle = '#666'

    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * CANVAS_SIZE
      const avg = (hist.red[i]! + hist.green[i]! + hist.blue[i]!) / 3
      const h = (avg / max) * CANVAS_SIZE
      ctx.fillRect(x, CANVAS_SIZE - h, 2, h)
    }

    ctx.globalAlpha = 1
  }

  /**
   * Draw grid lines.
   */
  function drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1

    // Quarter lines
    for (let i = 1; i < 4; i++) {
      const pos = (i / 4) * CANVAS_SIZE
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, CANVAS_SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(CANVAS_SIZE, pos)
      ctx.stroke()
    }

    // Center lines (slightly brighter)
    ctx.strokeStyle = COLORS.gridMajor
    const mid = CANVAS_SIZE / 2
    ctx.beginPath()
    ctx.moveTo(mid, 0)
    ctx.lineTo(mid, CANVAS_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(CANVAS_SIZE, mid)
    ctx.stroke()
  }

  /**
   * Draw diagonal reference line.
   */
  function drawDiagonal(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.diagonal
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, CANVAS_SIZE)
    ctx.lineTo(CANVAS_SIZE, 0)
    ctx.stroke()
    ctx.setLineDash([])
  }

  /**
   * Draw the curve line.
   */
  function drawCurve(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.curve
    ctx.lineWidth = 2
    ctx.beginPath()

    // Sample curve at 256 points for smooth drawing
    for (let i = 0; i <= 256; i++) {
      const x = i / 256
      const y = evaluateCurve(x)
      const canvasX = x * CANVAS_SIZE
      const canvasY = (1 - y) * CANVAS_SIZE

      if (i === 0) ctx.moveTo(canvasX, canvasY)
      else ctx.lineTo(canvasX, canvasY)
    }

    ctx.stroke()
  }

  /**
   * Draw control points.
   */
  function drawPoints(ctx: CanvasRenderingContext2D): void {
    localCurve.value.points.forEach((point, i) => {
      const p = toCanvas(point)

      // Determine color based on state
      let color = COLORS.point
      if (draggedPointIndex.value === i) color = COLORS.pointDrag
      else if (hoveredPointIndex.value === i) color = COLORS.pointHover

      // Draw point
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fill()

      // Draw outline
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.stroke()
    })
  }

  // ============================================================================
  // Debounced Store Update
  // ============================================================================

  /**
   * Debounced update to the store (16ms for 60fps responsiveness).
   */
  const debouncedStoreUpdate = debounce(() => {
    editStore.setToneCurve(localCurve.value)
  }, 16)

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Get canvas coordinates from mouse event.
   */
  function getCanvasCoords(e: MouseEvent): { x: number, y: number } | null {
    const canvas = canvasRef.value
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  /**
   * Handle mouse down - start drag or add point.
   */
  function handleMouseDown(e: MouseEvent): void {
    const coords = getCanvasCoords(e)
    if (!coords) return

    const pointIndex = findPointAt(coords.x, coords.y)
    if (pointIndex !== null) {
      // Start dragging existing point
      draggedPointIndex.value = pointIndex
    }
    else {
      // Add new point
      const normalized = toNormalized(coords.x, coords.y)
      const newPoints = [...localCurve.value.points, normalized].sort(
        (a, b) => a.x - b.x,
      )
      localCurve.value = { points: newPoints }
      editStore.setToneCurve(localCurve.value)
      render()
    }
  }

  /**
   * Handle mouse move - drag point or update hover state.
   */
  function handleMouseMove(e: MouseEvent): void {
    const coords = getCanvasCoords(e)
    if (!coords) return

    if (draggedPointIndex.value !== null) {
      // Dragging a point
      const normalized = toNormalized(coords.x, coords.y)
      const points = [...localCurve.value.points]
      const i = draggedPointIndex.value

      // Constrain x for non-anchor points
      if (i > 0 && i < points.length - 1) {
        // Keep x between adjacent points
        normalized.x = Math.max(
          points[i - 1]!.x + 0.01,
          Math.min(points[i + 1]!.x - 0.01, normalized.x),
        )
      }
      else {
        // Lock anchor x position
        normalized.x = points[i]!.x
      }

      points[i] = normalized
      localCurve.value = { points }
      debouncedStoreUpdate()
      render()
    }
    else {
      // Update hover state
      const newHover = findPointAt(coords.x, coords.y)
      if (newHover !== hoveredPointIndex.value) {
        hoveredPointIndex.value = newHover
        render()
      }
    }
  }

  /**
   * Handle mouse up - end drag.
   */
  function handleMouseUp(): void {
    if (draggedPointIndex.value !== null) {
      debouncedStoreUpdate.cancel()
      editStore.setToneCurve(localCurve.value)
      draggedPointIndex.value = null
      render()
    }
  }

  /**
   * Handle mouse leave - end drag and clear hover.
   */
  function handleMouseLeave(): void {
    hoveredPointIndex.value = null
    if (draggedPointIndex.value !== null) {
      handleMouseUp()
    }
    render()
  }

  /**
   * Handle double-click - delete point.
   */
  function handleDoubleClick(e: MouseEvent): void {
    const coords = getCanvasCoords(e)
    if (!coords) return

    const pointIndex = findPointAt(coords.x, coords.y)
    if (pointIndex !== null) {
      deletePoint(pointIndex)
    }
  }

  // ============================================================================
  // Public Actions
  // ============================================================================

  /**
   * Delete a point by index.
   * Cannot delete anchor points (first and last) or reduce below 2 points.
   */
  function deletePoint(index: number): void {
    const points = localCurve.value.points
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
  // Event Setup/Teardown
  // ============================================================================

  /**
   * Setup event listeners on canvas.
   */
  function setupEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('dblclick', handleDoubleClick)
  }

  /**
   * Remove event listeners from canvas.
   */
  function teardownEvents(canvas: HTMLCanvasElement): void {
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
   * Sync local curve with store (when not dragging).
   */
  watch(
    () => editStore.adjustments.toneCurve,
    (storeCurve) => {
      if (!isDragging.value) {
        localCurve.value = { points: [...storeCurve.points] }
        render()
      }
    },
    { deep: true },
  )

  /**
   * Re-render when histogram changes.
   */
  if (histogram) {
    watch(histogram, () => render())
  }

  /**
   * Setup/teardown events when canvas ref changes.
   */
  watch(canvasRef, (newCanvas, oldCanvas) => {
    if (oldCanvas) teardownEvents(oldCanvas)
    if (newCanvas) {
      setupEvents(newCanvas)
      render()
    }
  })

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMounted(() => {
    if (canvasRef.value) {
      setupEvents(canvasRef.value)
      render()
    }
  })

  onUnmounted(() => {
    debouncedStoreUpdate.cancel()
    if (canvasRef.value) {
      teardownEvents(canvasRef.value)
    }
  })

  return {
    canvasRef,
    localCurve,
    draggedPointIndex,
    hoveredPointIndex,
    isDragging,
    deletePoint,
    resetCurve,
    render,
  }
}
