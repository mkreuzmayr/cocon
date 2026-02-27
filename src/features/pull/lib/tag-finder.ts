import { execAsync } from '../../../lib/spawn.ts';
import {
  toHttpsRepositoryUrl,
  type ResolvedRepository,
} from './repo-resolver.ts';

export interface TagResult {
  tag: string | null;
  usedFallback: boolean;
}

async function listRemoteTags(repoUrl: string): Promise<string[]> {
  const result = await execAsync('git', ['ls-remote', '--tags', repoUrl]);

  if (result.exitCode !== 0) {
    throw new Error(`git ls-remote failed: ${result.stderr}`);
  }

  const tags: string[] = [];
  const lines = result.stdout.trim().split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/refs\/tags\/(.+)$/);
    if (match?.[1] && !match[1].endsWith('^{}')) {
      tags.push(match[1]);
    }
  }
  return tags;
}

export async function findTag(
  repo: ResolvedRepository,
  version: string,
  packageName: string
): Promise<TagResult> {
  const repoUrl = toHttpsRepositoryUrl(repo);

  let tags: string[];
  try {
    tags = await listRemoteTags(`${repoUrl}.git`);
  } catch {
    return { tag: null, usedFallback: true };
  }

  if (tags.length === 0) {
    return { tag: null, usedFallback: true };
  }

  // Pattern 1: Exact match with v prefix
  const vTag = `v${version}`;
  if (tags.includes(vTag)) {
    return { tag: vTag, usedFallback: false };
  }

  // Pattern 2: Exact match without v prefix
  if (tags.includes(version)) {
    return { tag: version, usedFallback: false };
  }

  // Pattern 3: Scoped package format (package@version)
  const scopedTag = `${packageName}@${version}`;
  if (tags.includes(scopedTag)) {
    return { tag: scopedTag, usedFallback: false };
  }

  // Pattern 4: Just the package name without scope for scoped packages
  if (packageName.startsWith('@')) {
    const unscopedName = packageName.split('/')[1];
    const unscopedTag = `${unscopedName}@${version}`;
    if (tags.includes(unscopedTag)) {
      return { tag: unscopedTag, usedFallback: false };
    }
  }

  // Pattern 5: Fuzzy match - find tags containing the version
  const versionPattern = new RegExp(version.replace(/\./g, '\\.'));
  const fuzzyMatch = tags.find((t) => versionPattern.test(t));
  if (fuzzyMatch) {
    return { tag: fuzzyMatch, usedFallback: false };
  }

  // Fallback to default branch
  return { tag: null, usedFallback: true };
}
