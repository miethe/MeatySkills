#!/usr/bin/env node
/**
 * check-screenshots.js - Screenshot validator
 *
 * Reads screenshots.json and validates that each referenced screenshot file
 * exists relative to the project root. Reports missing screenshots and exits
 * with an error code if any required screenshots are missing.
 *
 * Usage: node check-screenshots.js [options]
 *
 * Options:
 *   --root <path>       Project root directory (default: cwd)
 *   --readme-dir <path> README system dir relative to root (default: .github/readme)
 *   --category <cat>    Check only specific category (readme, features, cli, gifs)
 *   --required-only     Only check screenshots with status != 'pending'
 *   --verbose           Show all screenshots, not just missing ones
 *   --help              Show help message
 *
 * Exit codes:
 *   0 - All required screenshots exist
 *   1 - Missing screenshots found or error
 *
 * @example
 *   node check-screenshots.js                              # Check all screenshots
 *   node check-screenshots.js --root /my/project           # Explicit root
 *   node check-screenshots.js --category readme            # Check README screenshots only
 *   node check-screenshots.js --required-only              # Skip pending screenshots
 */

import { readFileSync, statSync } from 'node:fs';
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
    category: null,
    requiredOnly: false,
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
      case '--category':
        options.category = args[++i];
        break;
      case '--required-only':
        options.requiredOnly = true;
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
check-screenshots.js - Validate screenshot files exist

Usage: node check-screenshots.js [options]

Options:
  --root <path>       Project root directory (default: cwd)
  --readme-dir <path> README system dir relative to root (default: .github/readme)
  --category <cat>    Check only specific category (readme, features, cli, gifs)
  --required-only     Only check screenshots with status != 'pending'
  --verbose, -v       Show all screenshots, not just missing ones
  --help, -h          Show this help message

Exit Codes:
  0 - All required screenshots exist
  1 - Missing screenshots found or error

Examples:
  node check-screenshots.js                              # Check all screenshots
  node check-screenshots.js --root /my/project           # Explicit root
  node check-screenshots.js --category readme            # Check README screenshots only
  node check-screenshots.js --required-only              # Skip pending screenshots
  node check-screenshots.js --verbose                    # Show status of all files
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
 * Check whether a file exists and return basic stats.
 * @param {string} filepath - Absolute path to check
 * @returns {Object} Result with exists flag and optional size/modified
 */
function checkFileExists(filepath) {
  try {
    const stats = statSync(filepath);
    return { exists: true, size: stats.size, modified: stats.mtime };
  } catch (err) {
    return { exists: false, error: err.code };
  }
}

/**
 * Format a byte count into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate static screenshots from the screenshots array in screenshots.json.
 * File paths in screenshots.json are expected to be relative to the project root.
 *
 * @param {Object} data - Full screenshots.json data
 * @param {Object} options - Validation options
 * @param {string} projectRoot - Absolute project root
 * @returns {Object} Validation results
 */
function validateScreenshots(data, options, projectRoot) {
  const results = {
    total: 0,
    checked: 0,
    found: 0,
    missing: [],
    skipped: 0,
    byCategory: {},
    byStatus: {},
  };

  const screenshots = data.screenshots || [];

  for (const screenshot of screenshots) {
    results.total++;

    if (!results.byCategory[screenshot.category]) {
      results.byCategory[screenshot.category] = { total: 0, found: 0, missing: 0 };
    }
    results.byCategory[screenshot.category].total++;

    const status = screenshot.status || 'unknown';
    results.byStatus[status] = (results.byStatus[status] || 0) + 1;

    if (options.category && screenshot.category !== options.category) {
      results.skipped++;
      continue;
    }

    if (options.requiredOnly && screenshot.status === 'pending') {
      results.skipped++;
      if (options.verbose) {
        console.log(`  [SKIP] ${screenshot.file} (pending)`);
      }
      continue;
    }

    results.checked++;

    const filepath = join(projectRoot, screenshot.file);
    const fileCheck = checkFileExists(filepath);

    if (fileCheck.exists) {
      results.found++;
      results.byCategory[screenshot.category].found++;
      if (options.verbose) {
        console.log(`  [OK] ${screenshot.file} (${formatSize(fileCheck.size)})`);
      }
    } else {
      results.missing.push({
        id: screenshot.id,
        file: screenshot.file,
        category: screenshot.category,
        status: screenshot.status,
        alt: screenshot.alt,
        notes: screenshot.notes,
        resolvedPath: filepath,
      });
      results.byCategory[screenshot.category].missing++;

      console.log(`  [MISSING] ${screenshot.file}`);
      if (options.verbose) {
        console.log(`            ID: ${screenshot.id}`);
        console.log(`            Category: ${screenshot.category}`);
        if (screenshot.notes) {
          console.log(`            Notes: ${screenshot.notes}`);
        }
      }
    }
  }

  return results;
}

/**
 * Validate GIF recordings from the gifs array in screenshots.json.
 * File paths are expected to be relative to the project root.
 *
 * @param {Object} data - Full screenshots.json data
 * @param {Object} options - Validation options
 * @param {string} projectRoot - Absolute project root
 * @returns {Object} Validation results for GIFs
 */
