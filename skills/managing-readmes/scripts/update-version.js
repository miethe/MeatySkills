#!/usr/bin/env node
/**
 * update-version.js - Version updater for README data files
 *
 * Updates version.json, features.json, and screenshots.json with a new version
 * string and release date. Archives the previous version into version history.
 *
 * Usage: node update-version.js [options]
 *
 * Options:
 *   --root <path>          Project root directory (default: cwd)
 *   --readme-dir <path>    README system dir relative to root (default: .github/readme)
 *   --version <ver>        Set new version (e.g., 0.4.0, 0.4.0-beta)  [required]
 *   --release-date <date>  Set release date in YYYY-MM-DD format (default: today)
 *   --dry-run              Preview changes without writing files
 *   --help                 Show help message
 *
 * @example
 *   node update-version.js --version 0.4.0
 *   node update-version.js --root /my/project --version 0.4.0 --release-date 2026-02-15
 *   node update-version.js --version 0.4.0-beta --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    root: null,
    readmeDir: null,
    version: null,
    releaseDate: null,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--root':
        options.root = args[++i];
        break;
      case '--readme-dir':
        options.readmeDir = args[++i];
        break;
      case '--version':
        options.version = args[++i];
        break;
      case '--release-date':
        options.releaseDate = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return options;
}

/**
 * Display help message.
 */
function showHelp() {
  console.log(`
update-version.js - Update version references in README data files

Usage: node update-version.js [options]

Options:
  --root <path>          Project root directory (default: cwd)
  --readme-dir <path>    README system dir relative to root (default: .github/readme)
  --version <ver>        Set new version (e.g., 0.4.0, 0.4.0-beta)  [required]
  --release-date <date>  Set release date in YYYY-MM-DD format (default: today)
  --dry-run              Preview changes without writing files
  --help, -h             Show this help message

Examples:
  node update-version.js --version 0.4.0
  node update-version.js --root /my/project --version 0.4.0 --release-date 2026-02-15
  node update-version.js --version 0.4.0-beta --dry-run

Notes:
  - If --release-date is not provided, today's date is used
  - Version format should follow semver (e.g., 0.4.0, 0.4.0-beta, 0.4.0-alpha.1)
  - The previous version is automatically archived in version history
`);
}

/**
 * Validate a semver-like version string.
 * Accepts X.Y.Z with optional pre-release suffix.
 *
 * @param {string} version - Version string to validate
 * @returns {boolean} True if valid
 */
function isValidVersion(version) {
  const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
  return semverPattern.test(version);
}

/**
 * Validate a YYYY-MM-DD date string.
 * @param {string} date - Date string to validate
 * @returns {boolean} True if valid
 */
function isValidDate(date) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date)) return false;
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
}

/**
 * Load a JSON file with error handling.
 * Exits the process on any read or parse error.
 *
 * @param {string} filepath - Path to JSON file
 * @returns {Object} Parsed JSON data
 */
