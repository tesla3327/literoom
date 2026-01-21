# Area 3: Canvas UI for Tone Curve Editor

**Date**: 2026-01-21
**Status**: Complete
**Research Area**: Interactive Canvas Curve Editor UI Implementation

---

## Overview

This document covers research for implementing an interactive tone curve editor using HTML Canvas in a Vue 3 application. The tone curve editor is a fundamental photo editing tool that allows users to:

- Add control points by clicking on the curve
- Drag points to adjust the curve shape
- Delete control points
- Reset the curve to default (diagonal line)
- View a histogram overlay behind the curve (like Adobe Lightroom)

---

## 1. Rendering an Interactive Curve Editor in HTML Canvas

### Canvas Architecture

The curve editor should use a layered rendering approach with multiple passes:

```typescript
// Render order (back to front):
// 1. Background fill
// 2. Histogram (semi-transparent)
// 3. Grid lines
// 4. The curve itself
// 5. Control points (handles)
```

### Basic Canvas Setup

```typescript
interface CurveEditorOptions {
  width: number          // Canvas width in pixels (256 or 512)
  height: number         // Canvas height in pixels (same as width for square)
  backgroundColor: string // Dark background (#1a1a1a)
  gridColor: string      // Subtle grid lines (#333)
  curveColor: string     // White/light curve (#fff)
  pointRadius: number    // Control point visual radius (6-8px)
  hitRadius: number      // Hit detection radius (12-16px for easier clicking)
}

function renderCurveEditor(
  ctx: CanvasRenderingContext2D,
  options: CurveEditorOptions,
  points: ControlPoint[],
  histogramData?: HistogramData,
): void {
  const { width, height } = options

  // 1. Clear and fill background
  ctx.fillStyle = options.backgroundColor
  ctx.fillRect(0, 0, width, height)

  // 2. Draw histogram (behind curve)
  if (histogramData) {
    drawHistogram(ctx, width, height, histogramData)
  }

  // 3. Draw grid lines
  drawGrid(ctx, width, height, options.gridColor)

  // 4. Draw the curve
  drawCurve(ctx, width, height, points, options.curveColor)

  // 5. Draw control points
  drawControlPoints(ctx, width, height, points, options)
}
```

### Grid Drawing

```typescript
function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1

  // Draw 4x4 grid (5 lines each direction)
  const divisions = 4

  for (let i = 1; i < divisions; i++) {
    const pos = (i / divisions)

    // Vertical lines
    ctx.beginPath()
    ctx.moveTo(pos * width, 0)
    ctx.lineTo(pos * width, height)
    ctx.stroke()

    // Horizontal lines
    ctx.beginPath()
    ctx.moveTo(0, pos * height)
    ctx.lineTo(width, pos * height)
    ctx.stroke()
  }

  // Optional: Draw diagonal baseline (dashed)
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#555'
  ctx.beginPath()
  ctx.moveTo(0, height)
  ctx.lineTo(width, 0)
  ctx.stroke()
  ctx.setLineDash([])
}
```

### Curve Rendering with Catmull-Rom Splines

For smooth, natural-looking curves that pass through all control points, **Catmull-Rom splines** are the recommended approach. They:

- Pass exactly through each control point (unlike Bezier)
- Provide smooth tangent continuity between segments
- Are computationally efficient
- Can be converted to cubic Bezier for canvas API compatibility

