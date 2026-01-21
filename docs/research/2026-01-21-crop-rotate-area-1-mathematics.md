# Crop/Rotate/Straighten: Mathematics & Algorithms

**Date**: 2026-01-21
**Status**: Complete
**Scope**: Area 1 - Mathematical foundations

---

## 1. 2D Rotation Transforms

### Basic Rotation Matrix

For a point (x, y) rotated by angle theta around the origin:

```
x' = x * cos(theta) - y * sin(theta)
y' = x * sin(theta) + y * cos(theta)
```

### Rotation Around Arbitrary Pivot

To rotate around point (cx, cy):

```typescript
function rotatePoint(point: Point, pivot: Point, angleRadians: number): Point {
  const cos = Math.cos(angleRadians)
  const sin = Math.sin(angleRadians)

  // Translate to origin
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y

  // Rotate
  const rotatedX = dx * cos - dy * sin
  const rotatedY = dx * sin + dy * cos

  // Translate back
  return {
    x: rotatedX + pivot.x,
    y: rotatedY + pivot.y,
  }
}
```

---

## 2. Crop Rectangle + Rotation Interaction

### Coordinate Systems

Two coordinate systems:
- **Image space**: Original image pixels (0,0 at top-left)
- **Canvas space**: Display coordinates (rotated view)

### Converting Between Spaces

```typescript
// Canvas to image space (for crop definition)
function canvasToImage(canvasPoint: Point, imageSize: Size, angle: number): Point {
  const pivot = { x: imageSize.width / 2, y: imageSize.height / 2 }
  return rotatePoint(canvasPoint, pivot, -angle) // Reverse rotation
}

// Image to canvas space (for display)
function imageToCanvas(imagePoint: Point, imageSize: Size, angle: number): Point {
  const pivot = { x: imageSize.width / 2, y: imageSize.height / 2 }
  return rotatePoint(imagePoint, pivot, angle)
}
```

---

## 3. Aspect Ratio Constraints

### Maintaining Aspect Ratio During Resize

```typescript
function applyAspectRatio(
  rect: Rectangle,
  targetRatio: number, // width/height
  anchor: 'top-left' | 'center'
): Rectangle {
  const currentRatio = rect.width / rect.height

  if (currentRatio > targetRatio) {
    // Too wide, adjust width
    const newWidth = rect.height * targetRatio
    if (anchor === 'center') {
      return { ...rect, x: rect.x + (rect.width - newWidth) / 2, width: newWidth }
    }
    return { ...rect, width: newWidth }
  } else {
    // Too tall, adjust height
    const newHeight = rect.width / targetRatio
    if (anchor === 'center') {
      return { ...rect, y: rect.y + (rect.height - newHeight) / 2, height: newHeight }
    }
    return { ...rect, height: newHeight }
  }
}
```

### Common Aspect Ratios

```typescript
const ASPECT_PRESETS = {
  'Original': null, // Use image's aspect
  '1:1': 1,
  '4:5': 0.8,
  '16:9': 16/9,
  '3:2': 1.5,
  '4:3': 4/3,
}
```

---

## 4. Straighten Calculation

### Angle from User-Drawn Line

Given two points (the user-drawn horizon line):

```typescript
function calculateStraightenAngle(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y

  // atan2 gives angle from horizontal
  // Negate to get the rotation needed to make line horizontal
  const angleRadians = -Math.atan2(dy, dx)
  const angleDegrees = (angleRadians * 180) / Math.PI

  return angleDegrees
}
```

### Angle Normalization

```typescript
function normalizeAngle(degrees: number): number {
  let normalized = degrees % 360
  if (normalized > 180) normalized -= 360
  if (normalized < -180) normalized += 360
  return normalized
}
```

---

## 5. Bounding Box After Rotation

### Problem

When rotating an image, the axis-aligned bounding box changes size.

### Calculation

```typescript
function calculateRotatedBounds(width: number, height: number, angleRadians: number): Size {
  const cos = Math.abs(Math.cos(angleRadians))
  const sin = Math.abs(Math.sin(angleRadians))

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}
```

### Example

For a 6000x4000 image rotated 5 degrees:
- cos(5deg) = 0.9962, sin(5deg) = 0.0872
- New width = 6000 * 0.9962 + 4000 * 0.0872 = 6326 pixels
- New height = 6000 * 0.0872 + 4000 * 0.9962 = 4508 pixels

### Scale to Fill (No Black Borders)

```typescript
function calculateFillScale(
  imageSize: Size,
  containerSize: Size,
  angleRadians: number
): number {
  const rotatedBounds = calculateRotatedBounds(
    imageSize.width,
    imageSize.height,
    angleRadians
  )

  const scaleX = containerSize.width / rotatedBounds.width
  const scaleY = containerSize.height / rotatedBounds.height

  return Math.min(scaleX, scaleY)
}
```

---

## 6. Practical Implementation Notes

### Floating Point Precision

```typescript
const EPSILON = 1e-10

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}
```

### Clamping Values

```typescript
function clampCrop(crop: Rectangle, imageSize: Size): Rectangle {
  return {
    x: Math.max(0, Math.min(crop.x, imageSize.width - 1)),
    y: Math.max(0, Math.min(crop.y, imageSize.height - 1)),
    width: Math.max(1, Math.min(crop.width, imageSize.width - crop.x)),
    height: Math.max(1, Math.min(crop.height, imageSize.height - crop.y)),
  }
}
```

### Minimum Crop Size

```typescript
const MIN_CROP_SIZE = 10 // pixels
```

---

## References

- [MDN: atan2](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/atan2)
- [Canvas API Transformations](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D#transformations)
- [CSS Transform](https://developer.mozilla.org/en-US/docs/Web/CSS/transform)
