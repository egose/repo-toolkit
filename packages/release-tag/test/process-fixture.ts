import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface FixtureProcess {
  pid: number;
  role: string;
}

export interface NodeFixture {
  cwd: string;
  script: (body: string) => Promise<string>;
  processes: () => Promise<FixtureProcess[]>;
  liveProcesses: () => Promise<FixtureProcess[]>;
  waitForExit: () => Promise<FixtureProcess[]>;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

export async function withNodeFixture(fn: (fixture: NodeFixture) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'release-tag-process-'));
  const processes = async (): Promise<FixtureProcess[]> => {
    let text: string;
    try {
      text = await readFile(join(cwd, 'pids.jsonl'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FixtureProcess);
  };
  const liveProcesses = async (): Promise<FixtureProcess[]> => (await processes()).filter(({ pid }) => alive(pid));
  const waitForExit = async (): Promise<FixtureProcess[]> => {
    const deadline = Date.now() + 2000;
    let live = await liveProcesses();
    while (live.length > 0 && Date.now() < deadline) {
      await delay(20);
      live = await liveProcesses();
    }
    return live;
  };
  const cleanup = async (): Promise<void> => {
    for (const { pid } of (await processes()).reverse()) {
      for (const target of process.platform === 'win32' ? [pid] : [-pid, pid]) {
        try {
          process.kill(target, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
          }
        }
      }
    }
    if ((await waitForExit()).length > 0) {
      throw new Error('Node fixture processes survived independent cleanup');
    }
  };
  const watchdog = setTimeout(() => {
    void cleanup().catch(() => undefined);
  }, 6000);
  try {
    await fn({
      cwd,
      processes,
      liveProcesses,
      waitForExit,
      async script(body) {
        const path = join(cwd, 'child.cjs');
        await writeFile(
          path,
          `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = ${JSON.stringify(cwd)};
const role = process.argv[2] || 'root';
fs.appendFileSync(root + '/pids.jsonl', JSON.stringify({ pid: process.pid, role }) + '\\n');
${body}
`,
        );
        return path;
      },
    });
  } finally {
    clearTimeout(watchdog);
    try {
      await cleanup();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