```typescript
interface ControlPoint {
  x: number  // 0-1 normalized (input value)
  y: number  // 0-1 normalized (output value)
}

/**
 * Convert Catmull-Rom control points to canvas coordinates
 * and draw using bezierCurveTo for hardware acceleration.
 */
function drawCurve(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: ControlPoint[],
  color: string,
): void {
  if (points.length < 2) return

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Sort points by x coordinate
  const sorted = [...points].sort((a, b) => a.x - b.x)

  ctx.beginPath()

  // Convert normalized to canvas coordinates
  // Note: Canvas Y is inverted (0 at top, height at bottom)
  const toCanvasX = (x: number) => x * width
  const toCanvasY = (y: number) => (1 - y) * height

  // Start at first point
  ctx.moveTo(toCanvasX(sorted[0].x), toCanvasY(sorted[0].y))

  // Draw curve segments using Catmull-Rom to Bezier conversion
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[Math.max(0, i - 1)]
    const p1 = sorted[i]
    const p2 = sorted[i + 1]
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)]

    // Convert Catmull-Rom segment to cubic Bezier
    const bezier = catmullRomToBezier(p0, p1, p2, p3)

    ctx.bezierCurveTo(
      toCanvasX(bezier.cp1.x), toCanvasY(bezier.cp1.y),
      toCanvasX(bezier.cp2.x), toCanvasY(bezier.cp2.y),
      toCanvasX(bezier.end.x), toCanvasY(bezier.end.y),
    )
  }

  ctx.stroke()
}

/**
 * Convert a Catmull-Rom spline segment to cubic Bezier control points.
 * Uses tension = 0.5 (centripetal) for natural-looking curves.
 */
function catmullRomToBezier(
  p0: ControlPoint,
  p1: ControlPoint,
  p2: ControlPoint,
  p3: ControlPoint,
  tension: number = 0.5,
): { cp1: ControlPoint; cp2: ControlPoint; end: ControlPoint } {
  // Calculate tangents using Catmull-Rom formula
  const t1x = tension * (p2.x - p0.x)
  const t1y = tension * (p2.y - p0.y)
  const t2x = tension * (p3.x - p1.x)
  const t2y = tension * (p3.y - p1.y)

  // Convert to Bezier control points
  return {
    cp1: {
      x: p1.x + t1x / 3,
      y: p1.y + t1y / 3,
    },
    cp2: {
      x: p2.x - t2x / 3,
      y: p2.y - t2y / 3,
    },
    end: p2,
  }
}
```

### Control Point Rendering

```typescript
function drawControlPoints(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: ControlPoint[],
  options: CurveEditorOptions,
  activePointIndex: number | null = null,
): void {
  const toCanvasX = (x: number) => x * width
  const toCanvasY = (y: number) => (1 - y) * height

  points.forEach((point, index) => {
    const cx = toCanvasX(point.x)
    const cy = toCanvasY(point.y)
    const isActive = index === activePointIndex

    // Draw outer ring
    ctx.beginPath()
    ctx.arc(cx, cy, options.pointRadius, 0, Math.PI * 2)
    ctx.fillStyle = isActive ? '#fff' : '#aaa'
    ctx.fill()

    // Draw inner dot for contrast
    ctx.beginPath()
    ctx.arc(cx, cy, options.pointRadius - 2, 0, Math.PI * 2)
    ctx.fillStyle = isActive ? '#333' : '#1a1a1a'
    ctx.fill()
  })
}
```

---

## 2. Handling Point Dragging with Smooth Updates

### Pointer Events (Unified Mouse/Touch)

Using **Pointer Events** provides a unified API for mouse, touch, and pen input:

```typescript
interface UseCurveDragReturn {
  isDragging: Ref<boolean>
  activePointIndex: Ref<number | null>
  handlePointerDown: (e: PointerEvent) => void
  handlePointerMove: (e: PointerEvent) => void
  handlePointerUp: (e: PointerEvent) => void
}

function useCurveDrag(
  canvasRef: Ref<HTMLCanvasElement | null>,
  points: Ref<ControlPoint[]>,
  options: CurveEditorOptions,
  onUpdate: (points: ControlPoint[]) => void,
): UseCurveDragReturn {
  const isDragging = ref(false)
  const activePointIndex = ref<number | null>(null)

  function getCanvasCoordinates(e: PointerEvent): { x: number; y: number } | null {
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

  function toNormalized(canvasX: number, canvasY: number): ControlPoint {
    const canvas = canvasRef.value!
    return {
      x: Math.max(0, Math.min(1, canvasX / canvas.width)),
      y: Math.max(0, Math.min(1, 1 - canvasY / canvas.height)),
    }
  }

  function findNearestPoint(canvasX: number, canvasY: number): number | null {
    const canvas = canvasRef.value!
    const threshold = options.hitRadius

    let nearest: { index: number; distance: number } | null = null

    points.value.forEach((point, index) => {
      const px = point.x * canvas.width
      const py = (1 - point.y) * canvas.height
      const dist = Math.sqrt((canvasX - px) ** 2 + (canvasY - py) ** 2)

      if (dist <= threshold && (!nearest || dist < nearest.distance)) {
        nearest = { index, distance: dist }
      }
    })

    return nearest?.index ?? null
  }

  function handlePointerDown(e: PointerEvent): void {
    const coords = getCanvasCoordinates(e)
    if (!coords) return

    // Capture pointer for reliable tracking
    canvasRef.value?.setPointerCapture(e.pointerId)

    const nearIndex = findNearestPoint(coords.x, coords.y)

    if (nearIndex !== null) {
      // Start dragging existing point
      isDragging.value = true
      activePointIndex.value = nearIndex
    }
    // Note: Adding points is handled separately (see UX section)
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isDragging.value || activePointIndex.value === null) return

    const coords = getCanvasCoordinates(e)
    if (!coords) return

    const normalized = toNormalized(coords.x, coords.y)

    // Update the point position
    const newPoints = [...points.value]
    newPoints[activePointIndex.value] = normalized

    onUpdate(newPoints)
  }

  function handlePointerUp(e: PointerEvent): void {
    canvasRef.value?.releasePointerCapture(e.pointerId)
    isDragging.value = false
    // Keep activePointIndex to show which point is selected
  }

  return {
    isDragging,
    activePointIndex,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
```

