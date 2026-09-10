import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  publishDockerImages,
  resolveDockerPublishPlan,
  type DockerPublishImagesOptions,
  type DockerPublishRunner,
  type DockerRunOptions,
} from '../src/index';

const packageRoot = resolve(import.meta.dirname, '..');

const USER_ENV = 'DOCKER_PUBLISH_TEST_USER';
const PASS_ENV = 'DOCKER_PUBLISH_TEST_PASS';
const TEST_USER = 'test-publish-user';
const TEST_PASS = 'test-publish-pass-7f3a-secret';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

interface RecordedCall {
  readonly kind: 'run' | 'capture';
  readonly executable: string;
  readonly args: string[];
  readonly options: DockerRunOptions;
}

function withProject(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'docker-publish-publish-'));
  const done = ((): void | Promise<void> => {
    try {
      return run(root);
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  })();
  if (done instanceof Promise) {
    return done.finally(() => {
      rmSync(root, { recursive: true, force: true });
    });
  }
  rmSync(root, { recursive: true, force: true });
  return Promise.resolve();
}

function writeImageContext(root: string, dir: string): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'Dockerfile'), 'FROM scratch\n');
}

function withAuthEnv(): () => void {
  const previousUser = process.env[USER_ENV];
  const previousPass = process.env[PASS_ENV];
  process.env[USER_ENV] = TEST_USER;
  process.env[PASS_ENV] = TEST_PASS;
  return () => {
    if (previousUser === undefined) {
      delete process.env[USER_ENV];
    } else {
      process.env[USER_ENV] = previousUser;
    }
    if (previousPass === undefined) {
      delete process.env[PASS_ENV];
    } else {
      process.env[PASS_ENV] = previousPass;
    }
  };
}

function pushStdoutFor(digest: string): string {
  return `The push refers to repository [example]\nlatest: digest: ${digest} size: 1783\n`;
}

function inspectStdoutFor(digest: string): string {
  return `{"mediaType":"application/vnd.oci.image.index.v1+json","digest":"${digest}"}\n`;
}

function planBase(root: string): DockerPublishImagesOptions {
  return {
    cwd: root,
    images: [{ name: 'app', contextDir: 'services/app' }],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
    tags: ['1.2.3'],
    platforms: ['linux/amd64'],
  };
}

function authFor(hostname: string): DockerPublishImagesOptions['auth'] {
  return { [hostname]: { usernameEnv: USER_ENV, passwordEnv: PASS_ENV } };
}

function createRecordingRunner(
  hooks: {
    readonly pushStdout?: (reference: string) => string;
    readonly inspectStdout?: (reference: string) => string;
    readonly failLogin?: boolean;
  } = {},
): { readonly calls: RecordedCall[]; readonly runner: DockerPublishRunner } {
  const calls: RecordedCall[] = [];
  const runner: DockerPublishRunner = {
    run(executable, args, options) {
      calls.push({ kind: 'run', executable, args: [...args], options });
      if (hooks.failLogin === true) {
        throw new Error('login output tail marker');
      }
      return { durationMs: 1 };
    },
    capture(executable, args, options) {
      calls.push({ kind: 'capture', executable, args: [...args], options });
      let stdout: string;
      if (args[0] === 'push') {
        stdout = hooks.pushStdout === undefined ? pushStdoutFor(DIGEST_A) : hooks.pushStdout(args[1]);
      } else {
        const reference = args[args.length - 1];
        stdout = hooks.inspectStdout === undefined ? inspectStdoutFor(DIGEST_A) : hooks.inspectStdout(reference);
      }
      return { stdout, stderr: '', durationMs: 2, outputBytes: Buffer.byteLength(stdout, 'utf8') };
    },
  };
  return { calls, runner };
}

function argvOf(calls: ReadonlyArray<RecordedCall>, kind: 'run' | 'capture', first: string): RecordedCall[] {
  return calls.filter((call) => call.kind === kind && call.args[0] === first);
}

function tick(): Promise<void> {
  return new Promise((resolveTimer) => {
    setTimeout(resolveTimer, 0);
  });
}

