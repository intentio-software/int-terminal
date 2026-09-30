#!/usr/bin/env node
// Bumps the version everywhere it is recorded. Called by semantic-release's
// prepareCmd with the next version as the first argument.
//
// Simpler than the one in Intentio Tasks, because the Rust side here is a
// single crate rather than a workspace: the version lives in
// src-tauri/Cargo.toml and is echoed in src-tauri/Cargo.lock. The lock file
// matters - leaving it behind means the first build after a release dirties
// the tree, and a dirty tree is how a release ends up not matching its tag.
const { execSync } = require('child_process');
const fs = require('fs');

const version = process.argv[2];
if (!version) {
  console.error('Usage: update-version.js <version>');
  process.exit(1);
}

// npm handles package.json and package-lock.json.
execSync(`npm version ${version} --no-git-tag-version`, { stdio: 'inherit' });

const tauriConf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
tauriConf.version = version;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');

// The crate's own version.
const manifestPath = 'src-tauri/Cargo.toml';
const manifest = fs.readFileSync(manifestPath, 'utf8');
const bumped = manifest.replace(/(^\[package\][\s\S]*?^version = ")[^"]*(")/m, `$1${version}$2`);
if (bumped === manifest) {
  console.error(`Could not find the [package] version in ${manifestPath}`);
  process.exit(1);
}
fs.writeFileSync(manifestPath, bumped);

// And where the lock file records it.
const lockPath = 'src-tauri/Cargo.lock';
if (fs.existsSync(lockPath)) {
  const lock = fs.readFileSync(lockPath, 'utf8');
  const pattern = /(\[\[package\]\]\nname = "int-terminal"\nversion = ")[^"]*(")/;
  if (!pattern.test(lock)) {
    console.warn('Warning: int-terminal not found in Cargo.lock');
  } else {
    fs.writeFileSync(lockPath, lock.replace(pattern, `$1${version}$2`));
  }
}

console.log(`Bumped all version files to ${version}`);
