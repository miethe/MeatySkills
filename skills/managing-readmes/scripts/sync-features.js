#!/usr/bin/env node
/**
 * sync-features.js - Feature sync and validation
 *
 * Validates features.json schema and structure. Checks required fields,
 * version formats, duplicate IDs, and cross-references to screenshots.json.
 * Can be extended to sync feature definitions from code annotations or
 * external sources.
 *
 * Usage: node sync-features.js [options]
 *
 * Options:
 *   --root <path>       Project root directory (default: cwd)
 *   --readme-dir <path> README system dir relative to root (default: .github/readme)
 *   --validate          Validate schema only (default behavior)
 *   --check-refs        Check that referenced screenshots exist in screenshots.json
 *   --check-pages       Check that webPage paths are valid (placeholder)
 *   --verbose           Show detailed validation output
 *   --help              Show help message
 *
 * Exit codes:
 *   0 - Validation passed
 *   1 - Validation errors found
 *
 * @example
 *   node sync-features.js                         # Basic validation
 *   node sync-features.js --root /my/project       # Explicit root
 *   node sync-features.js --check-refs             # Also check screenshot references
 *   node sync-features.js --verbose                # Detailed output
 */

import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    root: null,
    readmeDir: null,
    validate: true,
    checkRefs: false,
    checkPages: false,
    verbose: false,
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
      case '--validate':
        options.validate = true;
        break;
      case '--check-refs':
        options.checkRefs = true;
        break;
      case '--check-pages':
        options.checkPages = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
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
sync-features.js - Feature validation and sync

Usage: node sync-features.js [options]

Options:
  --root <path>       Project root directory (default: cwd)
  --readme-dir <path> README system dir relative to root (default: .github/readme)
  --validate          Validate schema only (default behavior)
  --check-refs        Check that referenced screenshots exist in screenshots.json
  --check-pages       Check that webPage paths correspond to valid routes
  --verbose, -v       Show detailed validation output
  --help, -h          Show this help message

Exit Codes:
  0 - Validation passed
  1 - Validation errors found

Schema Validation Checks:
  - Required fields: id, name, description
  - Valid version format for 'since' field
  - No duplicate feature IDs
  - Category structure validity

Examples:
  node sync-features.js                         # Basic validation
  node sync-features.js --root /my/project       # Explicit root
  node sync-features.js --check-refs             # Also check screenshot references
  node sync-features.js --verbose                # Detailed output
