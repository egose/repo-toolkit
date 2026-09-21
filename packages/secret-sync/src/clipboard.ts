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

export interface ClipboardSpawnResult {
  ok: boolean;
  missing: boolean;
  stderr?: string;
}

export type ClipboardSpawn = (command: string, args: string[], bytes: Uint8Array) => ClipboardSpawnResult;

function truncateDetail(text: string): string {
  const cleaned = text.replace(/[^\p{L}\p{N}\p{P}\p{S}\p{Z} \t\n]+/gu, ' ').trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 297)}...` : cleaned;
}

export function defaultClipboardSpawn(command: string, args: string[], bytes: Uint8Array): ClipboardSpawnResult {
  try {
    const completed = spawnSync(command, args, {
      input: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      stdio: ['pipe', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    if (completed.error !== undefined) {
      return { ok: false, missing: true };
    }
    if (completed.status === 0) {
      return { ok: true, missing: false };
    }
    const detail = typeof completed.stderr === 'string' ? truncateDetail(completed.stderr) : '';
    return { ok: false, missing: false, ...(detail.length === 0 ? {} : { stderr: detail }) };
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
        const detail =
          result.stderr !== undefined && result.stderr.length > 0 ? ` Tool reported: ${result.stderr}` : '';
        throw new SecretSyncError(
          'server',
          `Clipboard tool ${JSON.stringify(candidate.command)} refused the write; nothing was printed instead.${detail}`,
        );
      }
      throw new SecretSyncError('validation', `No clipboard tool found (tried ${missing.join(', ')}).`);
    },
  };
}