### CSS for Touch Support

Critical CSS to prevent browser default touch behaviors:

```css
.curve-editor-canvas {
  /* Prevent all touch actions from triggering browser defaults */
  touch-action: none;

  /* Prevent text selection during drag */
  user-select: none;
  -webkit-user-select: none;

  /* Cursor feedback */
  cursor: crosshair;
}

.curve-editor-canvas.dragging {
  cursor: grabbing;
}

.curve-editor-canvas.hovering-point {
  cursor: grab;
}
```

### Performance Optimization: RequestAnimationFrame

```typescript
function useCurveAnimation(render: () => void): { scheduleRender: () => void } {
  let frameId: number | null = null

  function scheduleRender(): void {
    if (frameId !== null) return // Already scheduled

    frameId = requestAnimationFrame(() => {
      render()
      frameId = null
    })
  }

  onUnmounted(() => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId)
    }
  })

  return { scheduleRender }
}
```

---

## 3. UX for Adding/Deleting Control Points

### Adding Control Points

Based on Adobe Lightroom's established UX patterns:

1. **Click on curve line**: Add a point where clicked
2. **Click away from line**: Do nothing (prevent accidental additions)
3. **Visual feedback**: Show cursor change when hovering near the curve line

```typescript
function isNearCurveLine(
  canvasX: number,
  canvasY: number,
  points: ControlPoint[],
  canvasWidth: number,
  canvasHeight: number,
  threshold: number = 8,
): { isNear: boolean; x: number; y: number } {
  const normalizedX = canvasX / canvasWidth

  // Find the Y value on the curve at this X position
  const curveY = evaluateCurveAt(normalizedX, points)
  const curveCanvasY = (1 - curveY) * canvasHeight

  const distance = Math.abs(canvasY - curveCanvasY)

  return {
    isNear: distance <= threshold,
    x: normalizedX,
    y: curveY,
  }
}

function handleClick(e: PointerEvent): void {
  // Only add point if single click (not drag end) and near the curve
  if (wasDragging) {
    wasDragging = false
    return
  }

  const coords = getCanvasCoordinates(e)
  if (!coords) return

  const nearCurve = isNearCurveLine(
    coords.x, coords.y, points.value,
    canvas.width, canvas.height
  )

  if (nearCurve.isNear) {
    // Add new point at the clicked position
    const newPoints = [
      ...points.value,
      { x: nearCurve.x, y: nearCurve.y }
    ].sort((a, b) => a.x - b.x)

    onUpdate(newPoints)

    // Select the newly added point
    activePointIndex.value = newPoints.findIndex(
      p => p.x === nearCurve.x && p.y === nearCurve.y
    )
  }
}
```

### Deleting Control Points

Multiple deletion methods (matching Lightroom):

1. **Double-click on point**: Delete the point
2. **Right-click context menu**: "Delete Control Point" option
3. **Drag point outside canvas**: Delete on release
4. **Keyboard (Delete/Backspace)**: Delete selected point