describe('publish login, push, and inspect argv', () => {
  it('authenticates via --password-stdin and captures digests per reference', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const restore = withAuthEnv();
      try {
        const base = planBase(root);
        const plan = resolveDockerPublishPlan(base);
        const { calls, runner } = createRecordingRunner();
        const result = await publishDockerImages({
          ...base,
          auth: authFor('registry.example.com'),
          runner,
        });

        const reference = 'registry.example.com/team/app:1.2.3';
        const logins = argvOf(calls, 'run', 'login');
        expect(logins.length).toBe(1);
        expect(logins[0].executable).toBe('docker');
        expect(logins[0].args).toEqual(['login', '--username', TEST_USER, '--password-stdin', 'registry.example.com']);
        expect(logins[0].options.cwd).toBe(plan.cwd);
        expect(logins[0].options.stdin).toBe(TEST_PASS);
        expect(logins[0].options.timeoutMs).toBe(plan.processLimits.timeoutMs);
        expect(logins[0].options.maxOutputBytes).toBe(plan.processLimits.maxOutputBytes);
        expect(logins[0].options.secrets).toContain(TEST_PASS);

        const pushes = argvOf(calls, 'capture', 'push');
        expect(pushes.length).toBe(1);
        expect(pushes[0].executable).toBe('docker');
        expect(pushes[0].args).toEqual(['push', reference]);
        expect(pushes[0].options.cwd).toBe(plan.cwd);

        const inspects = calls.filter(
          (call) => call.kind === 'capture' && call.args[0] === 'buildx' && call.args[1] === 'imagetools',
        );
        expect(inspects.length).toBe(1);
        expect(inspects[0].args).toEqual([
          'buildx',
          'imagetools',
          'inspect',
          '--format',
          '{{json .Manifest}}',
          reference,
        ]);

        for (const call of calls) {
          expect(call.args).not.toContain('--password');
          for (const entry of call.args) {
            expect(entry).not.toContain(TEST_PASS);
          }
        }

        expect(result.publishes.length).toBe(1);
        expect(result.publishes[0].reference).toBe(reference);
        expect(result.publishes[0].registry).toBe('registry.example.com');
        expect(result.publishes[0].tag).toBe('1.2.3');
        expect(result.publishes[0].digest).toBe(DIGEST_A);
        expect(result.publishes[0].durationMs).toBeGreaterThanOrEqual(0);
      } finally {
        restore();
      }
    });
  });

  it('logs in once per registry and pushes references in plan order', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const restore = withAuthEnv();
      try {
        const base: DockerPublishImagesOptions = {
          ...planBase(root),
          tags: ['1.2.3', '2.0.0'],
        };
        const plan = resolveDockerPublishPlan(base);
        const digests = new Map<string, string>([
          ['registry.example.com/team/app:1.2.3', DIGEST_A],
          ['registry.example.com/team/app:2.0.0', DIGEST_B],
        ]);
        const { calls, runner } = createRecordingRunner({
          pushStdout: (reference) => pushStdoutFor(digests.get(reference) as string),
          inspectStdout: (reference) => inspectStdoutFor(digests.get(reference) as string),
        });
        const result = await publishDockerImages({ ...base, auth: authFor('registry.example.com'), runner });

        expect(argvOf(calls, 'run', 'login').length).toBe(1);
        const pushes = argvOf(calls, 'capture', 'push');
        expect(pushes.map((call) => call.args[1])).toEqual(plan.references);
        expect(result.publishes.map((entry) => entry.reference)).toEqual(plan.references);
        expect(result.publishes.map((entry) => entry.digest)).toEqual([DIGEST_A, DIGEST_B]);
      } finally {
        restore();
      }
    });
  });

  it('skips login for registries without an auth entry', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      const result = await publishDockerImages({ ...base, runner });
      expect(argvOf(calls, 'run', 'login').length).toBe(0);
      expect(result.publishes.length).toBe(1);
      expect(result.publishes[0].digest).toBe(DIGEST_A);
    });
  });
});

