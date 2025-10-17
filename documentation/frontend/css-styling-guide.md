# Pankha CSS Styling Guide

Complete guide to the Pankha Design System - a token-based CSS architecture for maintainable, scalable styling.

## Table of Contents
- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Design Tokens](#design-tokens)
- [Component Files](#component-files)
- [Making Changes](#making-changes)
- [Best Practices](#best-practices)

---

## Overview

The Pankha Design System uses a **token-based architecture** where all design decisions (colors, spacing, typography) are defined once and referenced throughout the application.

### Key Benefits
- ✅ **Consistency**: Single source of truth for all design values
- ✅ **Maintainability**: Change once, update everywhere
- ✅ **Scalability**: Easy to add new components without conflicts
- ✅ **Theme Support**: Built-in dark/light mode (dark is default)
- ✅ **No Magic Numbers**: All values use semantic variables

---

## Directory Structure

```
frontend/src/styles/
├── tokens/              # Design tokens (foundation)
│   ├── colors.css       # Color palette and theme colors
│   ├── typography.css   # Font families, sizes, weights
│   ├── spacing.css      # Spacing scale, radius, shadows
│   └── semantic.css     # Contextual token mappings
├── base/                # Base styles
│   ├── reset.css        # CSS reset/normalize
│   ├── global.css       # Global element styles
│   └── responsive.css   # Responsive design breakpoints
├── components/          # Component-specific styles
│   ├── buttons.css      # Button variants
│   ├── cards.css        # Card components
│   ├── forms.css        # Form elements
│   ├── dashboard.css    # Dashboard layout
│   ├── sensors-fans.css # Sensors & fans UI
│   ├── badges.css       # Badges & status
│   └── profile-editor.css # Profile editor modal
└── index.css            # Main entry point (imports all)
```

---

## Design Tokens

Design tokens are CSS variables defined in `tokens/` that represent fundamental design decisions.

### `tokens/colors.css`

**Contains**: Brand colors, status colors, neutral palette, temperature status colors

**Key Variables**:
- `--color-primary`, `--color-success`, `--color-warning`, `--color-error`
- `--neutral-50` through `--neutral-900` (dark mode is default)
- `--temp-normal-*`, `--temp-caution-*`, `--temp-warning-*`, `--temp-critical-*`

**Theme Support**: `:root` for dark mode (default), `[data-theme="light"]` for light mode

**Edit When**: Changing brand colors, adding new status types, adjusting theme colors

---

### `tokens/typography.css`

**Contains**: Font families, sizes, weights, line heights

**Key Variables**:
- `--font-primary`, `--font-mono`
- `--font-size-xs` through `--font-size-3xl` (em-based scale)
- `--font-weight-normal` through `--font-weight-bold`
- `--line-height-tight`, `--line-height-normal`, `--line-height-relaxed`

**Edit When**: Adding custom fonts, adjusting font scale, changing typography system

---

### `tokens/spacing.css`

**Contains**: Spacing scale, border radius, shadow elevation

**Key Variables**:
- `--spacing-xs` through `--spacing-5xl` (8px base scale)
- `--radius-sm` through `--radius-circle`
- `--shadow-sm` through `--shadow-xl`

**Edit When**: Adjusting spacing values, changing border radius, modifying elevation system

---

### `tokens/semantic.css`

**Contains**: Contextual mappings that reference base tokens

**Key Variables**:
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-hover`, `--bg-active`
- `--text-primary`, `--text-secondary`, `--text-tertiary`
- `--border-color`, `--border-light`
- `--shadow`, `--shadow-hover`

**Edit When**: Adjusting semantic meaning of tokens, creating new contextual categories

---

## Component Files

### Base Styles

#### `base/reset.css`
**Purpose**: CSS reset/normalize
**Edit When**: Rarely. Only for fundamental browser resets.

#### `base/global.css`
**Purpose**: Global styles for `body`, headings, links, utility classes
**Edit When**: Adjusting default element styles, adding global utilities

#### `base/responsive.css`
**Purpose**: Mobile/tablet responsive overrides (`@media (max-width: 768px)`)
**Edit When**: Adding breakpoints, adjusting mobile layouts

---

### Components

#### `components/buttons.css`
**Contains**: All button variants (primary, danger, success, secondary, icon buttons)
**Classes**: `.refresh-button`, `.emergency-button`, `.delete-button`, `.theme-toggle`, etc.
**Edit When**: Adding new button variants, adjusting button styles globally

#### `components/cards.css`
**Contains**: Card-based UI (system cards, stat cards, profile cards, empty states)
**Classes**: `.system-card`, `.stat-card`, `.profile-card`, `.no-systems`, etc.
**Edit When**: Adding new card types, adjusting card layouts

#### `components/forms.css`
**Contains**: Form elements (inputs, selects, textareas, sliders, checkboxes)
**Classes**: `.form-group`, `.speed-slider`, `.refresh-rate-dropdown`, etc.
**Edit When**: Adjusting form field styles, adding custom form components

#### `components/dashboard.css`
**Contains**: Dashboard layout, header, navigation, loading states
**Classes**: `.dashboard`, `.dashboard-header`, `.nav-tabs`, `.spinner`, etc.
**Edit When**: Adjusting dashboard layout, modifying navigation

#### `components/sensors-fans.css`
**Contains**: Sensor cards, temperature displays, fan controls, grouping
**Classes**: `.sensor-item`, `.temperature`, `.fan-item`, `.sensor-group`, etc.
**Edit When**: Adjusting sensor/fan layouts, changing temperature color coding

#### `components/badges.css`
**Contains**: Status badges and indicators
**Classes**: `.status-badge`, `.status-indicator`, `.badge`, etc.
**Edit When**: Adding new status types, adjusting badge appearance

#### `components/profile-editor.css`
**Contains**: Fan profile editor modal, preset cards, curve editor
**Classes**: `.fan-profile-editor`, `.preset-card`, `.curve-editor`, etc.
**Edit When**: Adjusting modal layout, modifying profile editor components

---

## Making Changes

### Example 1: Change Primary Color

```css
/* Edit: tokens/colors.css */
--color-primary: #4CAF50;  /* Changed from #2196F3 */
--color-primary-hover: #45a049;
```
**Result**: All buttons, links, accents update automatically

---

### Example 2: Increase Card Padding

```css
/* Option A: Edit the component */
/* File: components/cards.css */
.system-card {
  padding: var(--spacing-2xl);  /* Changed from var(--spacing-xl) */
}

/* Option B: Edit the token itself */
/* File: tokens/spacing.css */
--spacing-xl: 24px;  /* Changed from 20px */
```

---

### Example 3: Add New Button Variant

```css
/* File: components/buttons.css */
.warning-button {
  background-color: var(--color-warning);
  color: white;
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-sm);
}

.warning-button:hover {
  background-color: var(--color-warning-hover);
}
```

Then use in component:
```tsx
<button className="warning-button">Warning Action</button>
```

---

### Example 4: Create New Status Color

```css
/* Step 1: Add to tokens/colors.css */
--temp-maintenance-bg: rgba(156, 39, 176, 0.15);
--temp-maintenance-border: #9C27B0;
--temp-maintenance-text: #7B1FA2;

/* Step 2: Add styles in components/sensors-fans.css */
.sensor-item.temperature-maintenance {
  background-color: var(--temp-maintenance-bg);
  border-left-color: var(--temp-maintenance-border);
}

.temperature.temperature-maintenance {
  color: var(--temp-maintenance-text);
}
```

---

### Example 5: Adjust Dark Mode Background

```css
/* File: tokens/semantic.css */
:root {
  --bg-primary: #0a0a0a;  /* Darker than default #1a1a1a */
}
```

---

## Best Practices

### DO ✅

**1. Always Use CSS Variables**
```css
/* Good */
padding: var(--spacing-lg);
color: var(--text-primary);

/* Bad */
padding: 16px;
color: #ffffff;
```

**2. Reference Semantic Tokens When Possible**
```css
/* Good */
background: var(--bg-secondary);
color: var(--text-secondary);

/* Avoid (use semantic instead) */
background: var(--neutral-50);
color: var(--neutral-600);
```

**3. Keep Components Isolated**
- Each component file contains only its related styles
- Don't mix dashboard styles with button styles

**4. Follow Naming Conventions**
- Component classes: `.component-name`
- Element classes: `.component-name__element`
- Modifier classes: `.component-name--modifier`
- State classes: `.is-active`, `.is-disabled`

---

### DON'T ❌

**1. Hardcode Values**
```css
/* Bad */
padding: 20px;
color: #2196F3;
box-shadow: 0 2px 4px rgba(0,0,0,0.1);

/* Good */
padding: var(--spacing-xl);
color: var(--color-primary);
box-shadow: var(--shadow-sm);
```

**2. Use !important**
Exception: Only for utility classes that absolutely must override

**3. Duplicate Styles**
If two components share styles, extract to tokens or create shared class

**4. Nest Too Deeply**
```css
/* Bad - overly specific */
.dashboard .systems-grid .system-card .sensor-item .temperature { }

/* Good - flat and maintainable */
.temperature { }
```

**5. Mix Concerns**
- Don't put layout values in color tokens
- Don't put component-specific colors in global tokens
- Keep tokens generic, components specific

---

## Quick Reference

### Most Commonly Used Tokens

```css
/* Spacing */
gap: var(--spacing-md);
padding: var(--spacing-lg);
margin-bottom: var(--spacing-xl);

/* Colors */
background: var(--bg-secondary);
color: var(--text-primary);
border: 1px solid var(--border-color);

/* Typography */
font-size: var(--font-size-base);
font-weight: var(--font-weight-medium);
line-height: var(--line-height-normal);

/* Borders & Shadows */
border-radius: var(--radius-lg);
box-shadow: var(--shadow);

/* Status Colors */
color: var(--color-success);
background: var(--temp-normal-bg);
border-color: var(--temp-warning-border);
```

---

## File Import Order

The `styles/index.css` imports files in this specific order:

```css
/* 1. Design Tokens (Foundation) */
@import './tokens/colors.css';
@import './tokens/spacing.css';
@import './tokens/typography.css';
@import './tokens/semantic.css';

/* 2. Base Styles */
@import './base/reset.css';
@import './base/global.css';

/* 3. Components */
@import './components/buttons.css';
@import './components/cards.css';
@import './components/forms.css';
@import './components/dashboard.css';
@import './components/sensors-fans.css';
@import './components/badges.css';
@import './components/profile-editor.css';

/* 4. Responsive Design */
@import './base/responsive.css';
```

**Why This Order**:
1. Tokens first (define all variables)
2. Base styles (resets and globals)
3. Components (specific UI elements)
4. Responsive last (overrides for smaller screens)

---

## Workflow

### Adding a New Component

1. **Check if existing component can be extended**
2. **Create styles in appropriate file** (or create new file in `components/`)
3. **Use existing tokens** (avoid creating component-specific tokens)
4. **Add to index.css** if new file created
5. **Test in both themes** (dark and light)

### Modifying Existing Styles

1. **Locate the component file** (check `components/` directory)
2. **Find the class** (use browser DevTools or search)
3. **Edit using tokens** (avoid hardcoded values)
4. **Test changes** (check for unintended side effects)

### Creating New Token

1. **Determine category** (color, spacing, typography, semantic?)
2. **Add to appropriate file** in `tokens/`
3. **Consider theme support** (does it need light/dark variants?)
4. **Document usage** (add comment explaining purpose)
5. **Use in components** (reference the new token)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Changes not appearing | Clear browser cache (Ctrl+Shift+R) |
| Token undefined error | Check token exists in file and `index.css` imports it |
| Styles conflicting | Check CSS specificity with browser DevTools |
| Dark mode not working | Verify `[data-theme="dark"]` on `<html>` element |
| Build errors | Check for syntax errors in CSS files |

---

## Summary

**Files**: 12 organized CSS files (1,977 lines)
**Tokens**: 4 categories (colors, spacing, typography, semantic)
**Components**: 7 categories (buttons, cards, forms, dashboard, sensors-fans, badges, profile-editor)
**Themes**: Dark mode default, light mode supported
**Coverage**: 100% token-based, zero hardcoded values

**Core Principle**: Define once in tokens, reference everywhere in components.

---

**Last Updated**: 2025-10-04
**License**: AGPL-3.0
