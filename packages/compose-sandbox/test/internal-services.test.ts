import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { performCleanup } from '../src/cleanup';
import { collectEvidence } from '../src/evidence';
import { createDefaultFs, resolveRealRoot } from '../src/fs';
import { runPhase } from '../src/phase';
import { resolveComposeSandboxPlan } from '../src/plan';
import type { ProcessResult } from '../src/process';

function baseOptions(cwd: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd,
    compose: { files: ['compose.yml'], projectName: 'internalservices' },
    test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
    evidence: { directory: 'evidence', capture: 'always', maxLogBytes: 100, stripAnsi: true },
    cleanup: { paths: [] },
    timeouts: { startupMs: 1000, readinessMs: 1000, testMs: 1000, cleanupMs: 1000 },
    ...overrides,
  };
}

function fakeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    durationMs: 1,
    stdoutTruncated: false,
    stderrTruncated: false,
    truncatedBytes: 0,
    ...overrides,
  };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'compose-internal-services-'));
}

describe('internal phase helper', () => {
  it('records timing and preserves the thrown error', async () => {
    let now = 10;
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    const logs: string[] = [];
    const timings: Record<string, number> = {};
    const failed: { value: 'test' | undefined } = { value: undefined };
    const plan = resolveComposeSandboxPlan(baseOptions(process.cwd()));
    const original = new Error('original failure');

    await expect(
      runPhase('test', clock, { log: (message) => logs.push(message) }, plan, timings, failed, async () => {
        now += 25;
        throw original;
      }),
    ).rejects.toBe(original);

    expect(timings.test).toBe(25);
    expect(failed.value).toBe('test');
    expect(logs.some((line) => line.includes('test failed') && line.includes('original failure'))).toBe(true);
    expect(logs.some((line) => line.includes('✓ test'))).toBe(false);
  });
});

describe('internal evidence service', () => {
  it('captures ps and logs with bounded output without running the lifecycle', async () => {
    const root = await tempRoot();
    try {
      await writeFile(join(root, 'compose.yml'), 'services: {}\n', 'utf8');
      const plan = resolveComposeSandboxPlan(baseOptions(root));
      const fs = createDefaultFs();
      const realRoot = await resolveRealRoot(plan.cwd, fs);
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const args = opts.args.join(' ');
        if (args.includes(' ps '))
          return fakeResult({ stdout: '\u001B[31m[{"Service":"web","State":"running"}]\u001B[0m' });
        if (args.includes(' logs ')) return fakeResult({ stdout: `log-${'x'.repeat(200)}` });
        return fakeResult();
      });
      const files: string[] = [];

      await collectEvidence(plan, { runProcess, fs }, realRoot, undefined, new AbortController().signal, 123, files);

      expect(files).toEqual(['ps.json', 'logs.txt']);
      expect(await readFile(join(root, 'evidence', 'ps.json'), 'utf8')).toContain('Service');
      const logs = await readFile(join(root, 'evidence', 'logs.txt'), 'utf8');
      expect(Buffer.byteLength(logs, 'utf8')).toBeLessThanOrEqual(100);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('internal cleanup service', () => {
  it('runs compose down once and removes configured paths without running the lifecycle', async () => {
    const root = await tempRoot();
    try {
      await writeFile(join(root, 'compose.yml'), 'services: {}\n', 'utf8');
      await mkdir(join(root, 'managed'), { recursive: true });
      await writeFile(join(root, 'managed', 'file.txt'), 'data', 'utf8');
      const plan = resolveComposeSandboxPlan(baseOptions(root, { cleanup: { paths: ['managed'], volumes: true } }));
      const fs = createDefaultFs();
      const realRoot = await resolveRealRoot(plan.cwd, fs);
      const runProcess = vi.fn(async () => fakeResult());

      await performCleanup(plan, { runProcess, fs }, realRoot, undefined, new AbortController().signal, 456);

      expect(runProcess).toHaveBeenCalledTimes(1);
      expect(runProcess.mock.calls[0]?.[0].args).toContain('down');
      await expect(readFile(join(root, 'managed', 'file.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
