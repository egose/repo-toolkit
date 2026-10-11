import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReleaseTagPlan, runPreflight } from '../src/index';

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('runPreflight SSH authentication (real Git)', () => {
  it.each(['core.sshCommand', 'GIT_SSH_COMMAND', 'GIT_SSH'])(
    'uses %s to access the remote without replacing the configured identity',
    async (source) => {
      const cwd = await mkdtemp(join(tmpdir(), 'release-tag-checkout-ssh-'));
      try {
        const binDir = join(cwd, 'bin');
        await mkdir(binDir);
        const remote = join(cwd, 'origin.git');
        const identity = join(cwd, 'checkout deploy key');
        const recording = join(cwd, 'ssh-invocation.json');
        const fakeSsh = join(cwd, 'checkout-ssh.cjs');
        const wrapper = join(cwd, 'checkout ssh');
        await writeFile(identity, 'checkout-identity-fixture');
        await writeFile(
          fakeSsh,
          `const { readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (!args.includes('-G')) {
  if (readFileSync(${JSON.stringify(identity)}, 'utf8') !== 'checkout-identity-fixture') {
    throw new Error('checkout identity is unavailable');
  }
  if (${JSON.stringify(source)} !== 'GIT_SSH' && args[args.indexOf('-i') + 1] !== ${JSON.stringify(identity)}) {
    throw new Error('checkout identity argument was lost');
  }
  writeFileSync(${JSON.stringify(recording)}, JSON.stringify({ args, terminalPrompt: process.env.GIT_TERMINAL_PROMPT }));
  const service = /^git-upload-pack '([^']+)'$/.exec(args[args.length - 1]);
  if (!service) {
    throw new Error('unexpected Git service');
  }
  const result = spawnSync('git', ['upload-pack', service[1]], { stdio: 'inherit' });
  process.exitCode = result.status === null ? 1 : result.status;
}
`,
        );
        await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fakeSsh}" "$@"\n`);
        await chmod(wrapper, 0o700);
        const fallbackSsh = join(binDir, 'ssh');
        await writeFile(
          fallbackSsh,
          '#!/bin/sh\nprintf "%s\\n" "default ssh lost the checkout identity" >&2\nexit 1\n',
        );
        await chmod(fallbackSsh, 0o700);

        const sshCommand = `"${wrapper}" -i "${identity}" -o StrictHostKeyChecking=yes`;
        await withEnv(
          {
            GITHUB_TOKEN: undefined,
            GIT_SSH_COMMAND: source === 'GIT_SSH_COMMAND' ? sshCommand : undefined,
            GIT_SSH: source === 'GIT_SSH' ? wrapper : undefined,
            GIT_SSH_VARIANT: undefined,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
            PATH: `${binDir}${delimiter}${process.env.PATH}`,
            GIT_AUTHOR_NAME: 'Repo Toolkit',
            GIT_AUTHOR_EMAIL: 'repo-toolkit@example.com',
            GIT_COMMITTER_NAME: 'Repo Toolkit',
            GIT_COMMITTER_EMAIL: 'repo-toolkit@example.com',
          },
          async () => {
            const git = (args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
            git(['init', '--quiet', '--initial-branch=main']);
            git(['commit', '--quiet', '--allow-empty', '--no-gpg-sign', '-m', 'fixture commit']);
            git(['init', '--bare', '--quiet', '--initial-branch=main', remote]);
            git(['push', '--quiet', remote, 'HEAD:refs/heads/main']);
            git(['remote', 'add', 'origin', `ssh://git@checkout.invalid${remote}`]);
            if (source === 'core.sshCommand') {
              git(['config', '--local', 'core.sshCommand', sshCommand]);
            }

            const result = await runPreflight({
              plan: resolveReleaseTagPlan({ cwd, only: ['determine', 'release'], timeoutMs: 5000 }),
            });
            expect(result.git).toEqual({ name: 'git', skipped: false, skippedReason: null });
            const invocation = JSON.parse(await readFile(recording, 'utf8')) as Record<string, unknown>;
            expect(invocation.terminalPrompt).toBe('0');
            expect(invocation.args).toContain('git@checkout.invalid');
            if (source === 'core.sshCommand') {
              expect(git(['config', '--get', 'core.sshCommand']).trim()).toBe(sshCommand);
            }
          },
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );
});
