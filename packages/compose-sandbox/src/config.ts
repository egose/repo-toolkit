import { loadConfigFile, isPlainObject } from '@repo-toolkit/publish-package';

import { resolveComposeSandboxPlan, type ComposeSandboxPlan } from './plan';

export function mergeComposeSandboxOptions(
  loaded: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...loaded };
  for (const [key, value] of Object.entries(overrides)) {
    if ((key === 'compose' || key === 'evidence') && isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export async function loadAndMergeComposeSandboxOptions(
  options: unknown = {},
): Promise<{ merged: Record<string, unknown>; plan: ComposeSandboxPlan }> {
  let mergedOptions: Record<string, unknown>;
  if (isPlainObject(options) && typeof (options as Record<string, unknown>).config === 'string') {
    const cfg = options as Record<string, unknown>;
    const configPath = cfg.config as string;
    const cwdHint = typeof cfg.cwd === 'string' ? (cfg.cwd as string) : undefined;
    const loaded = await loadConfigFile<Record<string, unknown>>(configPath, cwdHint);
    if (Object.prototype.hasOwnProperty.call(loaded, 'config')) {
      throw new Error('config key is not allowed inside config file');
    }
    const withoutConfig = { ...cfg } as Record<string, unknown>;
    delete withoutConfig.config;
    mergedOptions = mergeComposeSandboxOptions(loaded as Record<string, unknown>, withoutConfig);
  } else if (isPlainObject(options)) {
    mergedOptions = { ...(options as Record<string, unknown>) };
  } else {
    const plan = resolveComposeSandboxPlan(options);
    return { merged: options as unknown as Record<string, unknown>, plan };
  }
  const plan = resolveComposeSandboxPlan(mergedOptions);
  return { merged: mergedOptions, plan };
}
