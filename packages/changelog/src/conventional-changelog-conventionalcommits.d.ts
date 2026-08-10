declare module 'conventional-changelog-conventionalcommits' {
  import type { GetCommitsParams } from '@conventional-changelog/git-client';
  import type { ParserStreamOptions, Commit } from 'conventional-commits-parser';
  import type { Options as WriterOptions } from 'conventional-changelog-writer';

  export interface ConventionalCommitType {
    type: string;
    section?: string;
    hidden?: boolean;
    scope?: string;
  }

  export interface ConventionalCommitsPresetOptions {
    types?: ReadonlyArray<ConventionalCommitType>;
    ignoreCommits?: RegExp;
    issuePrefixes?: ReadonlyArray<string>;
    scope?: string | ReadonlyArray<string>;
    scopeOnly?: boolean;
    preMajor?: boolean;
    issueUrlFormat?: string;
    commitUrlFormat?: string;
    compareUrlFormat?: string;
    userUrlFormat?: string;
    bumpStrict?: boolean;
  }

  export interface ConventionalCommitsPreset {
    commits?: GetCommitsParams;
    parser?: ParserStreamOptions;
    writer?: WriterOptions;
    whatBump?: (commits: Commit[]) => { level: number; reason: string } | null;
  }

  export const DEFAULT_COMMIT_TYPES: ReadonlyArray<ConventionalCommitType>;

  export default function createPreset(
    config?: ConventionalCommitsPresetOptions,
  ): ConventionalCommitsPreset | Promise<ConventionalCommitsPreset>;
}
