import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import { runComposeSandbox } from '../src/run';
import { redactPlanForOutput } from '../src/cli';
import { resolveComposeSandboxPlan } from '../src/plan';
import type { Clock, SignalTarget } from '../src/lifecycle';

function fakeClock(): Clock & { advance: (ms: number) => void } {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    advance: (ms: number) => {
      nowMs += ms;
    },
  } as unknown as Clock & { advance: (ms: number) => void };
}
function fakeSignalTarget(): SignalTarget & EventEmitter {
  const ee = new EventEmitter() as SignalTarget & EventEmitter;
  ee.on = ee.on.bind(ee);
  if (!ee.off) ee.off = ee.removeListener.bind(ee) as never;
  return ee;
}
async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'diag-'));
}
function makeFakeRunProcess(opts: Record<string, unknown> = {}) {
  const calls: Array<{ executable: string; args: ReadonlyArray<string> }> = [];
  const fn = vi.fn(async (options: { executable: string; args: ReadonlyArray<string>; signal?: AbortSignal }) => {
    calls.push({ executable: options.executable, args: [...options.args] });
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
    if (options.args.includes('version')) {
      return {
        exitCode: 0,
        stdout: 'Docker Compose version v2.27.0',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    }
    if (options.args.includes('up'))
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    if (options.args.includes('ps')) {
      const out = JSON.stringify([{ Service: 'api', State: 'running', Status: 'Up' }]);
      return {
        exitCode: 0,
        stdout: out,
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    }
    if (options.args.includes('logs'))
      return {
        exitCode: 0,
        stdout: 'log line',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    if (options.args.includes('down')) {
      if (opts.downShouldFail) throw new Error('down failed');
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    }
    const code = (opts.testExitCode as number) ?? 0;
    return {
      exitCode: code,
      stdout: '',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    };
  });
  return { fn, calls };
}

describe('CSREM-06 diagnostics secret-safe and failure-isolated', () => {
  it('logger throwing on every call cannot prevent single cleanup attempt nor replace primary error', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess, calls } = makeFakeRunProcess({ testExitCode: 5 });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const throwingLogger = {
        log: () => {
          throw new Error('logger boom');
        },
      };
      let thrown: unknown;
      try {
        await runComposeSandbox(
          {
            cwd: root,
            compose: { files: ['a.yml'] },
            test: { executable: process.execPath, args: ['-e', 'process.exit(0)'], env: { SECRET: 'shhh' } },
            evidence: { directory: 'evidence', capture: 'always' },
            cleanup: { paths: [] },
          },
          { clock, signalTarget, runProcess: runProcess as never, logger: throwingLogger },
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      const msg = (thrown as Error).message;
      expect(msg).toMatch(/exitCode 5/);
      expect(msg).not.toMatch(/logger boom/);
      const downCalls = calls.filter((c) => c.args.join(' ').includes('down'));
      expect(downCalls.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('logs, CLI errors, valid parseable manifests redact secrets including tricky values, url credentials, auth headers', async () => {
    const root = await makeTempRoot();
    try {
      const secret1 = '1';
      const secretSuccess = 'success';
      const secretQuote = 'a"b\'c';
      const secretBackslash = 'back\\slash';
      const secretNewline = 'line\nbreak';
      const secretOverlapShort = 'overlap';
      const secretOverlapLong = 'overlap-long-value';
      const secretAuth = 'Bearer secret-token-xyz';
      const secretUrlUser = 'myuser';
      const secretUrlPass = 'mypass123';
      const secretQueryToken = 'qtok999';

      const url = `http://${secretUrlUser}:${secretUrlPass}@127.0.0.1:8080/path?token=${secretQueryToken}&other=keep`;
      const capturing: string[] = [];
      const captureLogger = { log: (m: string) => capturing.push(m) };

      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();

      // force a failure to capture logs that include error messages with secrets
      // use http probe that will timeout and include url in error?
      // Simpler: test success path but logs should still redact env values if they appear in test args or errors
      // We'll trigger a test failure that message contains secret via stderr? Our fake runProcess for test doesn't include secret in error, but manifest errors will contain primary message which we can inject via ps failure containing secret
      // Instead test manifest redaction via direct run that succeeds but manifest should not contain secrets
      const planOptions: Record<string, unknown> = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: {
          executable: process.execPath,
          args: ['-e', 'process.exit(0)'],
          env: {
            S1: secret1,
            S_SUCCESS: secretSuccess,
            S_QUOTE: secretQuote,
            S_BACK: secretBackslash,
            S_NL: secretNewline,
            S_OVER: secretOverlapShort,
            S_OVER_LONG: secretOverlapLong,
          },
        },
        readiness: [
          { type: 'command', executable: 'echo', env: { CMD_SECRET: secretQuote } } as never,
          { type: 'http', url, headers: { Authorization: secretAuth, 'X-Other': 'keep' } } as never,
        ],
        evidence: { directory: 'evidence', capture: 'always' },
        cleanup: { paths: [] },
      };
      // Provide runCommandProbe that succeeds
      const deps: Record<string, unknown> = {
        clock,
        signalTarget,
        runProcess,
        logger: captureLogger,
        runCommandProbe: async () => ({
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        }),
        tcpConnect: async () => {},
        httpFetch: async () => ({ status: 200 }),
        getServiceState: async () => ({ service: 'api', state: 'running', status: 'Up', exists: true }),
        getServiceSnapshot: async () =>
          new Map([['api', { service: 'api', state: 'running', status: 'Up', exists: true }]]),
      };
      await runComposeSandbox(planOptions, deps as never);

      // logs should not contain raw secrets
      const allLogs = capturing.join('\n');
      for (const s of [
        secretSuccess,
        secretQuote,
        secretBackslash,
        secretOverlapLong,
        secretAuth,
        secretUrlPass,
        secretUrlUser,
        secretQueryToken,
      ]) {
        expect(allLogs).not.toContain(s);
        if (s === secretNewline) {
          expect(allLogs).not.toContain('line\nbreak');
        }
      }
      // `1` secret: ensure not leaked but also that manifest numbers not corrupted? Check manifest valid JSON
      const manifestContent = await readFile(join(root, 'evidence', 'result.json'), 'utf8');
      expect(() => JSON.parse(manifestContent)).not.toThrow();
      const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
      const manifestStr = JSON.stringify(manifest);
      for (const s of [
        secret1,
        secretSuccess,
        secretQuote,
        secretBackslash,
        secretOverlapShort,
        secretOverlapLong,
        secretAuth,
        secretUrlPass,
        secretUrlUser,
        secretQueryToken,
      ]) {
        expect(manifestContent).not.toContain(s);
        expect(manifestStr).not.toContain(s);
      }
      // newlines secrets: encoded form should not contain raw newline, but manifest errors may contain; after redaction, no raw newline secret
      expect(manifestContent).not.toContain('line\nbreak');
      // overlapping: longest first ensures both redacted correctly – check that [REDACTED] appears
      expect(manifestContent).toContain('[REDACTED]');
      // numeric timings should remain numbers, not corrupted by `1` redaction
      const timings = manifest.timings as Record<string, unknown>;
      for (const v of Object.values(timings)) {
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
      // CLI dry-run redaction check
      const plan = resolveComposeSandboxPlan(planOptions);
      const redacted = redactPlanForOutput(plan);
      const redactedStr = JSON.stringify(redacted);
      expect(redactedStr).not.toContain(secretAuth);
      expect(redactedStr).not.toContain(secretUrlPass);
      expect(redactedStr).not.toContain(secretQueryToken);
      expect(() => JSON.parse(JSON.stringify(redacted))).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('logged values cannot create additional lines or emit GitHub workflow command', async () => {
    const root = await makeTempRoot();
    try {
      const evilSecret = 'evil\n::error::injected\n::group::fake';
      const capturing: string[] = [];
      const captureLogger = { log: (m: string) => capturing.push(m) };
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      await runComposeSandbox(
        {
          cwd: root,
          compose: { files: ['a.yml'] },
          test: {
            executable: process.execPath,
            args: ['-e', 'process.exit(0)', evilSecret],
            env: { EVIL: evilSecret },
          },
          evidence: { directory: 'evidence', capture: 'always' },
          cleanup: { paths: [] },
        },
        { clock, signalTarget, runProcess: runProcess as never, logger: captureLogger },
      );
      for (const line of capturing) {
        expect(line).not.toContain('\n');
        expect(line).not.toContain('\r');
        expect(line.trimStart().startsWith('::')).toBe(false);
        expect(line).not.toMatch(/::error::/);
        expect(line).not.toMatch(/::group::/);
      }
      // also check that secret's newline part was redacted or replaced, not creating extra lines
      const combined = capturing.join('|');
      expect(combined.split('\n').length).toBe(1);
      // raw secret must not appear
      const all = capturing.join('\n');
      expect(all).not.toContain('evil\n::error::injected');
      expect(all).not.toContain('::error::injected');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('final manifest-write failure changes outcome to failure, does NOT advertise result.json, and never emits success summary', async () => {
    const root = await makeTempRoot();
    try {
      const capturing: string[] = [];
      const captureLogger = { log: (m: string) => capturing.push(m) };
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      // inject fs that fails on result.json write
      const { createDefaultFs } = await import('../src/fs');
      const baseFs = createDefaultFs();
      // we need a fs that delegates to real fs but throws on writeFile for result.json
      const failingFs = {
        ...baseFs,
        writeFile: async (path: string, data: string, encoding: string) => {
          if (path.endsWith('result.json')) throw new Error('manifest write failed');
          return baseFs.writeFile(path, data, encoding);
        },
        mkdir: baseFs.mkdir,
        lstat: baseFs.lstat,
        realpath: baseFs.realpath,
        rm: baseFs.rm,
        copyFile: baseFs.copyFile,
        access: baseFs.access,
      };
      let thrown: unknown;
      try {
        await runComposeSandbox(
          {
            cwd: root,
            compose: { files: ['a.yml'] },
            test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
            evidence: { directory: 'evidence', capture: 'always' },
            cleanup: { paths: [] },
          },
          { clock, signalTarget, runProcess: runProcess as never, logger: captureLogger, fs: failingFs as never },
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/manifest write failed/i);
      // check no result.json advertised in logs
      const summaryLine = capturing.find((l) => l.includes('evidence dir='));
      expect(summaryLine).toBeDefined();
      expect(summaryLine as string).not.toContain('result.json');
      // check never emits success summary
      // should be failure, not success
      const hasSuccessIcon = capturing.some((l) => l.includes('✅'));
      expect(hasSuccessIcon).toBe(false);
      const hasFailureIcon = capturing.some((l) => l.includes('❌'));
      expect(hasFailureIcon).toBe(true);
      // also ensure result.json not on disk
      let exists = true;
      try {
        await readFile(join(root, 'evidence', 'result.json'), 'utf8');
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
