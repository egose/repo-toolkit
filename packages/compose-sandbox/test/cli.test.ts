import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { SPECS, printHelp, resolveComposeSandboxCliOptions, redactPlanForOutput } from '../src/cli';
import { resolveComposeSandboxPlan } from '../src/plan';

const packageRoot = resolve(import.meta.dirname, '..');
const cliPath = resolve(packageRoot, 'dist', 'cli.js');

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

describe('compose-sandbox CLI', () => {
  it('prints help without requiring Docker', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('repo-toolkit-compose-sandbox');
    expect(result.stdout).toContain('--config');
    expect(result.stdout).toContain('--cwd');
    expect(result.stdout).toContain('--dry-run');
    expect(result.stdout).toContain('--project-name');
    expect(result.stdout).toContain('--evidence-dir');
    expect(result.stdout).toContain('--compose-file');
    expect(result.stderr).toBe('');
  });

  it('-h short help also works', () => {
    const result = runCli(['-h']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('SPECS entries match the flags advertised in help output', () => {
    const names = new Set(SPECS.map((s) => s.name));
    expect(names.has('config')).toBe(true);
    expect(names.has('cwd')).toBe(true);
    expect(names.has('compose-file')).toBe(true);
    expect(names.has('project-name')).toBe(true);
    expect(names.has('evidence-dir')).toBe(true);
    expect(names.has('dry-run')).toBe(true);
    const help = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' }).stdout;
    for (const name of names) {
      expect(help).toContain(`--${name}`);
    }
  });

  it('parseFlags supports overrides and dry-run', () => {
    const parsed = parseFlags(
      [
        '--config',
        'a.json',
        '--cwd',
        '/tmp',
        '--compose-file',
        'a.yml',
        '--compose-file',
        'b.yml',
        '--project-name',
        'myproj',
        '--evidence-dir',
        'logs',
        '--dry-run',
      ],
      SPECS,
    );
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('parse null');
    expect(parsed.values.config).toBe('a.json');
    expect(parsed.values.cwd).toBe('/tmp');
    expect(parsed.values['project-name']).toBe('myproj');
    expect(parsed.values['evidence-dir']).toBe('logs');
    expect(parsed.values['dry-run']).toBe('true');
    expect(parsed.repeat['compose-file']).toEqual(['a.yml', 'b.yml']);
  });

  it('dry-run prints redacted plan without Docker and exits 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-dry-'));
    try {
      const configPath = join(dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['a.yml'] },
          test: { executable: 'echo', args: ['hi'], env: { SECRET: 's3cr3t-value' } },
          readiness: [{ type: 'command', executable: 'echo', args: ['x'], env: { TOKEN: 'abcd1234' } }],
        }),
        'utf8',
      );
      await writeFile(join(dir, 'a.yml'), 'services:\n  x:\n    image: alpine\n', 'utf8');
      const result = runCli(['--config', configPath, '--dry-run']);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const output = result.stdout;
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('s3cr3t-value');
      expect(output).not.toContain('abcd1234');
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect((parsed as { dryRun: boolean }).dryRun).toBe(true);
      const plan = resolveComposeSandboxPlan(JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>);
      const redacted = redactPlanForOutput(plan);
      expect(JSON.stringify(redacted)).toContain('[REDACTED]');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--cwd and overrides compose-file/project-name/evidence-dir affect dry-run plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-overrides-'));
    try {
      const configPath = join(dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['orig.yml'], projectName: 'orig' },
          test: { executable: 'echo', args: ['hi'] },
          evidence: { directory: 'orig-logs' },
        }),
        'utf8',
      );
      await writeFile(join(dir, 'orig.yml'), 'services: {}', 'utf8');
      const result = runCli([
        '--config',
        configPath,
        '--cwd',
        dir,
        '--compose-file',
        'override.yml',
        '--project-name',
        'overridden',
        '--evidence-dir',
        'my-logs',
        '--dry-run',
      ]);
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        compose: { files: string[]; projectName: string };
        evidence: { directory: string };
      };
      expect(out.compose.files).toEqual(['override.yml']);
      expect(out.compose.projectName).toBe('overridden');
      expect(out.evidence.directory).toBe('my-logs');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('invalid config exits nonzero with concise error and no stack or secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-invalid-'));
    try {
      const configPath = join(dir, 'bad.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: [] },
          test: { executable: 'echo', args: ['hi'], env: { SECRET: 'do-not-leak-xyz' } },
        }),
        'utf8',
      );
      const result = runCli(['--config', configPath, '--dry-run']);
      expect(result.status).toBe(1);
      const combined = result.stderr + result.stdout;
      expect(combined).not.toContain('do-not-leak-xyz');
      expect(combined).not.toMatch(/at\s+.*\(.*\.ts:\d+:\d+\)/);
      expect(combined.length).toBeLessThan(5000);
      expect(combined).toMatch(/must contain at least one entry|is required|must be/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('unknown flag exits nonzero with concise error', () => {
    const result = runCli(['--unknown-flag']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument');
  });

  it('printHelp is exported and matches CLI output', () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      captured += String(msg) + '\n';
    };
    try {
      printHelp();
    } finally {
      console.log = origLog;
    }
    expect(captured).toContain('repo-toolkit-compose-sandbox');
    expect(captured).toContain('--dry-run');
  });

  it('resolveComposeSandboxCliOptions merges config and CLI overrides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-merge-'));
    try {
      const configPath = join(dir, 'conf.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['a.yml'], projectName: 'orig' },
          test: { executable: 'echo', args: ['hi'] },
          evidence: { directory: 'ev' },
        }),
        'utf8',
      );
      await writeFile(join(dir, 'a.yml'), 'services: {}', 'utf8');
      const parsed = parseFlags(
        ['--config', configPath, '--project-name', 'newproj', '--evidence-dir', 'newev', '--dry-run'],
        SPECS,
      );
      if (!parsed) throw new Error('parse null');
      const { options, plan } = await resolveComposeSandboxCliOptions(parsed);
      expect((options.compose as { projectName: string }).projectName).toBe('newproj');
      expect((options.evidence as { directory: string }).directory).toBe('newev');
      expect(plan.compose.projectName).toBe('newproj');
      expect(plan.evidence.directory).toBe('newev');
      expect(plan.dryRun).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('redactPlanForOutput redacts env and sensitive headers', () => {
    const plan = resolveComposeSandboxPlan({
      cwd: '/tmp',
      compose: { files: ['a.yml'] },
      test: { executable: 'echo', args: ['hi'], env: { A: 'secret1' } },
      readiness: [
        { type: 'command', executable: 'echo', env: { B: 'secret2' } },
        {
          type: 'http',
          url: 'http://127.0.0.1:8080/',
          headers: { Authorization: 'Bearer token123', 'X-Other': 'keep' },
        },
      ],
    });
    const redacted = redactPlanForOutput(plan);
    const testEnv = (redacted.test as { env: Record<string, string> }).env;
    expect(testEnv.A).toBe('[REDACTED]');
    const readiness = redacted.readiness as Array<Record<string, unknown>>;
    const cmdEnv = (readiness[0] as { env: Record<string, string> }).env;
    expect(cmdEnv.B).toBe('[REDACTED]');
    const httpHeaders = (readiness[1] as { headers: Record<string, string> }).headers;
    expect(httpHeaders.Authorization).toBe('[REDACTED]');
    expect(httpHeaders['X-Other']).toBe('keep');
  });
});
