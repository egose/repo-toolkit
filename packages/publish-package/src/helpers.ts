export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function inferNpmTag(version: string): string | undefined {
  if (typeof version !== 'string') {
    return undefined;
  }

  let core = version;
  if (core.startsWith('v')) {
    core = core.slice(1);
  }

  const buildIdx = core.indexOf('+');
  if (buildIdx >= 0) {
    core = core.slice(0, buildIdx);
  }

  const hyphenIdx = core.indexOf('-');
  if (hyphenIdx < 0) {
    return undefined;
  }

  const prereleasePart = core.slice(hyphenIdx + 1);
  if (!prereleasePart) {
    return undefined;
  }

  const dotIdx = prereleasePart.indexOf('.');
  const preid = dotIdx >= 0 ? prereleasePart.slice(0, dotIdx) : prereleasePart;
  return preid || undefined;
}

export function normalizeVersion(rawVersion: string): string {
  if (!rawVersion) {
    throw new Error('version not supplied');
  }

  return rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
}
