#!/usr/bin/env node
/**
 * validate-links.js - Link checker for README.md
 *
 * Reads README.md (or any specified file) and validates all markdown links.
 * Checks internal file references exist and reports broken links.
 *
 * Usage: node validate-links.js [options]
 *
 * Options:
 *   --root <path>       Project root directory (default: cwd)
 *   --readme-dir <path> README system dir relative to root (default: .github/readme)
 *   --file <path>       Path to markdown file to check (default: <root>/README.md)
 *   --check-external    Also validate external URLs (slower, requires network)
 *   --verbose           Show all links, not just broken ones
 *   --help              Show help message
 *
 * Exit codes:
 *   0 - All links valid
 *   1 - Broken links found or error
 *
 * @example
 *   node validate-links.js                          # Check project README
 *   node validate-links.js --root /my/project       # Explicit root
 *   node validate-links.js --verbose                # Show all links
 *   node validate-links.js --check-external         # Also check URLs
 */

import { readFileSync, accessSync, constants, existsSync } from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    root: null,
    readmeDir: null,
    file: null,
    checkExternal: false,
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
      case '--file':
        options.file = args[++i];
        break;
      case '--check-external':
        options.checkExternal = true;
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
validate-links.js - Validate links in a markdown file

Usage: node validate-links.js [options]

Options:
  --root <path>       Project root directory (default: cwd)
  --readme-dir <path> README system dir relative to root (default: .github/readme)
  --file <path>       Path to markdown file to check (default: <root>/README.md)
  --check-external    Also validate external URLs (slower, requires network)
  --verbose, -v       Show all links, not just broken ones
  --help, -h          Show this help message

Exit Codes:
  0 - All links valid
  1 - Broken links found or error

Examples:
  node validate-links.js                          # Check project README
  node validate-links.js --root /my/project       # Explicit root
  node validate-links.js --verbose                # Show all links with status
  node validate-links.js --check-external         # Also validate external URLs