```typescript
// Double-click detection
let lastClickTime = 0
let lastClickIndex: number | null = null

function handlePointerDown(e: PointerEvent): void {
  const coords = getCanvasCoordinates(e)
  if (!coords) return

  const nearIndex = findNearestPoint(coords.x, coords.y)
  const now = Date.now()

  // Double-click detection (within 300ms)
  if (nearIndex !== null &&
      nearIndex === lastClickIndex &&
      now - lastClickTime < 300) {
    // Delete the point (except endpoints)
    deletePoint(nearIndex)
    lastClickTime = 0
    lastClickIndex = null
    return
  }

  lastClickTime = now
  lastClickIndex = nearIndex

  // ... normal drag handling
}

function deletePoint(index: number): void {
  const point = points.value[index]

  // Prevent deleting endpoint anchors (x=0 or x=1)
  if (point.x === 0 || point.x === 1) {
    return
  }

  const newPoints = points.value.filter((_, i) => i !== index)
  onUpdate(newPoints)
  activePointIndex.value = null
}

// Keyboard delete
function handleKeydown(e: KeyboardEvent): void {
  if ((e.key === 'Delete' || e.key === 'Backspace') &&
      activePointIndex.value !== null) {
    e.preventDefault()
    deletePoint(activePointIndex.value)
  }
}

// Drag outside to delete
function handlePointerUp(e: PointerEvent): void {
  if (isDragging.value && activePointIndex.value !== null) {
    const coords = getCanvasCoordinates(e)

    // Check if pointer is outside canvas bounds
    if (!coords ||
        coords.x < -20 || coords.x > canvas.width + 20 ||
        coords.y < -20 || coords.y > canvas.height + 20) {
      deletePoint(activePointIndex.value)
    }
  }

  // ... cleanup
}
```

### Reset Curve

```typescript
function resetCurve(): void {
  // Default: diagonal line with just two endpoints
  onUpdate([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ])
  activePointIndex.value = null
}
```

---

## 4. Displaying Histogram Behind the Curve

### Leveraging Existing Histogram Implementation

The codebase already has `useHistogramDisplay.ts` which computes and renders histograms. We can adapt this approach:

```typescript
function drawHistogram(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  histogram: HistogramData,
): void {
  const { red, green, blue, maxValue } = histogram
  if (maxValue === 0) return

  // Use semi-transparent rendering for background histogram
  ctx.globalAlpha = 0.25

  const barWidth = Math.ceil(width / 256)

  for (let i = 0; i < 256; i++) {
    const x = (i / 256) * width

    // Red channel
    const redHeight = (red[i] / maxValue) * height
    ctx.fillStyle = 'rgb(255, 80, 80)'
    ctx.fillRect(x, height - redHeight, barWidth, redHeight)

    // Green channel
    const greenHeight = (green[i] / maxValue) * height
    ctx.fillStyle = 'rgb(80, 255, 80)'
    ctx.fillRect(x, height - greenHeight, barWidth, greenHeight)

    // Blue channel
    const blueHeight = (blue[i] / maxValue) * height
    ctx.fillStyle = 'rgb(80, 80, 255)'
    ctx.fillRect(x, height - blueHeight, barWidth, blueHeight)
  }

  // Reset alpha
  ctx.globalAlpha = 1.0
}
```

### Alternative: Luminance Histogram Only

For tone curves, a luminance-only histogram may be more appropriate:

```typescript
function drawLuminanceHistogram(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  histogram: HistogramData,
): void {
  const { red, green, blue, maxValue } = histogram
  if (maxValue === 0) return

  // Compute luminance histogram
  const luminance = new Uint32Array(256)
  let lumMax = 0

  for (let i = 0; i < 256; i++) {
    // Standard luminance weights: 0.299R + 0.587G + 0.114B
    luminance[i] = Math.round(
      0.299 * red[i] + 0.587 * green[i] + 0.114 * blue[i]
    )
    lumMax = Math.max(lumMax, luminance[i])
  }

  // Draw as filled area with gradient
  ctx.globalAlpha = 0.3

  const gradient = ctx.createLinearGradient(0, height, 0, 0)
  gradient.addColorStop(0, '#444')
  gradient.addColorStop(1, '#666')
  ctx.fillStyle = gradient

  ctx.beginPath()
  ctx.moveTo(0, height)

  for (let i = 0; i < 256; i++) {
    const x = (i / 256) * width
    const h = (luminance[i] / lumMax) * height * 0.9 // 90% max height
    ctx.lineTo(x, height - h)
  }

  ctx.lineTo(width, height)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 1.0
}
```

