// Process shim for browser environments
export const process = {
  env: { NODE_ENV: 'production' },
  nextTick: (fn) => Promise.resolve().then(fn),
  browser: true,
};