function loadJson(filepath) {
  try {
    const content = readFileSync(filepath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`File not found: ${filepath}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Invalid JSON in ${filepath}: ${err.message}`);
    } else {
      console.error(`Error loading ${filepath}: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Write JSON data to a file with 2-space indentation and trailing newline.
 * In dry-run mode, prints a truncated preview to stdout instead.
 *
 * @param {string} filepath - Destination path
 * @param {Object} data - Data to serialize
 * @param {boolean} dryRun - If true, print preview instead of writing
 */
function writeJson(filepath, data, dryRun) {
  const content = JSON.stringify(data, null, 2) + '\n';

  if (dryRun) {
    const filename = filepath.split('/').pop();
    console.log(`\n--- ${filename} (DRY RUN) ---`);
    console.log(content.slice(0, 500) + (content.length > 500 ? '\n...(truncated)' : ''));
    return;
  }

  try {
    writeFileSync(filepath, content, 'utf8');
    console.log(`  Updated: ${filepath}`);
  } catch (err) {
    console.error(`Error writing ${filepath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Increment the patch segment of a version string.
 * Pre-release suffixes are stripped before incrementing.
 *
 * @param {string} version - Current version (e.g. "1.2.3-beta")
 * @returns {string} Patch-incremented version (e.g. "1.2.4")
 */
function incrementVersion(version) {
  const base = version.replace(/-.*$/, '');
  const parts = base.split('.');

  if (parts.length >= 3) {
    parts[2] = String(parseInt(parts[2], 10) + 1);
  }

  return parts.join('.');
}

/**
 * Get today's date as a YYYY-MM-DD string in local time.
 * @returns {string} Today's date
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Update version.json:
 * - Archives the current version into previousVersions if it differs
 * - Sets current and releaseDate to new values
 * - Advances the upcoming placeholder if it matched the new version
 *
 * @param {string} newVersion - New version string
 * @param {string} releaseDate - Release date (YYYY-MM-DD)
 * @param {boolean} dryRun - If true, preview only
 * @param {string} dataDir - Absolute path to the data directory
 * @returns {Object} Updated version data
 */
function updateVersionFile(newVersion, releaseDate, dryRun, dataDir) {
  const filepath = join(dataDir, 'version.json');
  const data = loadJson(filepath);

  if (data.current && data.current !== newVersion) {
    const historyEntry = {
      version: data.current,
      releaseDate: data.releaseDate,
      highlights: [],
    };

    if (!Array.isArray(data.previousVersions)) {
      data.previousVersions = [];
    }

    const exists = data.previousVersions.some((v) => v.version === data.current);
    if (!exists) {
      data.previousVersions.unshift(historyEntry);
    }

    console.log(`  Archived version ${data.current} to history`);
  }

  data.current = newVersion;
  data.releaseDate = releaseDate;

  // Advance the upcoming placeholder when it matched the newly released version
  if (data.upcoming && data.upcoming.version === newVersion) {
    data.upcoming = { version: incrementVersion(newVersion), plannedFeatures: [] };
  }

  writeJson(filepath, data, dryRun);
  return data;
}

/**
 * Update lastUpdated and version fields in features.json.
 *
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {string} version - New version string
 * @param {boolean} dryRun - If true, preview only
 * @param {string} dataDir - Absolute path to the data directory
 */
function updateFeaturesFile(date, version, dryRun, dataDir) {
  const filepath = join(dataDir, 'features.json');
  const data = loadJson(filepath);
  data.lastUpdated = date;
  data.version = version;
  writeJson(filepath, data, dryRun);
}

/**
 * Update lastUpdated and version fields in screenshots.json.
 *
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {string} version - New version string
 * @param {boolean} dryRun - If true, preview only
 * @param {string} dataDir - Absolute path to the data directory
 */
function updateScreenshotsFile(date, version, dryRun, dataDir) {
  const filepath = join(dataDir, 'screenshots.json');
  const data = loadJson(filepath);
  data.lastUpdated = date;
  data.version = version;
  writeJson(filepath, data, dryRun);
}

function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.version) {
    console.error('Error: --version is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  if (!isValidVersion(options.version)) {
    console.error(`Error: Invalid version format: ${options.version}`);
    console.error('Version should follow semver (e.g., 0.4.0, 0.4.0-beta)');
    process.exit(1);
  }

  const releaseDate = options.releaseDate || getTodayDate();

  if (options.releaseDate && !isValidDate(options.releaseDate)) {
    console.error(`Error: Invalid date format: ${options.releaseDate}`);
    console.error('Date should be in YYYY-MM-DD format');
    process.exit(1);
  }

  const PROJECT_ROOT = options.root || process.cwd();
  const README_DIR = join(PROJECT_ROOT, options.readmeDir || '.github/readme');
  const dataDir = join(README_DIR, 'data');

  console.log('Updating version references...\n');
  console.log(`  New version: ${options.version}`);
  console.log(`  Release date: ${releaseDate}`);

  if (options.dryRun) {
    console.log('  Mode: DRY RUN (no files will be modified)\n');
  } else {
    console.log('');
  }

  updateVersionFile(options.version, releaseDate, options.dryRun, dataDir);
  updateFeaturesFile(releaseDate, options.version, options.dryRun, dataDir);
  updateScreenshotsFile(releaseDate, options.version, options.dryRun, dataDir);

  console.log('\nVersion update complete!');

  if (!options.dryRun) {
    console.log('\nNext steps:');
    console.log('  1. Run: node build-readme.js');
    console.log('  2. Review changes: git diff');
    console.log(`  3. Commit: git commit -am "chore: bump version to ${options.version}"`);
  }
}

main();

export { isValidVersion, isValidDate, incrementVersion, parseArgs };