### Canvas Compositing

Use `globalCompositeOperation` for advanced blending if needed:

```typescript
// Draw histogram with multiply blend for subtle effect
ctx.globalCompositeOperation = 'multiply'
drawHistogram(ctx, width, height, histogram)
ctx.globalCompositeOperation = 'source-over' // Reset to default
```

---

## 5. Precision: Snapping and Constraints

### Hit Detection Threshold

```typescript
const HIT_THRESHOLDS = {
  // Visual radius for drawing points
  pointVisualRadius: 6,

  // Hit detection radius (larger for easier clicking)
  pointHitRadius: 14,

  // Threshold for detecting clicks near the curve line
  curveHitThreshold: 10,

  // Snap distance for grid snapping (optional)
  gridSnapDistance: 8,
}
```

### Constraint System

```typescript
interface CurveConstraints {
  // Prevent moving endpoints horizontally
  lockEndpointX: boolean

  // Clamp Y values to valid range
  minY: number
  maxY: number

  // Prevent crossing adjacent points
  preventCrossing: boolean

  // Optional grid snapping
  snapToGrid: boolean
  gridDivisions: number
}

function applyConstraints(
  point: ControlPoint,
  index: number,
  allPoints: ControlPoint[],
  constraints: CurveConstraints,
): ControlPoint {
  let { x, y } = point

  // Clamp Y to valid range
  y = Math.max(constraints.minY, Math.min(constraints.maxY, y))

  // Lock endpoint X positions
  if (constraints.lockEndpointX) {
    if (index === 0) x = 0
    if (index === allPoints.length - 1) x = 1
  }

  // Prevent crossing adjacent points
  if (constraints.preventCrossing) {
    const prev = allPoints[index - 1]
    const next = allPoints[index + 1]

    if (prev) x = Math.max(prev.x + 0.01, x)
    if (next) x = Math.min(next.x - 0.01, x)
  }

  // Optional grid snapping
  if (constraints.snapToGrid) {
    const step = 1 / constraints.gridDivisions
    x = Math.round(x / step) * step
    y = Math.round(y / step) * step
  }

  return { x, y }
}
```

### Modifier Key Behaviors

```typescript
function handlePointerMove(e: PointerEvent): void {
  // ... get normalized position

  let point = { x: normalizedX, y: normalizedY }

  // Shift key: constrain to horizontal or vertical movement
  if (e.shiftKey && dragStartPoint) {
    const dx = Math.abs(point.x - dragStartPoint.x)
    const dy = Math.abs(point.y - dragStartPoint.y)

    if (dx > dy) {
      point.y = dragStartPoint.y // Lock Y
    } else {
      point.x = dragStartPoint.x // Lock X
    }
  }

  // Alt/Option key: fine-grained movement (1/4 speed)
  if (e.altKey && dragStartPoint) {
    point.x = dragStartPoint.x + (point.x - dragStartPoint.x) * 0.25
    point.y = dragStartPoint.y + (point.y - dragStartPoint.y) * 0.25
  }

  // Apply constraints
  point = applyConstraints(point, activePointIndex.value!, points.value, constraints)

  // ... update
}
```

---

## 6. Touch and Mouse Input Handling

### Using Pointer Events API

The **Pointer Events API** is the recommended approach for unified input handling:

```typescript
// Template
<canvas
  ref="canvasRef"
  :width="256"
  :height="256"
  class="curve-editor-canvas"
  @pointerdown="handlePointerDown"
  @pointermove="handlePointerMove"
  @pointerup="handlePointerUp"
  @pointercancel="handlePointerCancel"
  @contextmenu.prevent="handleContextMenu"
/>
```

### Pointer Capture

Use pointer capture to ensure events continue even if pointer moves outside canvas:

```typescript
function handlePointerDown(e: PointerEvent): void {
  // Capture pointer for reliable tracking
  canvasRef.value?.setPointerCapture(e.pointerId)

  // ... rest of handler
}

function handlePointerUp(e: PointerEvent): void {
  // Release capture
  canvasRef.value?.releasePointerCapture(e.pointerId)

  // ... rest of handler
}

function handlePointerCancel(e: PointerEvent): void {
  // Handle cancelled touches (e.g., incoming call)
  canvasRef.value?.releasePointerCapture(e.pointerId)
  isDragging.value = false
  activePointIndex.value = null
}
```