function validateGifs(data, options, projectRoot) {
  const results = { total: 0, checked: 0, found: 0, missing: [], skipped: 0 };

  const gifs = data.gifs || [];

  for (const gif of gifs) {
    results.total++;

    if (options.category && options.category !== 'gifs') {
      results.skipped++;
      continue;
    }

    if (options.requiredOnly && gif.status === 'pending') {
      results.skipped++;
      if (options.verbose) {
        console.log(`  [SKIP] ${gif.file} (pending GIF)`);
      }
      continue;
    }

    results.checked++;

    const filepath = join(projectRoot, gif.file);
    const fileCheck = checkFileExists(filepath);

    if (fileCheck.exists) {
      results.found++;
      if (options.verbose) {
        console.log(`  [OK] ${gif.file} (${formatSize(fileCheck.size)})`);
      }
    } else {
      results.missing.push({
        id: gif.id,
        file: gif.file,
        category: 'gifs',
        status: gif.status,
        alt: gif.alt,
        tool: gif.tool,
        sequence: gif.sequence,
        resolvedPath: filepath,
      });

      console.log(`  [MISSING] ${gif.file}`);
      if (options.verbose) {
        console.log(`            ID: ${gif.id}`);
        console.log(`            Tool: ${gif.tool}`);
        if (gif.sequence) {
          console.log(`            Steps: ${gif.sequence.length}`);
        }
      }
    }
  }

  return results;
}

/**
 * Print validation summary.
 * @param {Object} screenshotResults - Screenshot validation results
 * @param {Object} gifResults - GIF validation results
 * @param {Object} options - Print options
 */
function printSummary(screenshotResults, gifResults, options) {
  console.log('\n--- Summary ---\n');

  console.log('Screenshots:');
  console.log(`  Total:    ${screenshotResults.total}`);
  console.log(`  Checked:  ${screenshotResults.checked}`);
  console.log(`  Found:    ${screenshotResults.found}`);
  console.log(`  Missing:  ${screenshotResults.missing.length}`);
  console.log(`  Skipped:  ${screenshotResults.skipped}`);

  if (options.verbose && Object.keys(screenshotResults.byCategory).length > 0) {
    console.log('\n  By Category:');
    for (const [cat, stats] of Object.entries(screenshotResults.byCategory)) {
      console.log(`    ${cat}: ${stats.found}/${stats.total} found`);
    }
  }

  if (options.verbose && Object.keys(screenshotResults.byStatus).length > 0) {
    console.log('\n  By Status:');
    for (const [status, count] of Object.entries(screenshotResults.byStatus)) {
      console.log(`    ${status}: ${count}`);
    }
  }

  if (gifResults.total > 0) {
    console.log('\nGIFs:');
    console.log(`  Total:    ${gifResults.total}`);
    console.log(`  Checked:  ${gifResults.checked}`);
    console.log(`  Found:    ${gifResults.found}`);
    console.log(`  Missing:  ${gifResults.missing.length}`);
    console.log(`  Skipped:  ${gifResults.skipped}`);
  }

  const totalMissing = screenshotResults.missing.length + gifResults.missing.length;

  if (totalMissing > 0) {
    console.log('\n--- Missing Files ---\n');
    for (const item of [...screenshotResults.missing, ...gifResults.missing]) {
      console.log(`  ${item.file}`);
      console.log(`    ID: ${item.id}`);
      console.log(`    Category: ${item.category}`);
      console.log(`    Status: ${item.status}`);
      if (item.notes) {
        console.log(`    Notes: ${item.notes}`);
      }
      console.log('');
    }

    console.log('To capture missing screenshots:');
    console.log('  1. Start the application and navigate to the target page');
    console.log('  2. Capture using browser devtools or a screenshot tool');
    console.log('  3. Save to the correct path in your screenshots directory');
    console.log('  4. Update status in screenshots.json to "captured"');
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

  console.log('Checking screenshots...\n');

  const screenshotsPath = join(dataDir, 'screenshots.json');
  const data = loadJson(screenshotsPath);

  if (!data) {
    process.exit(1);
  }

  console.log(`  File: ${screenshotsPath}`);
  console.log(`  Version: ${data.version || 'not set'}`);
  console.log(`  Screenshots: ${data.screenshots?.length || 0}`);
  console.log(`  GIFs: ${data.gifs?.length || 0}`);

  if (options.category) {
    console.log(`  Filter: ${options.category}`);
  }
  if (options.requiredOnly) {
    console.log(`  Mode: required-only (skipping pending)`);
  }
  console.log('');

  const screenshotResults = validateScreenshots(data, options, PROJECT_ROOT);
  const gifResults = validateGifs(data, options, PROJECT_ROOT);

  printSummary(screenshotResults, gifResults, options);

  const totalMissing = screenshotResults.missing.length + gifResults.missing.length;

  if (totalMissing > 0) {
    if (options.requiredOnly) {
      console.log(`\nValidation FAILED: ${totalMissing} required screenshot(s) missing.`);
    } else {
      console.log(`\nValidation FAILED: ${totalMissing} screenshot(s) missing.`);
      console.log('Tip: Use --required-only to skip pending screenshots.');
    }
    process.exit(1);
  } else {
    console.log('\nValidation PASSED: All checked screenshots exist.');
    process.exit(0);
  }
}

main();

export { checkFileExists, validateScreenshots, validateGifs, formatSize, parseArgs };
