export function createLifecycle(features, options = {}) {
  const mounted = new Set();
  const reportError = typeof options.reportError === 'function'
    ? options.reportError
    : () => {};

  return {
    mount(ctx) {
      features.forEach((feature) => {
        if (mounted.has(feature.name)) return;
        try {
          feature.mount?.(ctx);
          mounted.add(feature.name);
        } catch (error) {
          reportError('mount', feature.name, error);
        }
      });
    },

    refresh(ctx) {
      features.forEach((feature) => {
        if (!mounted.has(feature.name)) return;
        try {
          feature.refresh?.(ctx);
        } catch (error) {
          reportError('refresh', feature.name, error);
        }
      });
    },

    unmount() {
      [...features].reverse().forEach((feature) => {
        if (!mounted.has(feature.name)) return;
        try {
          feature.unmount?.();
        } catch (error) {
          reportError('unmount', feature.name, error);
        } finally {
          mounted.delete(feature.name);
        }
      });
    },

    getMountedFeatureNames() {
      return features.filter((feature) => mounted.has(feature.name)).map((feature) => feature.name);
    }
  };
}
