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
});