describe('off-plan and allowlist refusal', () => {
  it('refuses an off-plan reference before any runner call', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      await expect(
        publishDockerImages({
          ...base,
          runner,
          references: ['registry.example.com/team/app:9.9.9'],
        }),
      ).rejects.toThrow('Refusing to push off-plan reference: registry.example.com/team/app:9.9.9');
      expect(calls.length).toBe(0);
    });
  });

  it('refuses an unlisted registry before any runner call', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      await expect(
        publishDockerImages({ ...base, runner, references: ['evil.example.com/app:1.2.3'] }),
      ).rejects.toThrow('Refusing to push to unlisted registry: evil.example.com');
      expect(calls.length).toBe(0);
    });
  });

  it('refuses duplicate requested references before any runner call', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      await expect(
        publishDockerImages({
          ...base,
          runner,
          references: ['registry.example.com/team/app:1.2.3', 'registry.example.com/team/app:1.2.3'],
        }),
      ).rejects.toThrow('Duplicate publish reference');
      expect(calls.length).toBe(0);
    });
  });
});

describe('digest capture fails closed', () => {
  it('fails when push and inspect outputs carry no digest', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner({
        pushStdout: () => 'latest: Pushed\n',
        inspectStdout: () => '{}\n',
      });
      await expect(publishDockerImages({ ...base, runner })).rejects.toThrow('missing content digest');
      expect(argvOf(calls, 'capture', 'push').length).toBe(1);
    });
  });

  it('fails on malformed push digests', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { runner } = createRecordingRunner({
        pushStdout: () => 'latest: digest: sha256:zzz size: 12\n',
      });
      await expect(publishDockerImages({ ...base, runner })).rejects.toThrow('malformed content digest');
    });
  });

  it('fails on malformed inspect digests', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { runner } = createRecordingRunner({
        pushStdout: () => 'latest: Pushed\n',
        inspectStdout: () => `{"digest":"sha256:not-hex"}\n`,
      });
      await expect(publishDockerImages({ ...base, runner })).rejects.toThrow('malformed content digest');
    });
  });

  it('fails when push and inspect digests disagree', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { runner } = createRecordingRunner({
        pushStdout: () => pushStdoutFor(DIGEST_A),
        inspectStdout: () => inspectStdoutFor(DIGEST_B),
      });
      await expect(publishDockerImages({ ...base, runner })).rejects.toThrow('does not match inspect digest');
    });
  });

  it('falls back to the inspect digest when push output carries none', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { runner } = createRecordingRunner({
        pushStdout: () => 'latest: Pushed\n',
        inspectStdout: () => inspectStdoutFor(DIGEST_B),
      });
      const result = await publishDockerImages({ ...base, runner });
      expect(result.publishes[0].digest).toBe(DIGEST_B);
    });
  });
});

describe('secret redaction', () => {
  it('redacts credentials from failures and keeps passwords out of argv', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const restore = withAuthEnv();
      try {
        const base = planBase(root);
        const { calls, runner } = createRecordingRunner({
          pushStdout: () => `pushed by ${TEST_PASS}\n`,
          inspectStdout: () => '{}\n',
        });
        const failure = await publishDockerImages({
          ...base,
          auth: authFor('registry.example.com'),
          runner,
        }).then(
          () => {
            throw new Error('expected the publish to fail');
          },
          (error: unknown) => error as Error,
        );
        expect(failure.message).toContain('missing content digest');
        expect(failure.message).not.toContain(TEST_PASS);
        expect(failure.message).not.toContain(TEST_USER);
        expect(failure.message).toContain('[redacted]');
        for (const call of calls) {
          for (const entry of call.args) {
            expect(entry).not.toContain(TEST_PASS);
          }
        }
      } finally {
        restore();
      }
    });
  });

  it('redacts credentials from login failures and names the registry', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const restore = withAuthEnv();
      try {
        const base = planBase(root);
        const { runner } = createRecordingRunner({ failLogin: true });
        const failure = await publishDockerImages({
          ...base,
          auth: authFor('registry.example.com'),
          runner,
        }).then(
          () => {
            throw new Error('expected the login to fail');
          },
          (error: unknown) => error as Error,
        );
        expect(failure.message).toContain('registry.example.com');
        expect(failure.message).not.toContain(TEST_PASS);
      } finally {
        restore();
      }
    });
  });

  it('never uses --password argv or shell execution in the publish module', () => {
    const source = readFileSync(join(packageRoot, 'src', 'publish.ts'), 'utf8');
    expect(source).toContain('--password-stdin');
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('process.exit');
    expect(source).not.toContain('bash -c');
    expect(source).not.toContain('sh -c');
    for (const line of source.split('\n')) {
      if (line.includes('--password-stdin')) {
        continue;
      }
      expect(line).not.toContain('--password');
    }
  });
});