`);
}

/**
 * Extract all markdown links from content.
 * Handles both inline [text](url) and reference-style [text][ref] / [ref]: url links.
 *
 * @param {string} content - Markdown content
 * @returns {Array<Object>} Array of link objects with text, url, line
 */
function extractLinks(content) {
  const links = [];
  const lines = content.split('\n');

  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const refDefPattern = /^\[([^\]]+)\]:\s*(.+)$/;
  const refUsePattern = /\[([^\]]*)\]\[([^\]]+)\]/g;

  // First pass: collect reference definitions
  const references = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(refDefPattern);
    if (match) {
      references.set(match[1].toLowerCase(), { url: match[2].trim(), line: i + 1 });
    }
  }

  // Second pass: extract link uses
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;

    linkPattern.lastIndex = 0;
    while ((match = linkPattern.exec(line)) !== null) {
      links.push({ text: match[1], url: match[2], line: i + 1, type: 'inline' });
    }

    refUsePattern.lastIndex = 0;
    while ((match = refUsePattern.exec(line)) !== null) {
      const refKey = (match[2] || match[1]).toLowerCase();
      const ref = references.get(refKey);

      if (ref) {
        links.push({ text: match[1], url: ref.url, line: i + 1, type: 'reference', refLine: ref.line });
      } else {
        links.push({
          text: match[1],
          url: `[undefined reference: ${refKey}]`,
          line: i + 1,
          type: 'reference',
          broken: true,
          reason: `Reference "${refKey}" not defined`,
        });
      }
    }
  }

  return links;
}

/**
 * Extract image references from content.
 * @param {string} content - Markdown content
 * @returns {Array<Object>} Array of image objects
 */
function extractImages(content) {
  const images = [];
  const lines = content.split('\n');
  const imgPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    imgPattern.lastIndex = 0;
    while ((match = imgPattern.exec(line)) !== null) {
      images.push({ alt: match[1], url: match[2], line: i + 1, type: 'image' });
    }
  }

  return images;
}

/**
 * Check whether a local file path exists.
 * Anchor-only links (#fragment) are treated as always valid.
 *
 * @param {string} url - File path (relative or absolute)
 * @param {string} baseDir - Base directory for relative paths
 * @returns {Object} Validation result
 */
function checkLocalPath(url, baseDir) {
  if (url.startsWith('#')) {
    return { valid: true, type: 'anchor' };
  }

  const urlWithoutAnchor = url.split('#')[0];
  if (!urlWithoutAnchor) {
    return { valid: true, type: 'anchor' };
  }

  const resolvedPath = isAbsolute(urlWithoutAnchor)
    ? urlWithoutAnchor
    : join(baseDir, urlWithoutAnchor);

  try {
    accessSync(resolvedPath, constants.R_OK);
    return { valid: true, type: 'local', path: resolvedPath };
  } catch {
    return { valid: false, type: 'local', path: resolvedPath, reason: 'File not found' };
  }
}

/**
 * Check if an external URL is reachable via a HEAD request.
 * @param {string} url - URL to check
 * @returns {Promise<Object>} Validation result
 */
function checkExternalUrl(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      const req = client(url, { method: 'HEAD', timeout: 10000 }, (res) => {
        const valid = res.statusCode >= 200 && res.statusCode < 400;
        resolve({
          valid,
          type: 'external',
          statusCode: res.statusCode,
          reason: valid ? null : `HTTP ${res.statusCode}`,
        });
      });

      req.on('error', (err) => {
        resolve({ valid: false, type: 'external', reason: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ valid: false, type: 'external', reason: 'Request timeout' });
      });

      req.end();
    } catch (err) {
      resolve({ valid: false, type: 'external', reason: `Invalid URL: ${err.message}` });
    }
  });
}

/**
 * Determine whether a URL is external (http/https/protocol-relative).
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isExternalUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
}

/**
 * Validate all links and images in a markdown file.
 * @param {string} filepath - Absolute path to the markdown file
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} Validation results
 */
async function validateLinks(filepath, options) {
  let content;
  try {
    content = readFileSync(filepath, 'utf8');
  } catch (err) {
    console.error(`Error reading file: ${err.message}`);
    process.exit(1);
  }

  const baseDir = dirname(filepath);
  const links = extractLinks(content);
  const images = extractImages(content);
  const allItems = [...links, ...images];

  console.log(`Found ${links.length} links and ${images.length} images\n`);

  const results = { total: allItems.length, valid: 0, broken: [], skipped: 0, external: 0 };

  for (const item of allItems) {
    if (item.broken) {
      results.broken.push(item);
      continue;
    }

    const url = item.url;

    if (isExternalUrl(url)) {
      results.external++;

      if (options.checkExternal) {
        const result = await checkExternalUrl(url);
        if (result.valid) {
          results.valid++;
          if (options.verbose) {
            console.log(`  [OK] ${url} (${result.statusCode || 'ok'})`);
          }
        } else {
          item.reason = result.reason;
          results.broken.push(item);
          console.log(`  [BROKEN] ${url}`);
          console.log(`           Line ${item.line}: ${result.reason}`);
        }
      } else {
        results.skipped++;
        if (options.verbose) {
          console.log(`  [SKIP] ${url} (external)`);
        }
      }
    } else {
      const result = checkLocalPath(url, baseDir);

      if (result.valid) {
        results.valid++;
        if (options.verbose) {
          console.log(`  [OK] ${url} (${result.type})`);
        }
      } else {
        item.reason = result.reason;
        item.resolvedPath = result.path;
        results.broken.push(item);
        console.log(`  [BROKEN] ${url}`);
        console.log(`           Line ${item.line}: ${result.reason}`);
        if (result.path) {
          console.log(`           Resolved: ${result.path}`);
        }
      }
    }
  }

  return results;
}

/**
 * Print a summary of validation results.
 * @param {Object} results - Validation results
 */
function printSummary(results) {
  console.log('\n--- Summary ---\n');
  console.log(`  Total items:    ${results.total}`);
  console.log(`  Valid:          ${results.valid}`);
  console.log(`  Broken:         ${results.broken.length}`);
  console.log(`  External:       ${results.external}`);
  console.log(`  Skipped:        ${results.skipped}`);

  if (results.broken.length > 0) {
    console.log('\n--- Broken Links ---\n');
    for (const item of results.broken) {
      const type = item.type === 'image' ? 'Image' : 'Link';
      console.log(`  ${type} on line ${item.line}:`);
      console.log(`    Text: "${item.text || item.alt || '(no text)'}"`);
      console.log(`    URL:  ${item.url}`);
      console.log(`    Reason: ${item.reason}`);
      console.log('');
    }
  }
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const PROJECT_ROOT = options.root || process.cwd();

  // --file takes precedence; fall back to <root>/README.md
  const filepath = options.file || join(PROJECT_ROOT, 'README.md');

  if (!existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    process.exit(1);
  }

  console.log(`Validating links in: ${filepath}\n`);

  if (!options.checkExternal) {
    console.log('Note: External URLs are skipped. Use --check-external to validate them.\n');
  }

  const results = await validateLinks(filepath, options);
  printSummary(results);

  if (results.broken.length > 0) {
    console.log(`\nValidation FAILED: ${results.broken.length} broken link(s) found.`);
    process.exit(1);
  } else {
    console.log('\nValidation PASSED: All links are valid.');
    process.exit(0);
  }
}

main();

export { extractLinks, extractImages, checkLocalPath, isExternalUrl, parseArgs };
