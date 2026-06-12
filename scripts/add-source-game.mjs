import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSourceLibraryObject } from './validate-source-library.mjs';

/**
 * Authoring helper for source libraries. Given a direct download URL and a few
 * fields, it downloads the file, computes the SHA-256 and size the schema
 * requires for `http` sources, and prints a ready-to-paste catalog entry. With
 * `--into <library.json>` it inserts the entry and re-validates the whole file.
 *
 * Usage:
 *   npm run source:add -- --url <download-url> --platform <id> --title "<name>" [options]
 *
 * Options:
 *   --url        Direct download URL to the game file (required). Must end in a
 *                supported extension; the file itself is downloaded and hashed.
 *   --platform   Platform id, e.g. nes, snes, n64, gba, ps2, psp (required).
 *   --title      Display title (required).
 *   --id         Catalog id (default: slug of the title).
 *   --profile    Setup profile id (default: the platform's built-in profile).
 *   --developer  Developer/author name (optional metadata).
 *   --genres     Comma-separated genres (optional metadata).
 *   --year       Release year (optional metadata).
 *   --magnet     Treat --url as a magnet link: emit a `magnet` source (no hash).
 *   --into       Path to an existing library JSON to append the entry into.
 */

const PLATFORM_DEFAULTS = {
  nes: { profile: 'nes-mesen', extensions: ['.nes'] },
  snes: { profile: 'snes-mesen', extensions: ['.sfc', '.smc'] },
  n64: { profile: 'n64-rmg', extensions: ['.z64', '.n64', '.v64'] },
  gba: { profile: 'gba-mgba', extensions: ['.gba'] },
  ps2: { profile: 'ps2-pcsx2', extensions: ['.iso', '.chd'] },
  psp: { profile: 'psp-ppsspp', extensions: ['.iso', '.cso'] },
  ps1: { profile: 'ps1-manual', extensions: ['.cue', '.bin', '.iso', '.pbp', '.chd'] },
  switch: { profile: 'switch-manual', extensions: ['.nsp', '.xci'] }
};

export async function buildGameEntry(options) {
  const platformDefaults = PLATFORM_DEFAULTS[options.platform];
  if (!platformDefaults) {
    throw new Error(
      `Unknown platform "${options.platform}". Known: ${Object.keys(PLATFORM_DEFAULTS).join(', ')}.`
    );
  }

  const title = required(options.title, '--title');
  const url = required(options.url, '--url');
  const id = options.id?.trim() || slugify(title);
  const profile = options.profile?.trim() || platformDefaults.profile;
  const extension = extensionFromUrl(url) ?? platformDefaults.extensions[0];
  const expectedExtensions = platformDefaults.extensions.includes(extension)
    ? platformDefaults.extensions
    : [extension];

  let download;
  if (options.magnet) {
    download = { kind: 'magnet', uri: url };
  } else {
    const { sha256, sizeBytes } = await hashRemoteFile(url);
    download = { kind: 'http', url, sha256, sizeBytes };
  }

  const metadata = buildMetadata(options);

  const entry = {
    id,
    platform: options.platform,
    title,
    contentMode: 'downloadable',
    setupProfileId: profile,
    ...(metadata ? { metadata } : {}),
    downloads: [download],
    expectedExtensions
  };

  return entry;
}

async function hashRemoteFile(url) {
  process.stderr.write(`Downloading ${url} ...\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Download produced 0 bytes for ${url}`);
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  process.stderr.write(`Hashed ${buffer.length} bytes -> ${sha256}\n`);
  return { sha256, sizeBytes: buffer.length };
}

function buildMetadata(options) {
  const metadata = {};
  if (options.developer) metadata.developer = options.developer;
  if (options.year) {
    const year = Number.parseInt(options.year, 10);
    if (Number.isFinite(year)) metadata.releaseYear = year;
  }
  if (options.genres) {
    const genres = options.genres.split(',').map((value) => value.trim()).filter(Boolean);
    if (genres.length > 0) metadata.genres = genres;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

async function appendIntoLibrary(libraryPath, entry) {
  const resolved = path.resolve(libraryPath);
  const raw = await readFile(resolved, 'utf8');
  const library = JSON.parse(raw);
  if (!Array.isArray(library.catalog)) {
    throw new Error(`${libraryPath} does not look like a source library (missing catalog array).`);
  }
  if (library.catalog.some((game) => game.id === entry.id)) {
    throw new Error(`Catalog already contains a game with id "${entry.id}".`);
  }
  library.catalog.push(entry);

  const report = validateSourceLibraryObject(library, { filePath: resolved });
  if (report.errors.length > 0) {
    throw new Error(`Validation failed after appending:\n  ${report.errors.join('\n  ')}`);
  }

  await writeFile(resolved, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
  for (const warning of report.warnings) {
    process.stderr.write(`[warn] ${warning}\n`);
  }
  process.stderr.write(`[ok] appended "${entry.id}" to ${path.relative(process.cwd(), resolved)}\n`);
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'game';
}

function required(value, flag) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Missing required ${flag}.`);
  return trimmed;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'magnet') {
      options.magnet = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Flag --${key} expects a value.`);
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (!options.url || !options.platform || !options.title) {
    process.stderr.write(
      'Usage: npm run source:add -- --url <url> --platform <id> --title "<name>" ' +
        '[--id x] [--profile x] [--developer x] [--genres "a,b"] [--year 2020] ' +
        '[--magnet] [--into examples/repositories/homebrew-library.json]\n'
    );
    process.exitCode = 2;
    return;
  }

  try {
    const entry = await buildGameEntry(options);
    if (options.into) {
      await appendIntoLibrary(options.into, entry);
    } else {
      process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectRun()) {
  await runCli();
}