describe('dry-run short-circuit', () => {
  it('resolves the plan without runner calls, credentials, or manifest writes', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      const result = await publishDockerImages({
        ...base,
        auth: authFor('registry.example.com'),
        digestManifestPath: 'artifacts/digests.json',
        dryRun: true,
        runner,
      });
      expect(result.publishes).toEqual([]);
      expect(calls.length).toBe(0);
      expect(readdirSync(root).sort()).toEqual(['services']);
    });
  });
});

describe('digest manifest', () => {
  it('writes an atomic manifest sorted by reference', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishImagesOptions = {
        ...planBase(root),
        tags: ['2.0.0', '1.2.3'],
      };
      const digests = new Map<string, string>([
        ['registry.example.com/team/app:1.2.3', DIGEST_A],
        ['registry.example.com/team/app:2.0.0', DIGEST_B],
      ]);
      const { runner } = createRecordingRunner({
        pushStdout: (reference) => pushStdoutFor(digests.get(reference) as string),
        inspectStdout: (reference) => inspectStdoutFor(digests.get(reference) as string),
      });
      const result = await publishDockerImages({
        ...base,
        digestManifestPath: 'artifacts/digests.json',
        runner,
      });

      expect(result.publishes.map((entry) => entry.reference)).toEqual([
        'registry.example.com/team/app:1.2.3',
        'registry.example.com/team/app:2.0.0',
      ]);

      const manifestPath = join(root, 'artifacts', 'digests.json');
      const raw = readFileSync(manifestPath, 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(JSON.parse(raw)).toEqual({
        'registry.example.com/team/app:1.2.3': DIGEST_A,
        'registry.example.com/team/app:2.0.0': DIGEST_B,
      });
      expect(Object.keys(JSON.parse(raw))).toEqual([
        'registry.example.com/team/app:1.2.3',
        'registry.example.com/team/app:2.0.0',
      ]);
      expect(readdirSync(join(root, 'artifacts'))).toEqual(['digests.json']);
    });
  });

  it('rejects manifest paths escaping the project root before any runner call', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      await expect(publishDockerImages({ ...base, digestManifestPath: '../evil.json', runner })).rejects.toThrow(
        'parent-directory',
      );
      expect(calls.length).toBe(0);
    });
  });

  it('rejects manifest paths that escape the project root through symlinked directories', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'docker-publish-publish-outside-'));
    try {
      await withProject(async (root) => {
        writeImageContext(root, 'services/app');
        symlinkSync(outside, join(root, 'linkdir'), 'dir');
        const base = planBase(root);
        const { calls, runner } = createRecordingRunner();
        await expect(
          publishDockerImages({ ...base, digestManifestPath: 'linkdir/digests.json', runner }),
        ).rejects.toThrow('escapes the project root');
        expect(calls.length).toBe(0);
        expect(existsSync(join(outside, 'digests.json'))).toBe(false);
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('never follows a pre-planted symlink at the legacy predictable temp path', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'docker-publish-manifest-outside-'));
    try {
      await withProject(async (root) => {
        writeImageContext(root, 'services/app');
        const base = planBase(root);
        const { runner } = createRecordingRunner();
        const manifestPath = join(root, 'artifacts', 'digests.json');
        mkdirSync(join(root, 'artifacts'), { recursive: true });
        const legacySibling = `${manifestPath}.tmp-${process.pid}`;
        const outsideFile = join(outside, 'exfiltrated.txt');
        writeFileSync(outsideFile, 'OUTSIDE-CANARY', 'utf8');
        symlinkSync(outsideFile, legacySibling);
        const result = await publishDockerImages({
          ...base,
          digestManifestPath: 'artifacts/digests.json',
          runner,
        });
        expect(result.publishes[0].digest).toBe(DIGEST_A);
        expect(readFileSync(outsideFile, 'utf8')).toBe('OUTSIDE-CANARY');
        const raw = readFileSync(manifestPath, 'utf8');
        const expected = `${JSON.stringify({ 'registry.example.com/team/app:1.2.3': DIGEST_A }, null, 2)}\n`;
        expect(raw).toBe(expected);
        expect(lstatSync(legacySibling).isSymbolicLink()).toBe(true);
        expect(readdirSync(join(root, 'artifacts')).sort()).toEqual([
          'digests.json',
          `digests.json.tmp-${process.pid}`,
        ]);
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('writes byte-identical manifest content for the success path', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { runner } = createRecordingRunner();
      await publishDockerImages({ ...base, digestManifestPath: 'artifacts/digests.json', runner });
      const raw = readFileSync(join(root, 'artifacts', 'digests.json'), 'utf8');
      expect(raw).toBe(`${JSON.stringify({ 'registry.example.com/team/app:1.2.3': DIGEST_A }, null, 2)}\n`);
      expect(readdirSync(join(root, 'artifacts'))).toEqual(['digests.json']);
    });
  });
});

