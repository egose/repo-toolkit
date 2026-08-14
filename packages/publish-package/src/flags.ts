export interface FlagSpec {
  /** Canonical flag name (without the leading `--`). */
  name: string;
  /** Aliases accepted in place of the canonical name (without `--`). */
  aliases?: ReadonlyArray<string>;
  /** Boolean flag: consumes no value; `values[name]` becomes `'true'`. */
  boolean?: boolean;
  /** For boolean flags: accept `--no-<name>` to set `values[name]` to `'false'`. */
  negatable?: boolean;
  /** Comma-separated list: each occurrence splits on commas and appends to `repeat[name]`. */
  list?: boolean;
  /** Repeatable string: each occurrence appends one raw value to `repeat[name]`. */
  repeatable?: boolean;
}

export interface ParseFlagsResult {
  /** Map of flag name → last value seen (string, or `'true'`/`'false'` for booleans). */
  values: Record<string, string>;
  /** Map of list/repeatable flag name → accumulated values. */
  repeat: Record<string, string[]>;
  /** Unknown arguments collected when `strict` is `false`. */
  unknown: string[];
}

export interface ParseFlagsOptions {
  /** Throw on the first unknown argument (default: `true`). */
  strict?: boolean;
}

export function parseFlags(
  argv: string[],
  specs: ReadonlyArray<FlagSpec>,
  options: ParseFlagsOptions = {},
): ParseFlagsResult | null {
  const byKey = new Map<string, FlagSpec>();

  for (const spec of specs) {
    registerFlagSpec(byKey, spec.name, spec);

    for (const alias of spec.aliases ?? []) {
      registerFlagSpec(byKey, alias, spec);
    }
  }

  const strict = options.strict ?? true;
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  const repeat: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const unknown: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    let arg = argv[index];

    if (arg === '--' && index === 0) {
      continue;
    }

    if (arg === '--') {
      const remaining = argv.slice(index + 1);
      if (remaining.length === 0) {
        break;
      }

      if (strict) {
        throw new Error(`Unknown argument: ${remaining[0]}`);
      }

      unknown.push(...remaining);
      break;
    }

    if (arg === '-h' || arg === '--help') {
      return null;
    }

    if (arg.startsWith('-') && !arg.startsWith('--') && arg !== '-') {
      const shortBody = arg.slice(1);
      const eqIdx = shortBody.indexOf('=');
      const shortKey = eqIdx >= 0 ? shortBody.slice(0, eqIdx) : shortBody;
      const shortSpec = byKey.get(shortKey);

      if (shortSpec) {
        arg = eqIdx >= 0 ? `--${shortSpec.name}=${shortBody.slice(eqIdx + 1)}` : `--${shortSpec.name}`;
      }
    }

    if (!arg.startsWith('--')) {
      if (strict) {
        throw new Error(`Unknown argument: ${arg}`);
      }
      unknown.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalsIndex = body.indexOf('=');
    const key = equalsIndex >= 0 ? body.slice(0, equalsIndex) : body;
    const inlineValue = equalsIndex >= 0 ? body.slice(equalsIndex + 1) : undefined;

    // Negation for negatable boolean flags (`--no-<name>`).
    if (key.startsWith('no-')) {
      const positiveKey = key.slice(3);
      const spec = byKey.get(positiveKey);

      if (spec && spec.boolean && spec.negatable) {
        if (inlineValue !== undefined) {
          throw new Error(`Boolean flag --no-${positiveKey} does not take a value.`);
        }
        values[spec.name] = 'false';
        continue;
      }
    }

    const spec = byKey.get(key);

    if (!spec) {
      if (strict) {
        throw new Error(`Unknown argument: ${arg}`);
      }
      unknown.push(arg);
      continue;
    }

    const flag = `--${spec.name}`;

    if (spec.boolean) {
      if (inlineValue !== undefined) {
        throw new Error(`Boolean flag ${flag} does not take a value.`);
      }
      values[spec.name] = 'true';
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : readValue(argv, index, flag);
    if (inlineValue === undefined) {
      index += 1;
    }

    if (spec.list) {
      (repeat[spec.name] ??= []).push(...splitListArg(value));
    } else if (spec.repeatable) {
      (repeat[spec.name] ??= []).push(value);
    } else {
      values[spec.name] = value;
    }
  }

  return { values, repeat, unknown };
}

function registerFlagSpec(byKey: Map<string, FlagSpec>, key: string, spec: FlagSpec): void {
  const existing = byKey.get(key);
  if (existing) {
    throw new Error(`Duplicate flag registration for ${key}: --${existing.name} and --${spec.name}`);
  }

  byKey.set(key, spec);
}

export function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function splitListArg(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
