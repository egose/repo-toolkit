import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { redactSensitiveValues, type ParseFlagsResult } from '@repo-toolkit/publish-package';

import { planSummary, resolveDockerPublishCliOptions } from '../src/cli-options';
import {
  collectInteractiveSecrets,
  confirmInteractiveProceed,
  createScriptedPrompter,
  CUSTOM_REGISTRY_HOSTNAME,
  loginWithInteractiveAuth,
  promptInteractiveAuth,
  resolveInteractiveAuthAndConfirm,
  resolveInteractiveDockerPublishOptions,
  SCRIPTED_CANCEL,
  type InteractiveRunner,
  type Prompter,
} from '../src/interactive';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'docker-publish-interactive-'));
  tempRoots.push(root);
  return root;
}

function writeContext(root: string, dir: string): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'Dockerfile'), 'FROM scratch\n');
}

function writeConfig(root: string, name: string, data: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

function flags(values: Record<string, string> = {}): ParseFlagsResult {
  return { values, repeat: {}, unknown: [] };
}

function baseConfig(root: string): Record<string, unknown> {
  return {
    cwd: root,
    images: [{ name: 'app', contextDir: 'services/app' }],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
    tags: ['1.2.3'],
    platforms: ['linux/amd64'],
  };
}

function seedBaseProject(root: string): void {
  writeContext(root, 'services/app');
}

describe('resolveInteractiveDockerPublishOptions', () => {
  it('takes the exact non-interactive path with zero prompt calls when interactive is false', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const input = flags({ config: configPath });
    const expected = await resolveDockerPublishCliOptions(input, {});

    const silent = createScriptedPrompter([]);
    const explicit = await resolveInteractiveDockerPublishOptions(input, {}, { interactive: false, prompter: silent });
    expect(explicit).toEqual(expected);
    expect(silent.calls.length).toBe(0);

    const untouched = createScriptedPrompter(['unexpected-answer']);
    const implicit = await resolveInteractiveDockerPublishOptions(input, {}, { prompter: untouched });
    expect(implicit).toEqual(expected);
    expect(untouched.calls.length).toBe(0);
  });

  it('fails closed before any prompt when interactive is requested without a TTY', async () => {
    const root = project();
    seedBaseProject(root);
    const prompter = createScriptedPrompter(['app']);
    await expect(
      resolveInteractiveDockerPublishOptions(flags({}), {}, { interactive: true, prompter, canPromptNow: false }),
    ).rejects.toThrow(/Pass --config.*TTY/);
    expect(prompter.calls.length).toBe(0);
  });

  it('resolves the same plan as the equivalent config file for a full-answer run', async () => {
    const root = project();
    seedBaseProject(root);
    writeFileSync(join(root, 'services/app/Dockerfile.prod'), 'FROM scratch\n');
    const equivalent = {
      cwd: root,
      images: [{ name: 'app', contextDir: 'services/app', dockerfile: 'services/app/Dockerfile.prod' }],
      registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
      tags: ['1.2.3'],
      platforms: ['linux/amd64'],
    };
    const configPath = writeConfig(root, 'equivalent.json', equivalent);
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter([
      '',
      'app',
      'services/app',
      'services/app/Dockerfile.prod',
      '',
      false,
      CUSTOM_REGISTRY_HOSTNAME,
      'registry.example.com',
      'team',
      false,
      '1.2.3',
      'linux/amd64',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ cwd: root }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
  });

  it('reproduces the config-file plan when every default is accepted', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, '', '', false]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
  });

  it('preserves per-image build args and labels when defaults are accepted', async () => {
    const root = project();
    seedBaseProject(root);
    const config = {
      ...baseConfig(root),
      buildArgs: { GLOBAL_FLAG: '1' },
      labels: { 'org.example.team': 'core' },
      images: [
        {
          name: 'app',
          contextDir: 'services/app',
          buildArgs: { LOG_LEVEL: 'info' },
          labels: { 'org.example.component': 'app' },
        },
      ],
    };
    const configPath = writeConfig(root, 'docker-publish.json', config);
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, '', '', false]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
    expect(actual.plan.images[0]?.buildArgs).toEqual({ LOG_LEVEL: 'info' });
    expect(actual.plan.images[0]?.labels).toEqual({ 'org.example.component': 'app' });
  });

  it('preserves global build args and labels when advanced customization is declined', async () => {
    const root = project();
    seedBaseProject(root);
    const config = {
      ...baseConfig(root),
      buildArgs: { LOG_LEVEL: 'info' },
      labels: { 'org.example.component': 'app' },
    };
    const configPath = writeConfig(root, 'docker-publish.json', config);
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, '', '', false]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
    expect(actual.plan.buildArgs).toEqual({ LOG_LEVEL: 'info' });
    expect(actual.plan.labels).toEqual({ 'org.example.component': 'app' });
  });

  it('re-prompts invalid tags with the plan error message', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      'BAD TAG!!',
      '1.2.3',
      '',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.tags).toEqual(['1.2.3']);
    expect(prompter.calls.filter((call) => call.message.startsWith('Tags'))).toHaveLength(2);
  });

  it('re-prompts an invalid image name with the plan error message', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter(['APP', 'app', '', '', '', false, undefined, '', '', false, '', '', false]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.images.map((image) => image.name)).toEqual(['app']);
    expect(prompter.calls.filter((call) => call.message === 'Image 1 name')).toHaveLength(2);
  });

  it('cancels at the config path prompt', async () => {
    const prompter = createScriptedPrompter([SCRIPTED_CANCEL]);
    await expect(
      resolveInteractiveDockerPublishOptions(flags({}), {}, { interactive: true, prompter, canPromptNow: true }),
    ).rejects.toThrow('Operation cancelled.');
  });

  it('cancels at the image stage', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const prompter = createScriptedPrompter([SCRIPTED_CANCEL]);
    await expect(
      resolveInteractiveDockerPublishOptions(
        flags({ config: configPath }),
        {},
        { interactive: true, prompter, canPromptNow: true },
      ),
    ).rejects.toThrow('Operation cancelled.');
  });

  it('cancels at the registry stage', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const prompter = createScriptedPrompter(['', '', '', '', false, SCRIPTED_CANCEL]);
    await expect(
      resolveInteractiveDockerPublishOptions(
        flags({ config: configPath }),
        {},
        { interactive: true, prompter, canPromptNow: true },
      ),
    ).rejects.toThrow('Operation cancelled.');
  });

  it('cancels at the tags stage', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, SCRIPTED_CANCEL]);
    await expect(
      resolveInteractiveDockerPublishOptions(
        flags({ config: configPath }),
        {},
        { interactive: true, prompter, canPromptNow: true },
      ),
    ).rejects.toThrow('Operation cancelled.');
  });

  it('cancels at the platforms stage', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, '', SCRIPTED_CANCEL]);
    await expect(
      resolveInteractiveDockerPublishOptions(
        flags({ config: configPath }),
        {},
        { interactive: true, prompter, canPromptNow: true },
      ),
    ).rejects.toThrow('Operation cancelled.');
  });

  it('cancels at the advanced customize confirm', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, '', '', SCRIPTED_CANCEL]);
    await expect(
      resolveInteractiveDockerPublishOptions(
        flags({ config: configPath }),
        {},
        { interactive: true, prompter, canPromptNow: true },
      ),
    ).rejects.toThrow('Operation cancelled.');
  });

  it('accepts an unknown platform after the custom-platform confirm', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      'mars/amd64',
      true,
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.platforms.map((platform) => platform.name)).toEqual(['mars/amd64']);
    expect(actual.plan.allowCustomPlatforms).toBe(true);
  });

  it('re-prompts platforms when custom platforms are declined', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      'mars/amd64',
      false,
      'linux/amd64',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.platforms.map((platform) => platform.name)).toEqual(['linux/amd64']);
    expect(actual.plan.allowCustomPlatforms).toBe(false);
  });

  it('applies customized advanced answers to the plan', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      '',
      true,
      false,
      'LOG_LEVEL=info',
      'org.example.component=app',
      '4',
      '600000',
      '1048576',
      '',
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.buildArgs).toEqual({ LOG_LEVEL: 'info' });
    expect(actual.plan.labels).toEqual({ 'org.example.component': 'app' });
    expect(actual.plan.buildConcurrency).toBe(4);
    expect(actual.plan.dockerExecutable).toBe('docker');
    expect(actual.plan.processLimits).toEqual({ timeoutMs: 600000, maxOutputBytes: 1048576 });
  });

  it('re-prompts secret-looking build args until the guard passes', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      '',
      true,
      false,
      'API_TOKEN=abc',
      'LOG_LEVEL=info',
      '',
      '',
      '',
      '',
      '',
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.buildArgs).toEqual({ LOG_LEVEL: 'info' });
    expect(prompter.calls.filter((call) => call.message.startsWith('Global build args'))).toHaveLength(2);
  });

  it('loops image entries on the add-another confirm', async () => {
    const root = project();
    seedBaseProject(root);
    writeContext(root, 'services/worker');
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      true,
      'worker',
      'services/worker',
      'services/worker/Dockerfile',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      '',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.images.map((image) => image.name)).toEqual(['app', 'worker']);
  });

  it('loops registry entries on the add-another confirm', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      true,
      'localhost:5000',
      '',
      false,
      '',
      '',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.registries.map((registry) => registry.hostname)).toEqual([
      'registry.example.com',
      'localhost:5000',
    ]);
  });

  it('selects a known registry without asking for a custom hostname', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter(['', '', '', '', false, 'ghcr.io', 'octo', false, '', '', false]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.registries).toEqual([{ hostname: 'ghcr.io', repositoryPrefix: 'octo' }]);
    expect(prompter.calls.filter((call) => call.message === 'Registry 1 custom hostname')).toHaveLength(0);
  });

  it('re-prompts an invalid custom hostname with the plan error message', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));

    const prompter = createScriptedPrompter([
      '',
      '',
      '',
      '',
      false,
      CUSTOM_REGISTRY_HOSTNAME,
      'NOT A HOST!!',
      'quay.example.com',
      '',
      false,
      '',
      '',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual.plan.registries.map((registry) => registry.hostname)).toEqual(['quay.example.com']);
    expect(prompter.calls.filter((call) => call.message === 'Registry 1 custom hostname')).toHaveLength(2);
  });

  it('preselects the configured known hostname as the select default', async () => {
    const root = project();
    seedBaseProject(root);
    const config = {
      ...baseConfig(root),
      registries: [{ hostname: 'ghcr.io', repositoryPrefix: 'team' }],
    };
    const configPath = writeConfig(root, 'docker-publish.json', config);
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', false, '', '', false]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({ config: configPath }),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
    expect(prompter.calls.filter((call) => call.message === 'Registry 1 custom hostname')).toHaveLength(0);
  });

  it('prompts for the config path when --config is absent', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter([
      configPath,
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      '',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({}),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
  });

  it('re-prompts an unreadable config path with the load error', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const expected = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const prompter = createScriptedPrompter([
      join(root, 'missing.json'),
      configPath,
      '',
      '',
      '',
      '',
      false,
      undefined,
      '',
      '',
      false,
      '',
      '',
      false,
    ]);
    const actual = await resolveInteractiveDockerPublishOptions(
      flags({}),
      {},
      { interactive: true, prompter, canPromptNow: true },
    );
    expect(actual).toEqual(expected);
    expect(prompter.calls.filter((call) => call.message.startsWith('Config file path'))).toHaveLength(2);
  });
});