`);
}

/**
 * Load a JSON file with error handling.
 * @param {string} filepath - Path to JSON file
 * @returns {Object|null} Parsed JSON or null on error
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
    return null;
  }
}

/**
 * Validate a semver-like version string.
 * Accepts X.Y.Z with optional pre-release suffix (e.g. 1.2.3-beta, 0.1.0-alpha.1).
 *
 * @param {string} version - Version string
 * @returns {boolean} True if valid
 */
function isValidVersion(version) {
  const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
  return semverPattern.test(version);
}

/**
 * Validate a single feature object against the expected schema.
 * @param {Object} feature - Feature object
 * @param {string} categoryId - Parent category ID (for error messages)
 * @returns {Array<string>} Array of error messages
 */
function validateFeature(feature, categoryId) {
  const errors = [];
  const prefix = `Feature "${feature.id || 'unknown'}" in category "${categoryId}"`;

  if (!feature.id) {
    errors.push(`${prefix}: missing required field 'id'`);
  } else if (typeof feature.id !== 'string') {
    errors.push(`${prefix}: 'id' must be a string`);
  } else if (!/^[a-z0-9-]+$/.test(feature.id)) {
    errors.push(`${prefix}: 'id' should be lowercase alphanumeric with hyphens`);
  }

  if (!feature.name) {
    errors.push(`${prefix}: missing required field 'name'`);
  }

  if (!feature.description) {
    errors.push(`${prefix}: missing required field 'description'`);
  }

  if (feature.since && !isValidVersion(feature.since)) {
    errors.push(`${prefix}: invalid 'since' version format "${feature.since}"`);
  }

  if (feature.cliCommand && typeof feature.cliCommand !== 'string') {
    errors.push(`${prefix}: 'cliCommand' must be a string`);
  }

  if (feature.webPage && typeof feature.webPage !== 'string') {
    errors.push(`${prefix}: 'webPage' must be a string`);
  }

  if (feature.screenshot && typeof feature.screenshot !== 'string') {
    errors.push(`${prefix}: 'screenshot' must be a string`);
  }

  if (feature.highlight !== undefined && typeof feature.highlight !== 'boolean') {
    errors.push(`${prefix}: 'highlight' must be a boolean`);
  }

  if (feature.shortDescription && typeof feature.shortDescription !== 'string') {
    errors.push(`${prefix}: 'shortDescription' must be a string`);
  }

  return errors;
}

/**
 * Validate a category object against the expected schema.
 * @param {Object} category - Category object
 * @returns {Array<string>} Array of error messages
 */
function validateCategory(category) {
  const errors = [];
  const prefix = `Category "${category.id || 'unknown'}"`;

  if (!category.id) {
    errors.push(`${prefix}: missing required field 'id'`);
  }

  if (!category.name) {
    errors.push(`${prefix}: missing required field 'name'`);
  }

  if (!Array.isArray(category.features)) {
    errors.push(`${prefix}: 'features' must be an array`);
  }

  if (category.icon && typeof category.icon !== 'string') {
    errors.push(`${prefix}: 'icon' must be a string`);
  }

  if (category.tagline && typeof category.tagline !== 'string') {
    errors.push(`${prefix}: 'tagline' must be a string`);
  }

  return errors;
}

/**
 * Validate the entire features.json structure.
 * Checks top-level fields, each category, each feature, duplicate IDs,
 * and the optional artifactTypes and stats arrays.
 *
 * @param {Object} data - Features data
 * @returns {Object} Validation result with errors, warnings, and featureCount
 */
function validateFeaturesSchema(data) {
  const errors = [];
  const warnings = [];
  const featureIds = new Set();

  if (!data.version) {
    errors.push("Missing 'version' field at root level");
  } else if (!isValidVersion(data.version)) {
    errors.push(`Invalid version format: ${data.version}`);
  }

  if (!data.lastUpdated) {
    warnings.push("Missing 'lastUpdated' field at root level");
  }

  if (!Array.isArray(data.categories)) {
    errors.push("'categories' must be an array");
    return { errors, warnings };
  }

  for (const category of data.categories) {
    errors.push(...validateCategory(category));

    if (!Array.isArray(category.features)) continue;

    for (const feature of category.features) {
      errors.push(...validateFeature(feature, category.id));

      if (feature.id) {
        if (featureIds.has(feature.id)) {
          errors.push(`Duplicate feature ID: "${feature.id}"`);
        }
        featureIds.add(feature.id);
      }
    }
  }

  // Generic artifact types validation — no hardcoded IDs
  if (data.artifactTypes) {
    if (!Array.isArray(data.artifactTypes)) {
      errors.push("'artifactTypes' must be an array");
    } else {
      const typeIds = new Set();
      for (const type of data.artifactTypes) {
        if (!type.id) {
          errors.push("Artifact type missing 'id' field");
        } else if (typeIds.has(type.id)) {
          errors.push(`Duplicate artifact type ID: "${type.id}"`);
        } else {
          typeIds.add(type.id);
        }
      }
    }
  }

  // Generic stats validation — warn on missing numeric fields, no hardcoded keys required
  if (data.stats) {
    for (const [key, value] of Object.entries(data.stats)) {
      if (typeof value !== 'number') {
        errors.push(`Stat '${key}' must be a number`);
      }
    }
  }

  return { errors, warnings, featureCount: featureIds.size };
}

/**
 * Check that screenshot references in features.json exist in screenshots.json.
 * Compares only filenames (basename), not full paths, for portability.
 *
 * @param {Object} features - Features data
 * @param {Object} screenshots - Screenshots data
 * @returns {Array<string>} Array of error messages
 */
function checkScreenshotReferences(features, screenshots) {
  const errors = [];

  const validScreenshots = new Set();
  if (screenshots.screenshots) {
    for (const s of screenshots.screenshots) {
      if (s.file) {
        validScreenshots.add(basename(s.file));
      }
    }
  }

  for (const category of features.categories) {
    if (!Array.isArray(category.features)) continue;

    for (const feature of category.features) {
      if (feature.screenshot && !validScreenshots.has(feature.screenshot)) {
        errors.push(
          `Feature "${feature.id}" references unknown screenshot: ${feature.screenshot}`
        );
      }
    }
  }

  return errors;
}

/**
 * Print validation summary.
 * @param {Object} result - Validation result
 * @param {Object} options - Print options
 */
function printSummary(result, options) {
  console.log('\n--- Validation Summary ---\n');

  if (result.featureCount !== undefined) {
    console.log(`  Total features: ${result.featureCount}`);
  }

  console.log(`  Errors: ${result.errors.length}`);
  console.log(`  Warnings: ${result.warnings.length}`);

  if (result.errors.length > 0) {
    console.log('\n--- Errors ---\n');
    for (const error of result.errors) {
      console.log(`  [ERROR] ${error}`);
    }
  }

  if (result.warnings.length > 0 && options.verbose) {
    console.log('\n--- Warnings ---\n');
    for (const warning of result.warnings) {
      console.log(`  [WARN] ${warning}`);
    }
  }
}

function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const PROJECT_ROOT = options.root || process.cwd();
  const README_DIR = join(PROJECT_ROOT, options.readmeDir || '.github/readme');
  const dataDir = join(README_DIR, 'data');

  console.log('Validating features.json...\n');

  const featuresPath = join(dataDir, 'features.json');
  const features = loadJson(featuresPath);

  if (!features) {
    process.exit(1);
  }

  console.log(`  File: ${featuresPath}`);
  console.log(`  Version: ${features.version || 'not set'}`);
  console.log(`  Categories: ${features.categories?.length || 0}`);

  const result = validateFeaturesSchema(features);

  if (options.checkRefs) {
    console.log('\nChecking screenshot references...');
    const screenshotsPath = join(dataDir, 'screenshots.json');
    const screenshots = loadJson(screenshotsPath);

    if (screenshots) {
      const refErrors = checkScreenshotReferences(features, screenshots);
      result.errors.push(...refErrors);
      const refCount = features.categories?.reduce(
        (sum, c) => sum + (c.features?.filter((f) => f.screenshot)?.length || 0),
        0
      ) || 0;
      console.log(`  Checked ${refCount} references`);
    }
  }

  if (options.checkPages) {
    console.log('\nNote: --check-pages is a placeholder for future implementation.');
    result.warnings.push('Web page validation not yet implemented');
  }

  printSummary(result, options);

  if (result.errors.length > 0) {
    console.log(`\nValidation FAILED: ${result.errors.length} error(s) found.`);
    process.exit(1);
  } else {
    console.log('\nValidation PASSED.');
    process.exit(0);
  }
}

main();

export {
  validateFeature,
  validateCategory,
  validateFeaturesSchema,
  checkScreenshotReferences,
  isValidVersion,
  parseArgs,
};
