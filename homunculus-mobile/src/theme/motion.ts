// The project skill (.agents/skills/homunculus-mobile-dev/SKILL.md) fixes one spring for the whole
// app. Linear transitions are not used anywhere: a ward screen that eases linearly reads as a
// spreadsheet, and the physical feel is the point.
export const SPRING = { damping: 15, mass: 0.8, stiffness: 120 } as const;

export const SPRING_TRANSITION = { type: "spring", ...SPRING } as const;

/** Pressed scale for cards and touchables. */
export const PRESS_SCALE = 0.97;

/** Critical-state glow: slow enough to read as breathing, not as a strobe. */
export const GLOW_DURATION_MS = 1400;