const INT03_HOST = 'registry.example.com';
const INT03_USER_ENV = 'INT03_DOCKER_TEST_USER';
const INT03_PASS_ENV = 'INT03_DOCKER_TEST_PASS';
const INT03_USER_VALUE = 'int03-test-user';
const INT03_PASS_VALUE = 'int03-env-pass-value';
const INT03_NEW_PASS = 'int03-canary-new-pass-9f2secret';

function setTestEnv(name: string, value: string | undefined): () => void {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (!had) {
      delete process.env[name];
    } else {
      process.env[name] = previous as string;
    }
  };
}

function snapshotTestEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

function createLoginRunner(failure?: string): {
  readonly calls: Array<{ executable: string; args: string[]; options: { stdin?: string; cwd: string } }>;
  readonly runner: InteractiveRunner;
} {
  const calls: Array<{ executable: string; args: string[]; options: { stdin?: string; cwd: string } }> = [];
  const runner: InteractiveRunner = {
    run(executable, args, options) {
      calls.push({ executable, args: [...args], options: { stdin: options.stdin, cwd: options.cwd } });
      if (failure !== undefined) {
        throw new Error(failure);
      }
      return { durationMs: 1 };
    },
  };
  return { calls, runner };
}

function createConfirmCapturingPrompter(answer: boolean | typeof SCRIPTED_CANCEL): {
  readonly prompter: Prompter;
  readonly confirms: Array<{ message: string; initialValue?: boolean }>;
} {
  const scripted = createScriptedPrompter([answer]);
  const confirms: Array<{ message: string; initialValue?: boolean }> = [];
  const prompter: Prompter = {
    text: (request) => scripted.text(request),
    password: (request) => scripted.password(request),
    select: (request) => scripted.select(request),
    confirm: (request) => {
      confirms.push({
        message: request.message,
        ...(request.initialValue === undefined ? {} : { initialValue: request.initialValue }),
      });
      return scripted.confirm(request);
    },
  };
  return { prompter, confirms };
}

