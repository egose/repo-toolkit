import { beforeEach, describe, expect, it, vi } from 'vitest';

import { password as clackPassword, select as clackSelect } from '@clack/prompts';
import { promptPassword, promptSelect } from '../src/prompt';

vi.mock('@clack/prompts', () => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  isCancel: (value: unknown) => typeof value === 'symbol',
}));

describe('promptPassword', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the typed value and passes message and mask through', async () => {
    vi.mocked(clackPassword).mockResolvedValue('s3cret');

    const value = await promptPassword({ message: 'Password:', mask: '*' });

    expect(value).toBe('s3cret');
    const args = vi.mocked(clackPassword).mock.calls[0][0];
    expect(args.message).toBe('Password:');
    expect(args.mask).toBe('*');
  });

  it('passes validate through so rejection messages surface', async () => {
    vi.mocked(clackPassword).mockResolvedValue('good');

    await promptPassword({
      message: 'Password:',
      validate: (v) => (v.length === 0 ? 'Password is required' : undefined),
    });

    const passedValidate = vi.mocked(clackPassword).mock.calls[0][0].validate as unknown as (
      v?: string,
    ) => string | undefined;
    expect(passedValidate('')).toBe('Password is required');
    expect(passedValidate('good')).toBeUndefined();
  });

  it('throws Operation cancelled when the prompt is cancelled', async () => {
    vi.mocked(clackPassword).mockResolvedValue(Symbol('cancel'));

    await expect(promptPassword({ message: 'Password:' })).rejects.toThrow('Operation cancelled.');
  });
});

describe('promptSelect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the selected value', async () => {
    vi.mocked(clackSelect).mockResolvedValue('use-env');

    const value = await promptSelect({
      message: 'Password source:',
      options: [
        { value: 'use-env', label: 'Use $VAR from environment' },
        { value: 'enter-new', label: 'Enter a new password' },
      ],
    });

    expect(value).toBe('use-env');
  });

  it('preselects the initial value default', async () => {
    vi.mocked(clackSelect).mockResolvedValue('enter-new');
    const options = [
      { value: 'use-env', label: 'Use $VAR from environment' },
      { value: 'enter-new', label: 'Enter a new password' },
    ];

    const value = await promptSelect({ message: 'Password source:', options, initialValue: 'enter-new' });

    expect(value).toBe('enter-new');
    const args = vi.mocked(clackSelect).mock.calls[0][0];
    expect(args.options).toEqual(options);
    expect(args.initialValue).toBe('enter-new');
  });

  it('throws Operation cancelled when the prompt is cancelled', async () => {
    vi.mocked(clackSelect).mockResolvedValue(Symbol('cancel'));

    await expect(promptSelect({ message: 'Password source:', options: [{ value: 'a', label: 'A' }] })).rejects.toThrow(
      'Operation cancelled.',
    );
  });
});
