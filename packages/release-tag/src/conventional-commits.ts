import type { VersionBump } from '@repo-toolkit/publish-package';

import { assertGitObjectId } from './validation';

interface CommitMessage {
  subject: string;
  body: string;
}

const HEADER_PATTERN = /^(\w[\w-]*)(?:\([^()\r\n]+\))?(!)?:[ \t]+\S[^\r\n]*$/;
const BREAKING_FOOTER_PATTERN = /^BREAKING(?: CHANGE|-CHANGE):[ \t]+\S/m;

export function parseCommitLog(output: string): CommitMessage[] {
  if (output.length === 0) {
    return [];
  }
  const fields = output.split('\0');
  if (fields.pop() !== '' || fields.length % 2 !== 0) {
    throw new Error('git log returned malformed NUL-delimited commit records');
  }
  const commits: CommitMessage[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    assertGitObjectId(fields[index], 'git log commit ID');
    const message = fields[index + 1];
    const lineEnd = message.indexOf('\n');
    commits.push({
      subject: (lineEnd === -1 ? message : message.slice(0, lineEnd)).replace(/\r$/, ''),
      body: lineEnd === -1 ? '' : message.slice(lineEnd + 1),
    });
  }
  return commits;
}

export function selectCommitBump(commits: ReadonlyArray<CommitMessage>): VersionBump {
  let bump: VersionBump = 'patch';
  for (const { subject, body } of commits) {
    const header = HEADER_PATTERN.exec(subject);
    if (header?.[2] === '!' || BREAKING_FOOTER_PATTERN.test(body)) {
      return 'major';
    }
    if (header?.[1].toLowerCase() === 'feat') {
      bump = 'minor';
    }
  }
  return bump;
}
