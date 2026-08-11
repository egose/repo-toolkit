import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { text as clackText, isCancel as clackIsCancel } from '@clack/prompts';

import { isPlainObject } from './helpers';
import type { FlagSpec, ParseFlagsResult } from './flags';

export function resolveConfigPath(configPath: string, cwd?: string): string {
  if (isAbsolute(configPath)) {
    return configPath;
  }

  return resolve(cwd ?? process.cwd(), configPath);
}

export async function loadConfigFile<T>(configPath: string, cwd?: string): Promise<Partial<T>> {
  const resolvedPath = resolveConfigPath(configPath, cwd);

  if (resolvedPath.endsWith('.json')) {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;

    if (!isPlainObject(parsed)) {
      throw new Error(`Config file must export an object: ${resolvedPath}`);
    }

    return parsed as Partial<T>;
  }

  const loaded = (await import(pathToFileURL(resolvedPath).href)) as {
    default?: unknown;
  };
  const config = loaded.default ?? loaded;

  if (!isPlainObject(config)) {
    throw new Error(`Config file must export an object: ${resolvedPath}`);
  }

  return config as Partial<T>;
}

export const INTERACTIVE_FLAG: FlagSpec = { name: 'interactive', aliases: ['i'], boolean: true };

export function canPrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export interface PromptTextOptions {
  message: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
}

export interface ResolveCliOptionsArgs<T extends { cwd?: string }> {
  result: ParseFlagsResult;
  cwd?: string;
  buildOptions: (result: ParseFlagsResult) => Partial<T>;
}

export interface PromptForRequiredValueOptions {
  value: string | undefined;
  interactive: boolean;
  canPromptNow?: boolean;
  message: string;
  missingMessage: string;
  validate?: (value: string) => string | undefined;
}

export async function promptText(opts: PromptTextOptions): Promise<string> {
  const value = await clackText({
    message: opts.message,
    placeholder: opts.placeholder,
    validate: opts.validate ? (v) => opts.validate!(v ?? '') : undefined,
  });

  if (clackIsCancel(value)) {
    throw new Error('Operation cancelled.');
  }

  return value as string;
}

export async function resolveCliOptions<T extends { cwd?: string }>(args: ResolveCliOptionsArgs<T>): Promise<T> {
  const options = args.buildOptions(args.result);
  const configPath = args.result.values.config;
  const config = configPath ? await loadConfigFile<T>(configPath, args.cwd ?? options.cwd) : {};

  return { ...config, ...options } as T;
}

export async function promptForRequiredValue(options: PromptForRequiredValueOptions): Promise<string> {
  if (options.value) {
    return options.value;
  }

  if (options.interactive && (options.canPromptNow ?? canPrompt())) {
    return await promptText({
      message: options.message,
      validate: options.validate,
    });
  }

  throw new Error(options.missingMessage);
}
