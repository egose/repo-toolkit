import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type DockerCaptureResult, type DockerRunner, type DockerRunOptions, type DockerRunResult } from '../src/index';

export interface RecordedCall {
  readonly kind: 'run' | 'capture';
  readonly executable: string;
  readonly args: string[];
  readonly options: DockerRunOptions;
}

export function withProject(prefix: string, run: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), prefix));
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

export function writeImageContext(root: string, dir: string, dockerfileName = 'Dockerfile'): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, dockerfileName), 'FROM scratch\n');
}

export function createRecordedRunner(
  hooks: {
    readonly onRun?: (executable: string, args: ReadonlyArray<string>, options: DockerRunOptions) => DockerRunResult;
    readonly onCapture?: (
      executable: string,
      args: ReadonlyArray<string>,
      options: DockerRunOptions,
    ) => DockerCaptureResult;
  } = {},
): { readonly calls: RecordedCall[]; readonly runner: DockerRunner } {
  const calls: RecordedCall[] = [];
  const runner: DockerRunner = {
    run(executable, args, options) {
      calls.push({ kind: 'run', executable, args: [...args], options });
      if (hooks.onRun !== undefined) {
        return hooks.onRun(executable, args, options);
      }
      return { durationMs: 0 };
    },
    capture(executable, args, options) {
      calls.push({ kind: 'capture', executable, args: [...args], options });
      if (hooks.onCapture !== undefined) {
        return hooks.onCapture(executable, args, options);
      }
      return { stdout: '', stderr: '', durationMs: 0, outputBytes: 0 };
    },
  };
  return { calls, runner };
}

export const DIGEST_A = `sha256:${'a'.repeat(64)}`;

export const DIGEST_B = `sha256:${'b'.repeat(64)}`;
