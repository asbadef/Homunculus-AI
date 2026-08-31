---
name: homunculus-mobile-dev
description: >-
  Use this skill when developing, designing, or updating the Homunculus Mobile Application (React Native/Expo).
  It enforces the premium visual guidelines (human-touch UI/UX) and strict clinical safety rules.
---

# Homunculus Mobile App Development Skill

This skill governs the development and styling of the Homunculus React Native / Expo companion app. Use this cheatsheet to implement high-fidelity, fluid layouts, custom SVG sparklines, and strict clinical "No-Orders" requirements.

---

## 1. Technical Prerequisites & Dependencies

When starting or updating mobile components, ensure these packages are installed and configured:
*   **Routing**: `expo-router`
*   **Animations**: `react-native-reanimated` (v3+), `moti` (v2+)
*   **Styling**: `nativewind` (v4), `tailwindcss`
*   **Interactions**: `expo-haptics`
*   **Visuals**: `react-native-svg`

---

## 2. Human-Touch UI/UX Standards

Do NOT generate flat, generic, or boring layouts. Adhere strictly to these design patterns:

### Color Tokens

The class names (`bg-background`, `bg-card`, `border-clinical-border`, `text-clinical-safe`, `text-clinical-warning`, `text-clinical-critical`, `text-clinical-stale`, and `text-accent`) are mandatory and unchanged. Their values are no longer hardcoded — they are now the Figma Medical UI Kit's two skins (light kit look, default; night navy switchable in Settings), joined by `bg-panel`, `bg-soft`, and the solid severity-pill colours (`sevSolid`/`sevSolidText`), all defined once in `homunculus-mobile/src/theme/palette.js` and documented in full in `docs/superpowers/specs/2026-08-31-mobile-kit-language-m6-design.md`. The palette header's layering law is normative: accent (blue) text may only sit on `panel` (or the pre-validated `background`), never on `card` or `soft`. Colours reach inline and SVG styles via `useTheme()`, never a static import. WCAG AA contrast for both skins is enforced by the contrast test in `__tests__/contrast.test.ts`.

### Spring Physics (withSpring)
Never use linear transitions. Always use spring physics for layout transitions:
```typescript
import { withSpring } from 'react-native-reanimated';

// Custom spring configuration for human feel
export const SpringConfig = {
  damping: 15,
  mass: 0.8,
  stiffness: 120,
};
```

### Card Scale Interaction (using Moti)
Wrap patient cards or touchable items in `MotiPressable` to scale down to `0.97` on tap and bounce back:
```tsx
import { MotiPressable } from 'moti/interactions';
import { useTheme } from 'homunculus-mobile/src/theme/useTheme';

export function PatientCard({ item }) {
  const theme = useTheme();
  return (
    <MotiPressable
      onPress={() => console.log('Selected patient')}
      animate={({ pressed }) => {
        'worklet';
        return {
          scale: pressed ? 0.97 : 1,
        };
      }}
      transition={{ type: 'spring', damping: 15 }}
      style={{ padding: 16, backgroundColor: theme.card, borderRadius: 12 }}
    >
      {/* Card Content */}
    </MotiPressable>
  );
}
```

---

## 3. Strict Clinical Rules

You must follow these rules without exception. Breaking them violates patient safety and legal guidelines:

1.  **No-Orders Rule**: All interactive clinical options must be suggestive, never directive.
    *   *Incorrect*: "Give IV Fluids", "Inject Vasopressors", "Order Lactate".
    *   *Correct*: "Consider IV fluid resuscitation", "Evaluate vasoactive support", "Consider repeating lactate measurement".
2.  **Staleness Badges**: Any vital sign or lab result that is older than its freshness window (e.g., Creatinine > 24 hours) must display the elapsed time explicitly in a warning badge.
3.  **HIPAA Compliance**: No Patient Health Information (PHI) like names or real IDs. Use bed names ("Bed 3-B") and gender/age details ("58yo Female").