### Multi-Touch Considerations

For a tone curve editor, multi-touch is typically not needed, but we should handle it gracefully:

```typescript
function handlePointerDown(e: PointerEvent): void {
  // Only handle primary pointer
  if (!e.isPrimary) return

  // ... rest of handler
}
```

### Touch-Specific Optimizations

```typescript
// Increase hit area on touch devices
const hitRadius = computed(() => {
  // Check for touch capability
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  return isTouch ? 20 : 14
})
```

---

## Vue 3 Composable Architecture

### Recommended Composable Structure

```typescript
// composables/useToneCurveEditor.ts

export interface UseToneCurveEditorOptions {
  canvasRef: Ref<HTMLCanvasElement | null>
  histogram?: Ref<HistogramData | null>
  onChange?: (points: ControlPoint[]) => void
}

export interface UseToneCurveEditorReturn {
  // State
  points: Ref<ControlPoint[]>
  activePointIndex: Ref<number | null>
  isDragging: Ref<boolean>

  // Actions
  addPoint: (x: number, y: number) => void
  deletePoint: (index: number) => void
  reset: () => void

  // Event handlers
  handlePointerDown: (e: PointerEvent) => void
  handlePointerMove: (e: PointerEvent) => void
  handlePointerUp: (e: PointerEvent) => void
  handlePointerCancel: (e: PointerEvent) => void
}

export function useToneCurveEditor(
  options: UseToneCurveEditorOptions
): UseToneCurveEditorReturn {
  // Implementation combining all the patterns above
}
```

### Component Example

```vue
<script setup lang="ts">
const props = defineProps<{
  modelValue: ControlPoint[]
  histogram?: HistogramData | null
}>()

const emit = defineEmits<{
  'update:modelValue': [points: ControlPoint[]]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const {
  points,
  activePointIndex,
  isDragging,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handlePointerCancel,
  reset,
} = useToneCurveEditor({
  canvasRef,
  histogram: toRef(props, 'histogram'),
  onChange: (newPoints) => emit('update:modelValue', newPoints),
})

// Sync with v-model
watch(() => props.modelValue, (val) => {
  points.value = val
}, { immediate: true })
</script>

<template>
  <div class="tone-curve-editor">
    <canvas
      ref="canvasRef"
      :width="256"
      :height="256"
      class="w-full aspect-square"
      :class="{
        'cursor-grabbing': isDragging,
        'cursor-grab': activePointIndex !== null && !isDragging,
        'cursor-crosshair': activePointIndex === null,
      }"
      style="touch-action: none;"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
    />

    <div class="mt-2 flex justify-end">
      <button
        class="text-xs text-gray-400 hover:text-gray-200"
        @click="reset"
      >
        Reset Curve
      </button>
    </div>
  </div>
</template>
```

---

## Performance Recommendations

### 1. Debounce Preview Updates

```typescript
// Only update preview after user stops dragging
const debouncedPreviewUpdate = debounce(() => {
  editStore.setAdjustment('toneCurve', points.value)
}, 150)

// Immediate visual update, debounced store update
watch(points, () => {
  renderCanvas() // Immediate
  debouncedPreviewUpdate() // Debounced
})
```

### 2. Use OffscreenCanvas for Histogram

```typescript
// Pre-render histogram to offscreen canvas
const histogramCanvas = new OffscreenCanvas(256, 256)
const histogramCtx = histogramCanvas.getContext('2d')!

watch(histogram, (data) => {
  if (data) {
    drawHistogram(histogramCtx, 256, 256, data)
  }
})

// In main render, just copy the pre-rendered histogram
ctx.drawImage(histogramCanvas, 0, 0)
```

### 3. Avoid Object Allocations in Hot Path

```typescript
// Reuse objects instead of creating new ones
const tempPoint = { x: 0, y: 0 }

function handlePointerMove(e: PointerEvent): void {
  // Update in place instead of creating new object
  tempPoint.x = normalizedX
  tempPoint.y = normalizedY
  // ...
}
```

