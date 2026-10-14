import type {
  CapturingProcessRunner,
  ProcessCaptureOptions,
  ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import { commitLog } from './commit-fixture';

export const SOURCE_COMMIT = 'a'.repeat(40);
export const RELEASED_HEAD = 'b'.repeat(40);

export interface RecordedCapture {
  executable: string;
  args: ReadonlyArray<string>;
  options: ProcessCaptureOptions;
}

export interface ReleaseFixtureState {
  branch: string;
  head: string;
  tagCommit: string | undefined;
  status: string;
}

interface ReleaseRunnerOptions {
  baseBranch?: string;
  sourceCommit?: string;
  tagMessage?: string;
  capture?: (
    executable: string,
    args: ReadonlyArray<string>,
    options: ProcessCaptureOptions,
  ) => ProcessCaptureResult | undefined;
  release?: (state: ReleaseFixtureState) => ProcessCaptureResult | void;
}

export function ok(stdout = ''): ProcessCaptureResult {
  return { stdout, stderr: '', code: 0 };
}

export function failed(stderr: string, code = 1): ProcessCaptureResult {
  return { stdout: '', stderr, code };
}

export function createReleaseRunner(options: ReleaseRunnerOptions = {}): CapturingProcessRunner & {
  captures: RecordedCapture[];
  runs: RecordedCapture[];
  state: ReleaseFixtureState;
} {
  const baseBranch = options.baseBranch ?? 'main';
  const sourceCommit = options.sourceCommit ?? SOURCE_COMMIT;
  const state: ReleaseFixtureState = { branch: baseBranch, head: sourceCommit, tagCommit: undefined, status: '' };
  const captures: RecordedCapture[] = [];
  const runs: RecordedCapture[] = [];
  return {
    captures,
    runs,
    state,
    run() {
      throw new Error('release execution must use capture');
    },
    runShell() {
      throw new Error('release stages must use explicit argument arrays');
    },
    async capture(executable, args, captureOptions) {
      captures.push({ executable, args: [...args], options: captureOptions });
      const releasing = args[1] === '--ci';
      if (releasing) {
        runs.push({ executable, args: [...args], options: captureOptions });
      }
      const override = options.capture?.(executable, args, captureOptions);
      if (override !== undefined) {
        return override;
      }
      if (args[0] === '--version') {
        return ok('1.0.0\n');
      }
      if (releasing) {
        state.head = RELEASED_HEAD;
        state.tagCommit = RELEASED_HEAD;
        return options.release?.(state) ?? ok();
      }
      if (args[0] === 'describe') {
        return ok('v1.2.2\n');
      }
      if (args[0] === 'log') {
        return ok(commitLog('fix: repair\n'));
      }
      if (args[0] === 'for-each-ref') {
        const ref = args[2];
        return ok(ref === `refs/heads/${baseBranch}` ? `${ref}\t${sourceCommit}\t\n` : '');
      }
      if (args[0] === 'ls-remote') {
        return ok(args[2] === 'HEAD' ? `${sourceCommit}\tHEAD\n` : '');
      }
      if (args[0] === 'symbolic-ref') {
        if (args[args.length - 1] !== 'HEAD') {
          return failed('');
        }
        return ok(`${args[1] === '--short' ? '' : 'refs/heads/'}${state.branch}\n`);
      }
      if (args[0] === 'rev-parse') {
        const commit = args[2] === 'HEAD^{commit}' ? state.head : state.tagCommit;
        return commit === undefined ? failed('fatal: Needed a single revision', 128) : ok(`${commit}\n`);
      }
      if (args[0] === '--no-optional-locks' && args[1] === 'status') {
        return ok(state.status);
      }
      if (args[0] === 'config') {
        return args[1] === '--get' ? failed('') : ok();
      }
      if (args[0] === 'checkout') {
        state.branch = args[2];
        state.head = args[3];
        return ok();
      }
      if (args[0] === 'push') {
        return ok();
      }
      if (args[0] === 'tag') {
        return ok(options.tagMessage ?? '');
      }
      throw new Error(`Unexpected fixture command: ${executable} ${args.join(' ')}`);
    },
  };
}