describe('interactive registry auth choice flow', () => {
  it('uses the environment password by default and logs in via stdin without mutating process.env', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv(INT03_USER_ENV, INT03_USER_VALUE), setTestEnv(INT03_PASS_ENV, INT03_PASS_VALUE)];
    const before = snapshotTestEnv();
    try {
      const configured = { [INT03_HOST]: { usernameEnv: INT03_USER_ENV, passwordEnv: INT03_PASS_ENV } };
      const prompter = createScriptedPrompter(['', '', '', 'use-env']);
      const resolved = await promptInteractiveAuth(prompter, plan.registries, configured);
      expect(resolved.auth).toEqual(configured);
      expect(resolved.authValues[INT03_HOST]).toEqual({ username: INT03_USER_VALUE, password: INT03_PASS_VALUE });

      const secrets = collectInteractiveSecrets(plan, resolved.auth, resolved.authValues);
      const login = createLoginRunner();
      await loginWithInteractiveAuth(login.runner, plan, resolved.auth, resolved.authValues, secrets);
      expect(login.calls).toHaveLength(1);
      expect(login.calls[0].executable).toBe(plan.dockerExecutable);
      expect(login.calls[0].args).toEqual(['login', '--username', INT03_USER_VALUE, '--password-stdin', INT03_HOST]);
      expect(login.calls[0].options.stdin).toBe(INT03_PASS_VALUE);
      expect(login.calls[0].options.cwd).toBe(plan.cwd);
      expect({ ...process.env }).toEqual(before);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });

  it('routes an entered password to login only and keeps it out of summaries, config output, and errors', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv(INT03_USER_ENV, INT03_USER_VALUE), setTestEnv(INT03_PASS_ENV, 'int03-old-pass')];
    const before = snapshotTestEnv();
    try {
      const configured = { [INT03_HOST]: { usernameEnv: INT03_USER_ENV, passwordEnv: INT03_PASS_ENV } };
      const prompter = createScriptedPrompter(['', '', '', 'enter-new', INT03_NEW_PASS]);
      const resolved = await promptInteractiveAuth(prompter, plan.registries, configured);
      expect(resolved.authValues[INT03_HOST]?.password).toBe(INT03_NEW_PASS);

      const login = createLoginRunner();
      const secrets = collectInteractiveSecrets(plan, resolved.auth, resolved.authValues);
      await loginWithInteractiveAuth(login.runner, plan, resolved.auth, resolved.authValues, secrets);
      expect(login.calls[0].options.stdin).toBe(INT03_NEW_PASS);

      const summary = planSummary('publish', plan, false);
      expect(JSON.stringify(summary)).not.toContain(INT03_NEW_PASS);
      expect(JSON.stringify(resolved.auth)).not.toContain(INT03_NEW_PASS);
      expect(JSON.stringify(resolved.auth)).not.toContain(INT03_PASS_VALUE);
      expect(secrets).toContain(INT03_NEW_PASS);
      expect(redactSensitiveValues(`push failed using ${INT03_NEW_PASS}`, secrets)).not.toContain(INT03_NEW_PASS);

      const failing = createLoginRunner(`registry exploded ${INT03_NEW_PASS}`);
      const failure = await loginWithInteractiveAuth(
        failing.runner,
        plan,
        resolved.auth,
        resolved.authValues,
        secrets,
      ).then(
        () => {
          throw new Error('expected the login to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toContain(INT03_HOST);
      expect(failure.message).not.toContain(INT03_NEW_PASS);
      expect({ ...process.env }).toEqual(before);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });

  it('falls back to masked entry when the password env var is missing', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv(INT03_USER_ENV, INT03_USER_VALUE), setTestEnv(INT03_PASS_ENV, undefined)];
    try {
      const prompter = createScriptedPrompter([INT03_USER_ENV, '', INT03_PASS_ENV, 'int03-typed-pass']);
      const resolved = await promptInteractiveAuth(prompter, plan.registries, {});
      expect(resolved.authValues[INT03_HOST]).toEqual({
        username: INT03_USER_VALUE,
        password: 'int03-typed-pass',
      });
      expect(prompter.calls.filter((call) => call.kind === 'select')).toHaveLength(0);
      expect(prompter.calls.filter((call) => call.kind === 'password')).toHaveLength(1);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });

  it('falls back to masked entry when the password env var is empty', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv(INT03_USER_ENV, INT03_USER_VALUE), setTestEnv(INT03_PASS_ENV, '')];
    try {
      const prompter = createScriptedPrompter([INT03_USER_ENV, '', INT03_PASS_ENV, 'int03-typed-pass']);
      const resolved = await promptInteractiveAuth(prompter, plan.registries, {});
      expect(resolved.authValues[INT03_HOST]?.password).toBe('int03-typed-pass');
      expect(prompter.calls.filter((call) => call.kind === 'select')).toHaveLength(0);
      expect(prompter.calls.filter((call) => call.kind === 'password')).toHaveLength(1);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });

  it('re-prompts invalid env var names with the validation message', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv('INT03_GOOD_USER_VAR', undefined), setTestEnv('INT03_GOOD_PASS_VAR', undefined)];
    try {
      const prompter = createScriptedPrompter([
        '1BAD',
        'INT03_GOOD_USER_VAR',
        'int03-typed-user',
        'INT03_GOOD_PASS_VAR',
        'int03-typed-pass',
      ]);
      const resolved = await promptInteractiveAuth(prompter, plan.registries, {});
      expect(resolved.auth[INT03_HOST]).toEqual({
        usernameEnv: 'INT03_GOOD_USER_VAR',
        passwordEnv: 'INT03_GOOD_PASS_VAR',
      });
      expect(prompter.calls.filter((call) => call.message === `Registry ${INT03_HOST} username env var`)).toHaveLength(
        2,
      );
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });

  it('accepts the $VAR username default when set and re-prompts an empty username when unset', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});

    const setRestore = setTestEnv(INT03_USER_ENV, INT03_USER_VALUE);
    const setPassRestore = setTestEnv(INT03_PASS_ENV, undefined);
    try {
      const setPrompter = createScriptedPrompter([INT03_USER_ENV, '', INT03_PASS_ENV, 'int03-typed-pass']);
      const setResolved = await promptInteractiveAuth(setPrompter, plan.registries, {});
      expect(setResolved.authValues[INT03_HOST]?.username).toBe(INT03_USER_VALUE);
      expect(
        setPrompter.calls.filter((call) => call.message.startsWith(`Username for registry ${INT03_HOST}`)),
      ).toHaveLength(1);
    } finally {
      setRestore();
      setPassRestore();
    }

    const unsetRestores = [setTestEnv(INT03_USER_ENV, undefined), setTestEnv(INT03_PASS_ENV, undefined)];
    try {
      const unsetPrompter = createScriptedPrompter([
        INT03_USER_ENV,
        '',
        'int03-typed-user',
        INT03_PASS_ENV,
        'int03-typed-pass',
      ]);
      const unsetResolved = await promptInteractiveAuth(unsetPrompter, plan.registries, {});
      expect(unsetResolved.authValues[INT03_HOST]?.username).toBe('int03-typed-user');
      expect(
        unsetPrompter.calls.filter((call) => call.message.startsWith(`Username for registry ${INT03_HOST}`)),
      ).toHaveLength(2);
    } finally {
      for (const restore of unsetRestores.reverse()) {
        restore();
      }
    }
  });

  it('cancels the auth flow at any stage', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    await expect(promptInteractiveAuth(createScriptedPrompter([SCRIPTED_CANCEL]), plan.registries, {})).rejects.toThrow(
      'Operation cancelled.',
    );
  });
});

