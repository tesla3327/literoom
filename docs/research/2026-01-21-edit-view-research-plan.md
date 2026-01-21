# Phase 8: Edit View - Research Plan

**Date**: 2026-01-21
**Status**: Research Complete

---

## Objective

Design and implement the photo editing view (Loupe/Edit mode) that allows users to:
1. View a single photo at high resolution
2. Adjust basic sliders (exposure, contrast, highlights, shadows, etc.)
3. Edit tone curve
4. Crop/rotate/straighten
5. See real-time histogram with clipping indicators

---

## Research Areas

### Area 1: Existing WASM/Rust Implementation
**Goal**: Understand what's already built in the Rust crates and WASM bindings

**Questions**:
- What fields does BasicAdjustments have?
- Is ToneCurve exposed to TypeScript?
- Is Histogram exposed to TypeScript?
- What functions exist for applying edits to pixels?
- Are there crop/transform utilities?

### Area 2: UI Component Patterns
**Goal**: Identify best Nuxt UI 4 components for edit panels

**Questions**:
- What slider components are available?
- How to build collapsible edit sections?
- Modal patterns for crop settings?
- Form layout for grouped controls?

### Area 3: Preview Canvas Architecture
**Goal**: Design the preview rendering pipeline

**Questions**:
- Canvas 2D vs WebGL for preview?
- How to debounce slider changes?
- Draft render vs full render patterns?
- Zoom/pan interaction handling?
- Filmstrip integration during edit?

### Area 4: Edit State Management
**Goal**: Design edit state storage and persistence

**Questions**:
- What does EditState look like?
- How to persist edits per asset?
- Database schema for edits?
- Copy/paste clipboard format?

### Area 5: Histogram and Clipping
**Goal**: Design histogram display with clipping overlays

**Questions**:
- Canvas rendering for histogram?
- How to compute histogram from preview?
- Overlay rendering for clipping indicators?
- Performance considerations?

---

## Research Outputs

1. `2026-01-21-edit-view-synthesis.md` - Consolidated findings
2. `2026-01-21-edit-view-plan.md` - Implementation plan

---

## Research Complete

All areas researched via parallel sub-agents. Key findings documented in synthesis.
