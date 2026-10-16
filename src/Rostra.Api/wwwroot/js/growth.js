// How the Grove grows. Kept apart from the 3D scene so pages can show the stage without loading three.js.
export const GROWTH_HOURS = 5;            // the curve's time constant: ~63% grown after 5 hours of use
export const FRUITING = 0.3;       // apples appear once the tree reaches this growth (~1.8 h)
export const growthFor = (seconds) => Math.min(0.995, Math.max(0.05, 1 - Math.exp(-(seconds / 3600) / GROWTH_HOURS)));
export const secondsForGrowth = (g) => -Math.log(1 - g) * GROWTH_HOURS * 3600;
export const STAGES = [
  { at: 0, name: 'Seedling' }, { at: 0.15, name: 'Sapling' }, { at: FRUITING, name: 'Young Tree' },
  { at: 0.6, name: 'Mature Tree' }, { at: 0.85, name: 'Ancient Tree' },
];
export const stageFor = (g) => [...STAGES].reverse().find((s) => g >= s.at);
export const nextStage = (g) => STAGES.find((s) => s.at > g) ?? null;

