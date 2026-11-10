import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');

export const readCatalog = (path) => parseYaml(readFileSync(path, 'utf8')) ?? {};
