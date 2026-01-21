# Crop/Rotate/Straighten: Canvas UI Patterns

**Date**: 2026-01-21
**Status**: Complete
**Scope**: Area 3 - Canvas rendering and UI interaction

---

## 1. Crop Overlay Rendering

### Semi-Transparent Darkened Area

```typescript
function drawCropOverlay(ctx: CanvasRenderingContext2D, cropBounds: Rectangle): void {
  const { x, y, width, height } = cropBounds
  const imageWidth = canvas.width
  const imageHeight = canvas.height

  // Semi-transparent dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(0, 0, imageWidth, imageHeight)

  // Clear crop region (reveal bright area)
  ctx.clearRect(x, y, width, height)

  // Draw crop outline
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, width, height)
}
```

### Rule of Thirds Grid

```typescript
function drawRuleOfThirds(ctx: CanvasRenderingContext2D, rect: Rectangle): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 1

  const { x, y, width: w, height: h } = rect

  // Vertical lines
  for (const vx of [x + w/3, x + 2*w/3]) {
    ctx.beginPath()
    ctx.moveTo(vx, y)
    ctx.lineTo(vx, y + h)
    ctx.stroke()
  }

  // Horizontal lines
  for (const hy of [y + h/3, y + 2*h/3]) {
    ctx.beginPath()
    ctx.moveTo(x, hy)
    ctx.lineTo(x + w, hy)
    ctx.stroke()
  }
}
```

---

## 2. Draggable Handles

### Handle Types

```typescript
enum HandleType {
  TopLeft = 'tl', Top = 't', TopRight = 'tr',
  Right = 'r', BottomRight = 'br',
  Bottom = 'b', BottomLeft = 'bl', Left = 'l',
}
```

### Hit Detection

```typescript
const HANDLE_SIZE = 8
const HIT_RADIUS = 14

function findHandleAt(x: number, y: number, crop: Rectangle): HandleType | null {
  const handles = [
    { type: HandleType.TopLeft, x: crop.x, y: crop.y },
    { type: HandleType.Top, x: crop.x + crop.width/2, y: crop.y },
    // ... 6 more
  ]

  for (const h of handles) {
    const dist = Math.sqrt((x - h.x)**2 + (y - h.y)**2)
    if (dist <= HIT_RADIUS) return h.type
  }
  return null
}
```

### Cursor Feedback

```css
.crop-canvas { cursor: default; }
.crop-canvas.dragging { cursor: grabbing; }
.crop-canvas.handle-tl, .crop-canvas.handle-br { cursor: nwse-resize; }
.crop-canvas.handle-tr, .crop-canvas.handle-bl { cursor: nesw-resize; }
.crop-canvas.handle-t, .crop-canvas.handle-b { cursor: row-resize; }
.crop-canvas.handle-l, .crop-canvas.handle-r { cursor: col-resize; }
```

---

## 3. Rotation Preview

### CSS Transform Approach (Recommended for Preview)

```vue
<div class="relative overflow-hidden">
  <img
    :src="previewUrl"
    :style="{
      transform: `rotate(${rotationDegrees}deg)`,
      transformOrigin: 'center',
    }"
  />
</div>
```

### Canvas Transform Approach (For Export)

```typescript
function drawRotatedPreview(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  degrees: number
): void {
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const radians = (degrees * Math.PI) / 180

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate(radians)
  ctx.drawImage(image, -image.width/2, -image.height/2)
  ctx.restore()
}
```

---

## 4. Straighten Tool UX

### Line Drawing Interface

```typescript
const lineStart = ref<Point | null>(null)
const lineEnd = ref<Point | null>(null)

function handleCanvasClick(e: MouseEvent): void {
  const coords = getCanvasCoords(e)

  if (!lineStart.value) {
    lineStart.value = coords
  } else if (!lineEnd.value) {
    lineEnd.value = coords
    // Calculate and apply angle
    const angle = calculateStraightenAngle(lineStart.value, lineEnd.value)
    editStore.setRotation({ angle, straighten: 0 })
  } else {
    // Reset for new line
    lineStart.value = coords
    lineEnd.value = null
  }
}
```

### Visual Feedback

```typescript
function drawStraightenLine(ctx: CanvasRenderingContext2D): void {
  if (!lineStart.value) return

  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  ctx.moveTo(lineStart.value.x, lineStart.value.y)
  ctx.lineTo(lineEnd.value?.x ?? lastMousePos.x, lineEnd.value?.y ?? lastMousePos.y)
  ctx.stroke()
  ctx.setLineDash([])
}
```

---

## 5. Aspect Ratio Presets UI

### Button Group

```vue
<div class="flex gap-1">
  <button
    v-for="preset in aspectPresets"
    :key="preset.label"
    :class="{ 'bg-blue-600': selected === preset.label }"
    @click="applyAspectRatio(preset)"
  >
    {{ preset.label }}
  </button>
</div>
```

### Lock/Unlock Toggle

```vue
<button
  :class="{ 'text-blue-400': isLocked }"
  @click="isLocked = !isLocked"
>
  <UIcon :name="isLocked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'" />
</button>
```

---

## 6. Composable Structure

### Pattern from useToneCurve

```typescript
export function useCropEditor(): UseCropEditorReturn {
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const cropBounds = ref<Rectangle>({ x: 0, y: 0, width: 100, height: 100 })
  const isDragging = ref(false)
  const draggedHandle = ref<HandleType | null>(null)

  function setupEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)
  }

  function render(): void {
    const ctx = canvasRef.value?.getContext('2d')
    if (!ctx) return

    drawBackground(ctx)
    drawCropOverlay(ctx, cropBounds.value)
    drawRuleOfThirds(ctx, cropBounds.value)
    drawHandles(ctx, cropBounds.value)
  }

  return {
    canvasRef,
    cropBounds,
    isDragging,
    render,
    resetCrop: () => { /* ... */ },
  }
}
```

---

## 7. Coordinate Conversion

### Canvas to Normalized

```typescript
function getCanvasCoords(e: MouseEvent): Point | null {
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
```

---

## 8. Nuxt UI 4 Components

### Available Components

- `UButton` - Primary actions
- `UIcon` - Heroicons (lock, undo, etc.)
- `USlider` - Rotation angle
- `USelect` - Aspect ratio dropdown
- `UToggle` - Lock toggle

### Slider Pattern (from EditAdjustmentSlider)

```vue
<div class="flex items-center gap-3 py-1.5">
  <span class="w-24 text-sm text-gray-400">{{ label }}</span>
  <USlider v-model="value" :min="-45" :max="45" :step="0.1" />
  <span class="w-14 text-right font-mono">{{ value.toFixed(1) }}deg</span>
</div>
```

---

## 9. Performance Considerations

### Debouncing

```typescript
const debouncedUpdate = debounce(() => {
  editStore.setCrop(cropBounds.value)
}, 50) // Fast for UI, not as fast as 60fps
```

### Layer Strategy

1. Background image (pre-rendered)
2. Darkened overlay
3. Rule of thirds grid
4. Crop outline + handles
5. Straighten line (if active)
