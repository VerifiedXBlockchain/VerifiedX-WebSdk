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
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(base)) {
  throw new Error(`base version must be MAJOR.MINOR.PATCH without leading zeros, got ${base}`);
}
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const slug = (branch === 'HEAD' ? 'detached' : branch.split('/').pop())
  .toLowerCase()
  .replace(/[^0-9a-z-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  // An all-digit identifier may not start with 0 in semver; a letter in front
  // makes any branch name a valid alphanumeric one.
  .replace(/^(\d+)$/, 'b$1');
const sha = run('git', ['rev-parse', '--short=7', 'HEAD']);
const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']) !== '';
const version = `${base}-${slug || 'branch'}.g${sha}${dirty ? '.dirty' : ''}`;

// semver.org's prerelease grammar: dot-separated identifiers, numeric ones without leading zeros.
const identifier = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';
if (!new RegExp(`^\\d+\\.\\d+\\.\\d+-${identifier}(?:\\.${identifier})*$`).test(version)) {
  throw new Error(`${version} is not a valid semver prerelease version`);
}

const restore = () => fs.writeFileSync(manifestPath, original);
// A Ctrl-C during the build must not leave the temporary version behind:
// with a handler installed Node does not exit on the signal, and the sync
// pack below returns (its child got the signal too) before this runs.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restore();
    process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
  });
}

manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
try {
  // `npm pack` runs `prepare`, which builds lib/ first.
  const tarball = run('npm', ['pack', '--silent']).split('\n').pop();
  console.log(`${version}\n${path.join(root, tarball)}`);
} finally {
  restore();
}
