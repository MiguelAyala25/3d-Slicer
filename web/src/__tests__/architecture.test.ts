import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, '../core');

function getAllTsFiles(dir: string, baseDir = dir): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architecture & Core Independence (D-2, DoD-5)', () => {
  it('core files (outside build/registry.ts) do not import from core/joints/discs', () => {
    const allFiles = getAllTsFiles(CORE_DIR);
    const nonJointCoreFiles = allFiles.filter((file) => {
      const rel = path.relative(CORE_DIR, file).replace(/\\/g, '/');
      return !rel.startsWith('joints/') && rel !== 'build/registry.ts';
    });

    const violations: string[] = [];
    for (const file of nonJointCoreFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /from\s+['"][^'"]*joints\/discs/i.test(line) ||
          /import\s+['"][^'"]*joints\/discs/i.test(line)
        ) {
          violations.push(`${path.relative(CORE_DIR, file)}:${i + 1} -> ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('no disc-specific symbols exist in core outside joints directory', () => {
    const allFiles = getAllTsFiles(CORE_DIR);
    const nonJointCoreFiles = allFiles.filter((file) => {
      const rel = path.relative(CORE_DIR, file).replace(/\\/g, '/');
      return !rel.startsWith('joints/');
    });

    const forbiddenRegex = /\b(isDiscValidForGap|DiscManager|layoutDiscsIntoSheets)\b/;
    const violations: string[] = [];

    for (const file of nonJointCoreFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (forbiddenRegex.test(line)) {
          violations.push(`${path.relative(CORE_DIR, file)}:${i + 1} -> ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('core/waffle files do not import react, three, or core/joints/discs (DoD-6)', () => {
    const waffleDir = path.resolve(CORE_DIR, 'waffle');
    const files = getAllTsFiles(waffleDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /from\s+['"]react['"]/i.test(line) ||
          /from\s+['"]three['"]/i.test(line) ||
          /from\s+['"][^'"]*joints\/discs/i.test(line) ||
          /import\s+['"][^'"]*joints\/discs/i.test(line)
        ) {
          violations.push(`${path.relative(CORE_DIR, file)}:${i + 1} -> ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('core files only instantiate ValidationError with typed ErrorCode (C12 / M6)', () => {
    const allFiles = getAllTsFiles(CORE_DIR);
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = path.relative(CORE_DIR, file).replace(/\\/g, '/');
      if (rel === 'errors.ts') continue;

      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.matchAll(/new\s+ValidationError\s*\(\s*([^,\s)]+)/gs);
      for (const match of matches) {
        const firstArg = match[1];
        if (!/^'[A-Z0-9_]+'$/.test(firstArg)) {
          violations.push(`${rel} -> ${match[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('i18n/es.ts is headless and does not import react, three, or UI components (C12 / M6)', () => {
    const i18nFile = path.resolve(__dirname, '../i18n/es.ts');
    expect(fs.existsSync(i18nFile)).toBe(true);

    const content = fs.readFileSync(i18nFile, 'utf-8');
    const lines = content.split('\n');
    const violations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        /from\s+['"]react['"]/i.test(line) ||
        /from\s+['"]three['"]/i.test(line) ||
        /from\s+['"][^'"]*components/i.test(line) ||
        /import\s+['"][^'"]*components/i.test(line)
      ) {
        violations.push(`i18n/es.ts:${i + 1} -> ${line.trim()}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
