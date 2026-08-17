// Tiny active diagnostics feature.
// CSS reads safe-area env() directly; this only records standalone/safe-area
// context for runtime snapshots.
export function createFeature() {
  return {
    name: 'safe-area',
    mount(ctx) {
      updateSafeArea(ctx);
    },
    refresh(ctx) {
      updateSafeArea(ctx);
    },
    unmount() {}
  };
}

function updateSafeArea(ctx) {
  ctx.state.safeArea = {
    env: 'css-env',
    standalone: ctx.viewport?.standalone === true
  };
}