---

## Summary and Recommendations

### Core Implementation Approach

1. **Rendering**: Layer-based canvas rendering (histogram -> grid -> curve -> points)
2. **Interpolation**: Catmull-Rom splines converted to Bezier for canvas API
3. **Input**: Pointer Events API with capture for unified mouse/touch handling
4. **UX**: Follow Lightroom patterns (click-to-add, double-click-to-delete, drag-outside-to-delete)
5. **Architecture**: Single Vue 3 composable (`useToneCurveEditor`) encapsulating all logic

### Key Technical Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Input API | Pointer Events | Unified mouse/touch/pen support |
| Curve interpolation | Catmull-Rom -> Bezier | Smooth curves through points, canvas API compatible |
| Hit detection | Distance-based with threshold | Simple, performant, touch-friendly |
| Histogram display | Semi-transparent overlay | Matches Lightroom, provides visual context |
| State management | Composable + Pinia store | Reactive, testable, integrates with existing architecture |

### Files to Create/Modify

1. **New**: `apps/web/app/composables/useToneCurveEditor.ts`
2. **New**: `apps/web/app/components/edit/ToneCurveEditor.vue`
3. **Modify**: `apps/web/app/stores/edit.ts` - Add toneCurve to adjustments
4. **Modify**: `@literoom/core/catalog` types - Add ToneCurve interface

---

## References

### Canvas and Drawing
- [Konva.js - Modify Curves with Anchor Points](https://konvajs.org/docs/sandbox/Modify_Curves_with_Anchor_Points.html)
- [SitePoint - Draw Bezier Curves on HTML5 Canvas](https://www.sitepoint.com/html5-canvas-draw-bezier-curves/)
- [Smooth.js Demo - Fluid Curves](https://osuushi.github.io/plotdemo016.html)
- [GitHub - SuperDelphi/bezier-demo](https://github.com/SuperDelphi/bezier-demo)

### Curve Mathematics
- [Catmull-Rom Splines in Game Development](https://andrewhungblog.wordpress.com/2017/03/03/catmull-rom-splines-in-plain-english/)
- [Smooth Paths Using Catmull-Rom Splines](https://qroph.github.io/2018/07/30/smooth-paths-using-catmull-rom-splines.html)
- [GitHub - Cardinal Spline JS](https://github.com/gdenisov/cardinal-spline-js)

### Input Handling
- [MDN - Using Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events)
- [Apple - Adding Mouse and Touch Controls to Canvas](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HTML-canvas-guide/AddingMouseandTouchControlstoCanvas/AddingMouseandTouchControlstoCanvas.html)
- [Konva.js - Mobile Touch Events](https://konvajs.org/docs/events/Mobile_Events.html)

### Hit Detection
- [Canvas Hit Detection Methods](https://joshuatz.com/posts/2022/canvas-hit-detection-methods/)
- [Medium - Hit Region Detection for Canvas](https://medium.com/@lavrton/hit-region-detection-for-html5-canvas-and-how-to-listen-to-click-events-on-canvas-shapes-815034d7e9f8)

### Lightroom UX Reference
- [Ask Tim Grey - Delete Control Point for Tone Curve](https://asktimgrey.com/2023/07/11/delete-control-point-for-tone-curve/)
- [Julieanne Kost - Tone Curve Panel in Lightroom](https://jkost.com/blog/2024/08/the-tone-curve-panel-in-lightroom-classic-2.html)
- [Mastering Lightroom - Tone Curve Panel](https://mastering-lightroom.com/tone-curve-panel-lightroom-classic/)

### Vue 3 Composables
- [DEV - Drawing in Vue Using Mousemove Event](https://dev.to/reiallenramos/drawing-in-vue-using-mousemove-event-34cg)
- [DEV - Vue3 Composition API Creating a Draggable Element](https://dev.to/dasdaniel/vue3-compisition-api-craeting-a-draggable-element-fo6)
- [Dunebook - Build a Drawing App with Vue 3 and HTML5 Canvas](https://www.dunebook.com/build-a-drawing-app-with-vue-3-and-html5-canvas/)

### Canvas Compositing
- [MDN - globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)
- [W3Schools - Canvas Compositing](https://www.w3schools.com/graphics/canvas_compositing.asp)
