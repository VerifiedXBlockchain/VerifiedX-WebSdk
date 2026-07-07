// Unit tests (default): everything under src/**/__tests__/*.test.ts except
// integration/. Integration tests hit live networks (VFX testnet APIs,
// mempool.space) and are inherently non-deterministic — run them explicitly:
//   npm run test:integration        (RUN_INTEGRATION=1)
const runIntegration = process.env.RUN_INTEGRATION === '1';

module.exports = {
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: runIntegration ? ['/node_modules/'] : ['/node_modules/', '/__tests__/integration/'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};
