#!/usr/bin/env node
/**
 * Auto-detect GPU and run Tauri with appropriate features
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get the command (dev or build)
const command = process.argv[2];
if (!command || !['dev', 'build'].includes(command)) {
  console.error('Usage: node tauri-auto.js [dev|build]');
  process.exit(1);
}

// Detect GPU feature
let feature = '';

// Check for environment variable override first
if (process.env.TAURI_GPU_FEATURE) {
  feature = process.env.TAURI_GPU_FEATURE;
  console.log(`🔧 Using forced GPU feature from environment: ${feature}`);
} else {
  try {
    const result = execSync('node scripts/auto-detect-gpu.js', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit']
    });
    feature = result.trim();
  } catch (err) {
    // If detection fails, continue with no features
  }
}

console.log(''); // Empty line for spacing

// Platform-specific environment variables
const platform = os.platform();
const env = { ...process.env };
const repoRoot = path.resolve(__dirname, '..', '..');
const helperProfile = command === 'build' ? 'release' : 'debug';
const architecture = os.arch() === 'arm64' ? 'aarch64' : 'x86_64';
const suffix = platform === 'win32'
  ? 'pc-windows-msvc.exe'
  : platform === 'darwin'
    ? 'apple-darwin'
    : 'unknown-linux-gnu';

function buildAndBundleRustBin(crateDir, binName, envVar) {
  const manifest = path.join(repoRoot, crateDir, 'Cargo.toml');
  const exeName = platform === 'win32' ? `${binName}.exe` : binName;
  const builtPath = path.join(repoRoot, crateDir, 'target', helperProfile, exeName);
  const bundledPath = path.join(
    repoRoot,
    'frontend',
    'src-tauri',
    'binaries',
    `${binName}-${architecture}-${suffix}`
  );

  console.log(`Building ${binName} sidecar...`);
  execSync(
    `cargo build --manifest-path "${manifest}"${command === 'build' ? ' --release' : ''}`,
    { stdio: 'inherit', env }
  );
  fs.copyFileSync(builtPath, bundledPath);
  if (envVar) env[envVar] = builtPath;
}

buildAndBundleRustBin('shenava-helper', 'shenava-helper', 'SHENAVA_HELPER_PATH');
buildAndBundleRustBin('pairing-host', 'miting-pairing-host');

if (platform === 'linux' && feature === 'cuda') {
  console.log('🐧 Linux/CUDA detected: Setting CMAKE flags for NVIDIA GPU');
  env.CMAKE_CUDA_ARCHITECTURES = '75';
  env.CMAKE_CUDA_STANDARD = '17';
  env.CMAKE_POSITION_INDEPENDENT_CODE = 'ON';
}

// Build the tauri command
let tauriCmd = `tauri ${command}`;
if (feature && feature !== 'none') {
  tauriCmd += ` -- --features ${feature}`;
  console.log(`🚀 Running: tauri ${command} with features: ${feature}`);
} else {
  console.log(`🚀 Running: tauri ${command} (CPU-only mode)`);
}
console.log('');

// Execute the command
try {
  execSync(tauriCmd, { stdio: 'inherit', env });
} catch (err) {
  process.exit(err.status || 1);
}
