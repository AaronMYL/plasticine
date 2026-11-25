import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MigrationHow, MigrationSummary } from '../../../shared/api/migration.ts';
import { writePending } from './apply.ts';
import { IMPORTS_DIRECTORY, MIGRATION_DIRECTORY, STAGED_DIRECTORY } from './layout.ts';
import { readSummary, stageArchive } from './unpack.ts';

export async function stageForRestart(stateDirectory: string, file: string, key: Buffer | null, how: MigrationHow):
  Promise<MigrationSummary> {
  const summary = await readSummary(file, key);
  const id = `import-${randomUUID()}`;
  const staged = join(stateDirectory, MIGRATION_DIRECTORY, IMPORTS_DIRECTORY, id, STAGED_DIRECTORY);
  await mkdir(dirname(staged), { recursive: true, mode: 0o700 });
  await stageArchive({ file, key, directory: staged });
  writePending(stateDirectory, { kind: how, id, mode: summary.mode, handle: summary.handle,
    exportedAt: summary.exportedAt });
  return summary;
}
