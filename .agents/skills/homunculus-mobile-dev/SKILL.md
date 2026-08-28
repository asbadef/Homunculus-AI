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

### Color Tokens (HSL)
Use these exact tailwind values configured in `tailwind.config.js`:
*   `bg-background`: `hsl(222, 47%, 8%)` (Deep Obsidian Slate)
*   `bg-card`: `hsl(222, 40%, 12%)` (Soft Charcoal Glass)
*   `border-clinical-border`: `hsl(217, 30%, 20%)`
*   `text-clinical-safe`: `hsl(142, 60%, 45%)` (Sage Green)
*   `text-clinical-warning`: `hsl(38, 92%, 50%)` (Amber Gold)
*   `text-clinical-critical`: `hsl(346, 84%, 55%)` (Crimson Rose)
*   `text-clinical-stale`: `hsl(215, 15%, 60%)` (Muted Grey)

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

export function PatientCard({ item }) {
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
      style={{ padding: 16, backgroundColor: 'hsl(222, 40%, 12%)', borderRadius: 12 }}
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