describe('interactive confirm-before-push', () => {
  it('defaults to Yes for build-only and requires an explicit affirmative before any push', async () => {
    const buildOnly = createConfirmCapturingPrompter(true);
    await confirmInteractiveProceed(buildOnly.prompter, { requiresPush: false });
    expect(buildOnly.confirms).toHaveLength(1);
    expect(buildOnly.confirms[0].message).toBe('Proceed?');
    expect(buildOnly.confirms[0].initialValue).toBe(true);

    const push = createConfirmCapturingPrompter(true);
    await confirmInteractiveProceed(push.prompter, { requiresPush: true });
    expect(push.confirms[0].initialValue).toBe(false);
  });

  it('throws Operation cancelled when the push confirm is declined or cancelled', async () => {
    await expect(confirmInteractiveProceed(createScriptedPrompter([false]), { requiresPush: true })).rejects.toThrow(
      'Operation cancelled.',
    );
    await expect(
      confirmInteractiveProceed(createScriptedPrompter([SCRIPTED_CANCEL]), { requiresPush: true }),
    ).rejects.toThrow('Operation cancelled.');
    await expect(confirmInteractiveProceed(createScriptedPrompter([false]), { requiresPush: false })).rejects.toThrow(
      'Operation cancelled.',
    );
  });

  it('never invokes the runner when the push confirm is declined', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv(INT03_USER_ENV, INT03_USER_VALUE), setTestEnv(INT03_PASS_ENV, INT03_PASS_VALUE)];
    try {
      const configured = { [INT03_HOST]: { usernameEnv: INT03_USER_ENV, passwordEnv: INT03_PASS_ENV } };
      const prompter = createScriptedPrompter(['', '', '', 'use-env', false]);
      const login = createLoginRunner();
      await expect(
        (async () => {
          const resolved = await promptInteractiveAuth(prompter, plan.registries, configured);
          const secrets = collectInteractiveSecrets(plan, resolved.auth, resolved.authValues);
          printSummaryForTest(plan, resolved, secrets);
          await confirmInteractiveProceed(prompter, { requiresPush: true });
          await loginWithInteractiveAuth(login.runner, plan, resolved.auth, resolved.authValues, secrets);
        })(),
      ).rejects.toThrow('Operation cancelled.');
      expect(login.calls).toHaveLength(0);

      function printSummaryForTest(
        summaryPlan: typeof plan,
        resolved: { auth: unknown; authValues: unknown },
        secrets: ReadonlyArray<string>,
      ): void {
        const rendered = JSON.stringify({ ...planSummary('publish', summaryPlan, false), auth: resolved.auth });
        for (const secret of secrets) {
          expect(rendered).not.toContain(secret);
        }
      }
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });
});