describe('publish concurrency', () => {
  interface PendingPush {
    resolve(stdout: string): void;
  }

  function createDeferredRunner(digests: ReadonlyMap<string, string>): {
    readonly calls: RecordedCall[];
    readonly started: string[];
    maxActive(): number;
    readonly runner: DockerPublishRunner;
  } {
    const calls: RecordedCall[] = [];
    const started: string[] = [];
    const pending = new Map<string, PendingPush[]>();
    let active = 0;
    let peak = 0;
    const runner: DockerPublishRunner = {
      run(executable, args, options) {
        calls.push({ kind: 'run', executable, args: [...args], options });
        return Promise.resolve({ durationMs: 0 });
      },
      capture(executable, args, options) {
        calls.push({ kind: 'capture', executable, args: [...args], options });
        if (args[0] !== 'push') {
          const reference = args[args.length - 1];
          const stdout = inspectStdoutFor(digests.get(reference) as string);
          return Promise.resolve({
            stdout,
            stderr: '',
            durationMs: 0,
            outputBytes: Buffer.byteLength(stdout, 'utf8'),
          });
        }
        const reference = args[1];
        started.push(reference);
        active += 1;
        if (active > peak) {
          peak = active;
        }
        return new Promise<{ stdout: string; stderr: string; durationMs: number; outputBytes: number }>(
          (resolvePush) => {
            const waiters = pending.get(reference) ?? [];
            waiters.push({
              resolve: (stdout) => {
                active -= 1;
                resolvePush({ stdout, stderr: '', durationMs: 0, outputBytes: Buffer.byteLength(stdout, 'utf8') });
              },
            });
            pending.set(reference, waiters);
          },
        );
      },
    };
    return { calls, started, maxActive: () => peak, runner };
  }

  async function waitForPush(deferred: { readonly started: ReadonlyArray<string> }, count: number): Promise<void> {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      if (deferred.started.length >= count) {
        return;
      }
      await tick();
    }
    throw new Error(`timed out waiting for ${count} pushes to start`);
  }

  function twoTagBase(root: string): { base: DockerPublishImagesOptions; refs: string[] } {
    const base: DockerPublishImagesOptions = { ...planBase(root), tags: ['1.2.3', '2.0.0'] };
    return {
      base,
      refs: ['registry.example.com/team/app:1.2.3', 'registry.example.com/team/app:2.0.0'],
    };
  }

  it('pushes serially by default', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const { base, refs } = twoTagBase(root);
      const digests = new Map<string, string>([
        [refs[0], DIGEST_A],
        [refs[1], DIGEST_B],
      ]);
      const deferred = createDeferredRunner(digests);
      const settlement = publishDockerImages({ ...base, runner: deferred.runner });
      await waitForPush(deferred, 1);
      await tick();
      await tick();
      expect(deferred.started).toEqual([refs[0]]);
      expect(deferred.maxActive()).toBe(1);
      const pendingCalls = deferred.calls.filter((call) => call.kind === 'capture' && call.args[0] === 'push');
      expect(pendingCalls.length).toBe(1);
      let settled = false;
      void settlement.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const race = await Promise.race([settlement.then(() => 'settled'), tick().then(() => 'pending')]);
      expect(race).toBe('pending');
      expect(settled).toBe(false);
      expect(deferred.started).toEqual([refs[0]]);
    });
  });

  it('honours an explicit publishConcurrency bound', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const { base, refs } = twoTagBase(root);
      const digests = new Map<string, string>([
        [refs[0], DIGEST_A],
        [refs[1], DIGEST_B],
      ]);
      const calls: RecordedCall[] = [];
      let active = 0;
      let peak = 0;
      const resolvers: Array<() => void> = [];
      const runner: DockerPublishRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          return { durationMs: 0 };
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          if (args[0] !== 'push') {
            const reference = args[args.length - 1];
            const stdout = inspectStdoutFor(digests.get(reference) as string);
            return { stdout, stderr: '', durationMs: 0, outputBytes: Buffer.byteLength(stdout, 'utf8') };
          }
          const reference = args[1];
          active += 1;
          if (active > peak) {
            peak = active;
          }
          return new Promise<{ stdout: string; stderr: string; durationMs: number; outputBytes: number }>(
            (resolvePush) => {
              resolvers.push(() => {
                active -= 1;
                const stdout = pushStdoutFor(digests.get(reference) as string);
                resolvePush({ stdout, stderr: '', durationMs: 0, outputBytes: Buffer.byteLength(stdout, 'utf8') });
              });
            },
          );
        },
      };
      const settlement = publishDockerImages({ ...base, publishConcurrency: 2, runner });
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const pushes = calls.filter((c) => c.kind === 'capture' && c.args[0] === 'push');
        if (pushes.length >= 2) {
          break;
        }
        await tick();
      }
      expect(calls.filter((c) => c.kind === 'capture' && c.args[0] === 'push').length).toBe(2);
      expect(peak).toBe(2);
      while (resolvers.length > 0) {
        (resolvers.shift() as () => void)();
        await tick();
      }
      const result = await settlement;
      expect(result.publishes.map((entry) => entry.reference)).toEqual(refs);
    });
  });
});

describe('publish option validation', () => {
  it('rejects invalid publish options before any runner call', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const base = planBase(root);
      const { calls, runner } = createRecordingRunner();
      await expect(publishDockerImages({ ...base, publishConcurrency: 0, runner })).rejects.toThrow(
        'publishConcurrency must be a positive safe integer',
      );
      expect(calls.length).toBe(0);
    });
  });

  it('fails closed when registry credentials are missing from the environment', async () => {
    await withProject(async (root) => {
      writeImageContext(root, 'services/app');
      const restore = withAuthEnv();
      delete process.env[PASS_ENV];
      try {
        const base = planBase(root);
        const { calls, runner } = createRecordingRunner();
        await expect(publishDockerImages({ ...base, auth: authFor('registry.example.com'), runner })).rejects.toThrow(
          `Missing password for registry registry.example.com in environment variable ${PASS_ENV}`,
        );
        expect(argvOf(calls, 'run', 'login').length).toBe(0);
        expect(argvOf(calls, 'capture', 'push').length).toBe(0);
      } finally {
        restore();
      }
    });
  });
});
