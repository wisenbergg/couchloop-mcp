import { describe, it, expect, afterEach } from 'vitest';
import { AutoBackup } from '../../src/developer/backup/auto-backup.js';

describe('AutoBackup degrades gracefully on read-only / hosted filesystems', () => {
  afterEach(() => {
    delete process.env.BACKUP_DISABLED;
  });

  it('disables itself and no-ops instead of erroring when the runtime is read-only', async () => {
    process.env.BACKUP_DISABLED = '1';
    const backup = new AutoBackup();

    // createBackup must not throw or attempt fs writes — it returns a clean failure.
    const created = await backup.createBackup('/some/file.ts', 'overwrite');
    expect(created.success).toBe(false);
    expect(created.error).toMatch(/disabled/i);

    // Read paths are safe no-ops so callers (e.g. the status tool) don't crash.
    expect(await backup.listBackups()).toEqual([]);

    const rolledBack = await backup.rollback('does-not-exist');
    expect(rolledBack.success).toBe(false);
  });
});
