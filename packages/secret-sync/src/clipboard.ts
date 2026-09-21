import { spawnSync } from 'node:child_process';

import { SecretSyncError } from './errors';

export interface ClipboardCommand {
  command: string;
  args: string[];
  installHint: string;
}

export interface ClipboardWriter {
  write(bytes: Uint8Array): Promise<{ command: string }>;
}

export type ClipboardSpawn = (command: string, args: string[], bytes: Uint8Array) => { ok: boolean; missing: boolean };

export function defaultClipboardSpawn(
  command: string,
  args: string[],
  bytes: Uint8Array,
): { ok: boolean; missing: boolean } {
  try {
    const completed = spawnSync(command, args, {
      input: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    if (completed.error !== undefined) {
      return { ok: false, missing: true };
    }
    return { ok: completed.status === 0, missing: false };
  } catch {
    return { ok: false, missing: true };
  }
}

export function resolveClipboardCandidates(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ClipboardCommand[] {
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [], installHint: 'pbcopy ships with macOS.' }];
  }
  if (platform === 'win32') {
    return [{ command: 'clip', args: [], installHint: 'clip ships with Windows.' }];
  }
  const candidates: ClipboardCommand[] = [];
  if (typeof env.WAYLAND_DISPLAY === 'string' && env.WAYLAND_DISPLAY.length > 0) {
    candidates.push({ command: 'wl-copy', args: [], installHint: 'Install wl-clipboard for Wayland sessions.' });
  }
  if (typeof env.DISPLAY === 'string' && env.DISPLAY.length > 0) {
    candidates.push(
      { command: 'xclip', args: ['-selection', 'clipboard'], installHint: 'Install xclip for X11 sessions.' },
      { command: 'xsel', args: ['--clipboard', '--input'], installHint: 'Install xsel for X11 sessions.' },
    );
  }
  return candidates;
}

export function systemClipboardWriter(
  spawn: ClipboardSpawn = defaultClipboardSpawn,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ClipboardWriter {
  const candidates = resolveClipboardCandidates(platform, env);
  if (candidates.length === 0) {
    throw new SecretSyncError(
      'validation',
      'No clipboard session detected (set WAYLAND_DISPLAY or DISPLAY on Linux); copy requires a graphical session.',
    );
  }
  return {
    write: async (bytes: Uint8Array) => {
      const missing: string[] = [];
      for (const candidate of candidates) {
        const result = spawn(candidate.command, candidate.args, bytes);
        if (result.ok) {
          return { command: candidate.command };
        }
        if (result.missing) {
          missing.push(`${candidate.command} (${candidate.installHint})`);
          continue;
        }
        throw new SecretSyncError(
          'server',
          `Clipboard tool ${JSON.stringify(candidate.command)} refused the write; nothing was printed instead.`,
        );
      }
      throw new SecretSyncError('validation', `No clipboard tool found (tried ${missing.join(', ')}).`);
    },
  };
}
