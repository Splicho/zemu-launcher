const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const launcherConfigPath = path.join(rootDir, 'src', 'config', 'launcher.ts');

function extractVersion(content) {
  const match = content.match(/version\s*:\s*['"]([^'"]+)['"]/);
  return match ? match[1].trim() : null;
}

function resolveRefName() {
  const cliArgs = process.argv.slice(2).filter((arg) => arg && arg !== '--');
  return cliArgs[0] || process.env.GITHUB_REF_NAME;
}

function main() {
  const refName = resolveRefName();
  if (!refName) {
    throw new Error('Release tag was not provided. Pass it as an argument or set GITHUB_REF_NAME.');
  }

  const launcherConfig = fs.readFileSync(launcherConfigPath, 'utf8');
  const version = extractVersion(launcherConfig);
  if (!version) {
    throw new Error(`Could not read version from ${path.relative(rootDir, launcherConfigPath)}.`);
  }

  const expectedTag = `v${version}`;
  if (refName !== expectedTag) {
    throw new Error(`Release tag mismatch: expected ${expectedTag} but received ${refName}.`);
  }

  console.log(`[release:verify-tag] ${refName} matches launcher version ${version}`);
}

try {
  main();
} catch (error) {
  console.error(`[release:verify-tag] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