describe('interactive dry-run short-circuit', () => {
  it('prints the plan and returns before auth prompts and confirm', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const configured = { [INT03_HOST]: { usernameEnv: INT03_USER_ENV, passwordEnv: INT03_PASS_ENV } };
    const printed: object[] = [];
    const prompter = createScriptedPrompter([]);
    const result = await resolveInteractiveAuthAndConfirm(prompter, plan, configured, {
      operation: 'publish',
      requiresPush: true,
      dryRun: true,
      printSummaryFn: (summary) => {
        printed.push(summary);
      },
    });
    expect(result.dryRun).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.auth).toEqual({});
    expect(result.authValues).toEqual({});
    expect(prompter.calls).toHaveLength(0);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toEqual(planSummary('publish', plan, true));
  });

  it('prints a secrets-free summary and requires confirm on the non-dry-run path', async () => {
    const root = project();
    seedBaseProject(root);
    const configPath = writeConfig(root, 'docker-publish.json', baseConfig(root));
    const { plan } = await resolveDockerPublishCliOptions(flags({ config: configPath }), {});
    const restores = [setTestEnv(INT03_USER_ENV, INT03_USER_VALUE), setTestEnv(INT03_PASS_ENV, INT03_PASS_VALUE)];
    const before = snapshotTestEnv();
    try {
      const configured = { [INT03_HOST]: { usernameEnv: INT03_USER_ENV, passwordEnv: INT03_PASS_ENV } };
      const printed: object[] = [];
      const prompter = createScriptedPrompter(['', '', '', 'enter-new', INT03_NEW_PASS, true]);
      const result = await resolveInteractiveAuthAndConfirm(prompter, plan, configured, {
        operation: 'publish',
        requiresPush: true,
        printSummaryFn: (summary) => {
          printed.push(summary);
        },
      });
      expect(result.dryRun).toBe(false);
      expect(result.confirmed).toBe(true);
      expect(result.authValues[INT03_HOST]?.password).toBe(INT03_NEW_PASS);
      expect(printed).toHaveLength(1);
      expect(printed[0]).toEqual(planSummary('publish', plan, false));
      expect(JSON.stringify(printed[0])).not.toContain(INT03_NEW_PASS);
      expect(result.secrets).toContain(INT03_NEW_PASS);
      const login = createLoginRunner();
      await loginWithInteractiveAuth(login.runner, plan, result.auth, result.authValues, result.secrets);
      expect(login.calls[0].options.stdin).toBe(INT03_NEW_PASS);
      expect({ ...process.env }).toEqual(before);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  });
});
