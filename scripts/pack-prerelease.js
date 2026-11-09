#!/usr/bin/env node
/**
 * Build and pack the SDK from the current branch under a prerelease version,
 * so each branch build has a version of its own and a consumer's build cache
 * never mistakes it for the released package or for another branch's pack:
 *
 *   npm run pack:prerelease            -> vfx-web-sdk-9.1.0-wallet-next.g3012c79.tgz
 *   npm run pack:prerelease -- 9.2.0   -> base version given explicitly
 *
 * The version is <base>-<branch>.g<short sha>, where base defaults to the
 * next minor of package.json's version. The "g" keeps a sha that is all
 * digits with a leading zero a valid semver identifier. package.json is put
 * back afterwards: nothing is committed, tagged or published.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

const manifestPath = path.join(root, 'package.json');
const original = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(original);

const [major, minor] = manifest.version.split('.').map(Number);
const base = process.argv[2] || `${major}.${minor + 1}.0`;
if (!/^\d+\.\d+\.\d+$/.test(base)) {
  throw new Error(`base version must be MAJOR.MINOR.PATCH, got ${base}`);
}
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const slug = (branch === 'HEAD' ? 'detached' : branch.split('/').pop())
  .toLowerCase()
  .replace(/[^0-9a-z-]+/g, '-')
  .replace(/^-+|-+$/g, '');
const sha = run('git', ['rev-parse', '--short=7', 'HEAD']);
const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']) !== '';
const version = `${base}-${slug || 'branch'}.g${sha}${dirty ? '.dirty' : ''}`;

manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
try {
  // `npm pack` runs `prepare`, which builds lib/ first.
  const tarball = run('npm', ['pack', '--silent']).split('\n').pop();
  console.log(`${version}\n${path.join(root, tarball)}`);
} finally {
  fs.writeFileSync(manifestPath, original);
}
