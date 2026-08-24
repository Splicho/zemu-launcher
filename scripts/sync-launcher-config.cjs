const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const launcherConfigPath = path.join(rootDir, 'src', 'config', 'launcher.ts');
const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const updateConfigPath = path.join(rootDir, 'update-config.json');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function extractField(content, field) {
  const match = content.match(new RegExp(`${field}\\s*:\\s*['"]([^'"]+)['"]`));
  return match ? match[1].trim() : null;
}

function normalizeProtocol(protocol) {
  const trimmed = protocol.trim();
  if (!trimmed) {
    throw new Error(
      `Invalid oauthCallbackProtocol in ${path.relative(rootDir, launcherConfigPath)}: cannot be empty.`,
    );
  }

  const scheme = trimmed.includes('://') ? trimmed.split('://')[0] : trimmed;
  const normalizedScheme = scheme.trim().replace(/[:/]+$/g, '');
  if (!normalizedScheme) {
    throw new Error(
      `Invalid oauthCallbackProtocol in ${path.relative(rootDir, launcherConfigPath)}: "${protocol}".`,
    );
  }

  return `${normalizedScheme}://`;
}

function assertSemver(version) {
  const semverRegex =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (!semverRegex.test(version)) {
    throw new Error(
      `Invalid launcher version "${version}" in ${path.relative(rootDir, launcherConfigPath)}. Use SemVer (e.g. 1.2.3).`,
    );
  }
}

function syncJsonVersion(filePath, version) {
  const parsed = JSON.parse(readUtf8(filePath));
  if (parsed.version === version) {
    return false;
  }

  parsed.version = version;
  writeUtf8(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

function syncUpdateConfig(filePath, updateBaseUrl) {
  const trimmed = updateBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error(`Invalid updateBaseUrl "${updateBaseUrl}".`);
  }

  const next = JSON.stringify({ updateBaseUrl: trimmed }, null, 2) + '\n';
  const current = existsOrEmpty(filePath);
  if (current === next) {
    return false;
  }

  writeUtf8(filePath, next);
  return true;
}

function existsOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return readUtf8(filePath);
}

function syncTauriConfig(filePath, version, oauthCallbackProtocol) {
  const parsed = JSON.parse(readUtf8(filePath));
  let changed = false;

  if (parsed.version !== version) {
    parsed.version = version;
    changed = true;
  }

  const normalizedProtocol = normalizeProtocol(oauthCallbackProtocol);
  const deepLinkScheme = normalizedProtocol.slice(0, -3);

  parsed.plugins = parsed.plugins || {};
  parsed.plugins['deep-link'] = parsed.plugins['deep-link'] || {};
  parsed.plugins['deep-link'].desktop = parsed.plugins['deep-link'].desktop || {};

  const currentSchemes = parsed.plugins['deep-link'].desktop.schemes;
  const nextSchemes = [deepLinkScheme];
  if (!Array.isArray(currentSchemes) || JSON.stringify(currentSchemes) !== JSON.stringify(nextSchemes)) {
    parsed.plugins['deep-link'].desktop.schemes = nextSchemes;
    changed = true;
  }

  if (changed) {
    writeUtf8(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  return changed;
}

function syncCargoVersion(filePath, version) {
  const current = readUtf8(filePath);
  const pattern = /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m;

  if (!pattern.test(current)) {
    throw new Error(`Could not find [package] version in ${path.relative(rootDir, filePath)}.`);
  }

  const next = current.replace(pattern, `$1${version}$2`);
  if (next === current) {
    return false;
  }

  writeUtf8(filePath, next);
  return true;
}

function main() {
  const launcherConfig = readUtf8(launcherConfigPath);
  const version = extractField(launcherConfig, 'version');
  const oauthCallbackProtocol = extractField(launcherConfig, 'oauthCallbackProtocol');
  const updateBaseUrl = extractField(launcherConfig, 'updateBaseUrl');

  if (!version) {
    throw new Error(`Could not read "version" from ${path.relative(rootDir, launcherConfigPath)}.`);
  }
  if (!oauthCallbackProtocol) {
    throw new Error(
      `Could not read "oauthCallbackProtocol" from ${path.relative(rootDir, launcherConfigPath)}.`,
    );
  }
  if (!updateBaseUrl) {
    throw new Error(
      `Could not read "updateBaseUrl" from ${path.relative(rootDir, launcherConfigPath)}.`,
    );
  }

  assertSemver(version);
  normalizeProtocol(oauthCallbackProtocol);

  const touched = [];
  if (syncJsonVersion(packageJsonPath, version)) touched.push(path.relative(rootDir, packageJsonPath));
  if (syncTauriConfig(tauriConfigPath, version, oauthCallbackProtocol))
    touched.push(path.relative(rootDir, tauriConfigPath));
  if (syncCargoVersion(cargoTomlPath, version)) touched.push(path.relative(rootDir, cargoTomlPath));
  if (syncUpdateConfig(updateConfigPath, updateBaseUrl))
    touched.push(path.relative(rootDir, updateConfigPath));

  if (touched.length === 0) {
    console.log(
      `[sync-launcher-config] already in sync (version=${version}, protocol=${normalizeProtocol(oauthCallbackProtocol)})`,
    );
    return;
  }

  console.log(
    `[sync-launcher-config] synced version=${version}, protocol=${normalizeProtocol(oauthCallbackProtocol)} -> ${touched.join(', ')}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[sync-launcher-config] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
