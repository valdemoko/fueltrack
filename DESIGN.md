# Combustible Málaga Design System

## 0. Research Log

- Embedded refs: shortlisted [linear.app, stripe, vercel] → picked redesign-skill + custom fuel-energy aesthetic because this is an existing project redesign with domain-specific visual language
- Lazyweb: Skipped — existing project with clear domain (fuel prices), no need for external research
- Imagen drafts: Skipped — user gave explicit anti-patterns and requirements, not a visual reference
- Skipped lanes: N/A — all essential lanes covered

## 1. Atmosphere & Identity

A trustworthy local utility — like a well-designed municipal service that happens to look premium. The feel is "informed confidence": you open the app, see current prices at a glance, and trust the data because the design communicates authority and precision.

**Signature**: Warm gradient accents inspired by fuel gradients (amber → deep orange) against cool neutral backgrounds. Not a tech startup — a civic tool with personality.

**Anti-patterns to avoid**:
- Generic AI gradients (blue-purple-pink)
- Inter font (overused in AI projects)
- Rounded-lg everywhere (16px radius on everything)
- Green-600 as primary (stock Tailwind feel)
- Cards that all look identical
- No visual hierarchy

## 2. Color

### Palette

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Surface/primary | --surface-primary | #FAFAF9 | Main background (warm gray) |
| Surface/secondary | --surface-secondary | #F5F5F4 | Cards, panels |
| Surface/elevated | --surface-elevated | #FFFFFF | Modals, popovers |
| Surface/dark | --surface-dark | #1C1917 | Footer, dark sections |
| Text/primary | --text-primary | #1C1917 | Headlines, body |
| Text/secondary | --text-secondary | #78716C | Captions, hints |
| Text/tertiary | --text-tertiary | #A8A29E | Disabled, muted |
| Text/inverse | --text-inverse | #FAFAF9 | Text on dark surfaces |
| Border/default | --border-default | #E7E5E4 | Dividers, outlines |
| Border/subtle | --border-subtle | #F5F5F4 | Soft separations |
| Accent/fuel | --accent-fuel | #D97706 | Primary CTA, links, focus (amber-600) |
| Accent/fuel-hover | --accent-fuel-hover | #B45309 | Hover state (amber-700) |
| Accent/fuel-light | --accent-fuel-light | #FEF3C7 | Backgrounds, highlights (amber-100) |
| Price/cheap | --price-cheap | #16A34A | Low prices (green-600) |
| Price/medium | --price-medium | #D97706 | Medium prices (amber-600) |
| Price/expensive | --price-expensive | #DC2626 | High prices (red-600) |
| Status/success | --status-success | #16A34A | Confirmations |
| Status/warning | --status-warning | #D97706 | Cautions |
| Status/error | --status-error | #DC2626 | Errors |

### Rules
- Amber/fuel color ONLY for interactive elements and CTAs
- Price colors (green/amber/red) are semantic — never decorative
- Dark surfaces only for footer and hero sections
- Never introduce a color not in this table

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Display | 40px / 2.5rem | 800 | 1.1 | Hero title |
| H1 | 32px / 2rem | 700 | 1.2 | Page titles |
| H2 | 24px / 1.5rem | 600 | 1.3 | Section headers |
| H3 | 20px / 1.25rem | 600 | 1.4 | Card titles |
| Body/lg | 18px / 1.125rem | 400 | 1.6 | Lead paragraphs |
| Body | 16px / 1rem | 400 | 1.6 | Default text |
| Body/sm | 14px / 0.875rem | 400 | 1.5 | Secondary info |
| Caption | 12px / 0.75rem | 500 | 1.4 | Labels, metadata |
| Overline | 11px / 0.6875rem | 600 | 1.3 | Section labels, uppercase |

### Font Stack
- Primary: "DM Sans", system-ui, -apple-system, sans-serif
- Mono: "JetBrains Mono", Fira Code, monospace

### Rules
- DM Sans for personality — geometric but warm, not cold like Inter
- Body text never below 14px
- Headings that wrap to 4+ lines are too large — use clamp()

## 4. Spacing & Layout

### Base Unit
All spacing derives from a base of **4px**.

| Token | Value | Usage |
|-------|-------|-------|
| --space-1 | 4px | Tight: icon-to-label |
| --space-2 | 8px | Small gaps |
| --space-3 | 12px | Default gaps |
| --space-4 | 16px | Standard padding |
| --space-5 | 20px | Section gaps |
| --space-6 | 24px | Card padding |
| --space-8 | 32px | Section spacing |
| --space-10 | 40px | Large section gaps |
| --space-12 | 48px | Page section spacing |
| --space-16 | 64px | Hero spacing |

### Grid
- Max width: 1280px (1200px content)
- Gutter: 24px (mobile: 16px)
- Breakpoints: sm=640, md=768, lg=1024, xl=1280

### Rules
- Consistent spacing — no arbitrary values
- Mobile-first: design for 375px, scale up
- Content never touches screen edges (min 16px padding)

## 5. Components

### Buttons
| Variant | Styles | Usage |
|---------|--------|-------|
| Primary | bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-6 py-3 font-semibold | Main CTAs |
| Secondary | bg-stone-100 text-stone-700 hover:bg-stone-200 rounded-lg px-6 py-3 font-semibold | Secondary actions |
| Ghost | bg-transparent text-stone-600 hover:bg-stone-100 rounded-lg px-4 py-2 | Tertiary actions |
| Small | text-sm px-4 py-2 rounded-md | Compact actions |

### Cards
| Variant | Styles | Usage |
|---------|--------|-------|
| Default | bg-white rounded-xl shadow-sm border border-stone-200 p-6 | Standard cards |
| Interactive | Same + hover:shadow-md transition | Clickable cards |
| Price | bg-white rounded-xl shadow-sm border-l-4 p-4 | Price display (border-left color = price level) |

### Form Elements
| Element | Styles |
|---------|--------|
| Input | w-full rounded-lg border border-stone-300 px-4 py-3 text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition |
| Select | Same as input + bg-white |
| Label | block text-sm font-medium text-stone-700 mb-1.5 |

## 6. Motion

### Transitions
| Token | Value | Usage |
|-------|-------|-------|
| --transition-fast | 150ms ease | Hover states |
| --transition-normal | 200ms ease | Default transitions |
| --transition-slow | 300ms ease | Page transitions |

### Rules
- Only transform and opacity for animation
- No layout property animation (width, height, margin)
- Reduced motion: respect prefers-reduced-motion

## 7. Accessibility

### Requirements
- WCAG 2.1 AA minimum
- Focus visible: 2px amber-500 ring
- Skip link for keyboard navigation
- ARIA labels on all interactive elements
- Color contrast: 4.5:1 minimum for text
- Touch targets: 44px minimum

## 8. Accepted Debt

- Map uses client-side rendering (Leaflet requirement)
- Chart.js bundle is large (~200KB) — acceptable for chart quality
- Cookie consent is custom (not CMP) — sufficient for MVP
