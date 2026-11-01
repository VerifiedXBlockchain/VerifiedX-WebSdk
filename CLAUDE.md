# VerifiedX Web SDK

TypeScript wallet and chain SDK published to npm. Versions follow Core (since 9.0.1).

## Ship

- Branches: `main` (released versions) and `testnet`. Feature PRs target `testnet`; `testnet` → `main` when the matching Core release is on mainnet.
- Non-prod: commit and push to `testnet` or a feature branch freely. CI (`coverage.yml`) runs on every push.
- Prod: `npm publish` through the manual `publish-to-npm` workflow, plus the version tag. Ask Tyler before merging to `main`, publishing or tagging.
