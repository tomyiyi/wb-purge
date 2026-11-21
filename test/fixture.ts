import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Fixture = { base: string; text: string; globalFile: string; workFile: string };

export function makeBase(options: { dangerChecker?: boolean } = {}): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'wb-purge-'));
  const dir = join(base, 'permission');
  mkdirSync(join(dir, 'work'), { recursive: true });

  const config = {
    customProfiles: {
      defaultCustomProfile: {
        displayName: '',
        shellSandbox: { enable: true, onRestrict: 'request_permission_retry_sandbox' },
        approval: {
          reviewer: 'user',
          sceneRules: {
            commandAstDangerChecker: options.dangerChecker ?? true,
            shellFileProtection: false,
            deleteToolApproval: false,
            mcpToolApproval: false,
          },
        },
        filesystem: { default: 'read_only' },
        network: { default: 'allow' },
      },
    },
    resourceAuthorization: {
      filesystem: { readWrite: [], readOnly: [] },
      network: { allow: [], deny: [] },
    },
    rules: {
      commandRules: {
        'cat *': { approval: 'allow', execEnv: 'host' },
        'rm *': { approval: 'allow', execEnv: 'host' },
      },
      mcpRules: {},
    },
    _migrationVersion: 1,
    activeProfileId: 'full_access',
    unknownFutureField: { keep: true },
  };

  const text = `${JSON.stringify(config, null, 2)}\n`;
  const globalFile = join(dir, 'global.json');
  const workFile = join(dir, 'work', 'global.json');
  writeFileSync(globalFile, text, 'utf8');
  writeFileSync(workFile, text, 'utf8');

  return { base, text, globalFile, workFile };
}
