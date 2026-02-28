import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  getProjectDependencies,
  resolveInstalledPackageFromCwd,
} from '../../../lib/package-json.ts';
import { execAsync } from '../../../lib/spawn.ts';
import { getStoreDir } from '../../../lib/store.ts';
import type {
  PackageSourceResult,
  PullProgressUpdate,
  PullResult,
  SourceStorageOptions,
  StoreOptions,
  SyncProjectDependenciesResult,
} from '../../../lib/types.ts';
import { downloadAndExtract } from './downloader.ts';
import { fetchPackageMetadata } from './package-registry.ts';
import {
  getDefaultBranchTarballUrls,
  getTagTarballUrl,
  normalizeRepositoryToHttpsRepo,
  toHttpsRepositoryUrl,
  type ResolvedRepository,
} from './repo-resolver.ts';
import { findTag } from './tag-finder.ts';

const README_FILE_PATTERN = /^readme(?:\.[^.]+)?$/i;
const GITHUB_REPO_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#][^\s<]*)?/gi;

interface ReadmeRepositoryCandidate {
  owner: string;
  repo: string;
  score: number;
  count: number;
}

function getPackageRepositoryToken(packageName: string): string {
  if (!packageName.startsWith('@')) {
    return packageName.toLowerCase();
  }

  const [, unscopedName] = packageName.split('/');
  return (unscopedName ?? packageName).toLowerCase();
}

function scoreReadmeRepositoryCandidate(
  repositoryName: string,
  packageToken: string
): number {
  const normalizedRepository = repositoryName.toLowerCase();
  if (normalizedRepository === packageToken) {
    return 3;
  }
  if (normalizedRepository.includes(packageToken)) {
    return 2;
  }
  if (packageToken.includes(normalizedRepository)) {
    return 1;
  }
  return 0;
}

function findReadmeRepositoryUrl(
  readmeContent: string,
  packageName: string
): string | null {
  const packageToken = getPackageRepositoryToken(packageName);
  const candidates = new Map<string, ReadmeRepositoryCandidate>();

  for (const match of readmeContent.matchAll(GITHUB_REPO_PATTERN)) {
    const owner = match[1];
    const repo = match[2]?.replace(/\.git$/i, '');
    if (!owner || !repo) {
      continue;
    }

    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    candidates.set(key, {
      owner,
      repo,
      score: scoreReadmeRepositoryCandidate(repo, packageToken),
      count: 1,
    });
  }

  const allCandidates = [...candidates.values()];
  if (allCandidates.length === 0) {
    return null;
  }

  const strongMatch = allCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.count - a.count)[0];

  if (strongMatch) {
    return `https://github.com/${strongMatch.owner}/${strongMatch.repo}`;
  }

  const repeatedFallback = allCandidates.sort((a, b) => b.count - a.count)[0];
  if (repeatedFallback && repeatedFallback.count > 1) {
    return `https://github.com/${repeatedFallback.owner}/${repeatedFallback.repo}`;
  }

  return null;
}

async function resolveRepositoryFromReadme(
  packageDir: string,
  packageName: string
): Promise<ResolvedRepository | null> {
  let readmeFilename: string | null = null;
  try {
    const entries = await fsp.readdir(packageDir);
    readmeFilename = entries.find((e) => README_FILE_PATTERN.test(e)) ?? null;
  } catch {
    return null;
  }

  if (!readmeFilename) {
    return null;
  }

  const readmePath = path.join(packageDir, readmeFilename);
  let readmeContent: string;
  try {
    readmeContent = await fsp.readFile(readmePath, 'utf-8');
  } catch {
    return null;
  }

  const repositoryUrl = findReadmeRepositoryUrl(readmeContent, packageName);
  if (!repositoryUrl) {
    return null;
  }

  return normalizeRepositoryToHttpsRepo(repositoryUrl)?.repo ?? null;
}

function shouldSkipTagLookup(
  packageName: string,
  repo: ResolvedRepository
): boolean {
  return (
    packageName.startsWith('@types/') &&
    repo.host === 'github' &&
    repo.owner.toLowerCase() === 'definitelytyped' &&
    repo.repo.toLowerCase() === 'definitelytyped'
  );
}

async function runGitCommand(args: string[]): Promise<void> {
  const result = await execAsync('git', args);
  if (result.exitCode === 0) {
    return;
  }

  const details = result.stderr.trim();
  throw new Error(
    `git ${args.join(' ')} failed${details ? `: ${details}` : ''}`
  );
}

async function downloadSparseSubdirectory(
  repo: ResolvedRepository,
  packageName: string,
  version: string,
  storeOptions: StoreOptions,
  subdirectory: string,
  ref: string | null
): Promise<void> {
  const storeDir = getStoreDir(storeOptions);
  const outputDir = path.join(storeDir, `${packageName}@${version}`);

  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(outputDir), { recursive: true });

  const tempRoot = await fsp.mkdtemp(path.join(storeDir, '.tmp-'));
  const cloneDir = path.join(tempRoot, 'repo');

  try {
    const cloneArgs = [
      'clone',
      '--filter=blob:none',
      '--depth',
      '1',
      '--no-checkout',
    ];
    if (ref) {
      cloneArgs.push('--branch', ref);
    }

    cloneArgs.push(`${toHttpsRepositoryUrl(repo)}.git`, cloneDir);

    await runGitCommand(cloneArgs);
    await runGitCommand(['-C', cloneDir, 'sparse-checkout', 'init', '--cone']);
    await runGitCommand([
      '-C',
      cloneDir,
      'sparse-checkout',
      'set',
      subdirectory,
    ]);
    await runGitCommand(['-C', cloneDir, 'checkout']);

    const sparseRoot = path.join(cloneDir, subdirectory);
    const sparseEntries = await fsp.readdir(sparseRoot);
    if (sparseEntries.length === 0) {
      throw new Error(`Sparse checkout produced empty path: ${subdirectory}`);
    }

    await fsp.rm(path.join(cloneDir, '.git'), { recursive: true, force: true });
    await fsp.rename(cloneDir, outputDir);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function downloadRepositorySource(
  repo: ResolvedRepository,
  packageName: string,
  version: string,
  storeOptions: StoreOptions,
  tag: string | null
): Promise<void> {
  if (repo.directory) {
    await downloadSparseSubdirectory(
      repo,
      packageName,
      version,
      storeOptions,
      repo.directory,
      tag
    );
    return;
  }

  if (tag) {
    try {
      await downloadAndExtract(
        getTagTarballUrl(repo, tag),
        packageName,
        version,
        undefined,
        storeOptions
      );
      return;
    } catch (error) {
      const message = (error as Error).message;
      if (!message.includes('Failed to download: 404')) {
        throw error;
      }
    }
  }

  const fallbackUrls = getDefaultBranchTarballUrls(repo);
  let lastError: Error | null = null;

  for (const url of fallbackUrls) {
    try {
      await downloadAndExtract(
        url,
        packageName,
        version,
        undefined,
        storeOptions
      );
      return;
    } catch (error) {
      lastError = error as Error;
    }
  }

  const attempted = fallbackUrls.join(', ');
  if (lastError) {
    throw new Error(`${lastError.message} (attempted: ${attempted})`);
  }

  throw new Error(
    `Failed to download package source (attempted: ${attempted})`
  );
}

export async function ensurePackageSourceFromInstalled(
  cwd: string,
  packageName: string,
  options?: SourceStorageOptions
): Promise<PackageSourceResult> {
  const storeDir = getStoreDir({ global: options?.global, cwd });
  const installed = await resolveInstalledPackageFromCwd(packageName, cwd);
  const version = installed.version;
  const packageVersionKey = `${packageName}@${version}`;
  const outputDir = path.join(storeDir, packageVersionKey);

  const localRepo = normalizeRepositoryToHttpsRepo(installed.repository);

  const localPackagePath = localRepo?.repo.directory
    ? path.join(outputDir, localRepo.repo.directory)
    : outputDir;

  const packageExists = await fsp
    .stat(outputDir)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (packageExists) {
    return {
      packageName,
      version,
      repositoryPath: outputDir,
      packagePath: localPackagePath,
      packageSubdirectory: localRepo?.repo.directory ?? null,
      fromCache: true,
    };
  }

  let repo = localRepo?.repo ?? null;
  if (!repo) {
    const metadata = await fetchPackageMetadata(packageName, version, cwd);
    repo = normalizeRepositoryToHttpsRepo(metadata.repository)?.repo ?? null;
  }
  if (!repo) {
    repo = await resolveRepositoryFromReadme(installed.packageDir, packageName);
  }

  if (!repo) {
    throw new Error(
      `No repository information found for ${packageName}@${version} in installed package, registry metadata, or package README`
    );
  }

  const tagResult = shouldSkipTagLookup(packageName, repo)
    ? { tag: null, usedFallback: true }
    : await findTag(repo, version, packageName);

  await downloadRepositorySource(
    repo,
    packageName,
    version,
    { global: options?.global, cwd },
    tagResult.tag
  );

  const packagePath = repo.directory
    ? path.join(outputDir, repo.directory)
    : outputDir;

  return {
    packageName,
    version,
    repositoryPath: outputDir,
    packagePath,
    packageSubdirectory: repo.directory ?? null,
    fromCache: false,
  };
}

export async function pullPackageForProject(
  cwd: string,
  packageName: string,
  options?: SourceStorageOptions,
  onProgress?: (update: PullProgressUpdate) => void
): Promise<PullResult> {
  const storeDir = getStoreDir({ global: options?.global, cwd });

  const reportProgress = (update: PullProgressUpdate) => {
    onProgress?.(update);
  };

  try {
    reportProgress({ status: 'fetching' });
    const installed = await resolveInstalledPackageFromCwd(packageName, cwd);

    const packageVersionKey = `${packageName}@${installed.version}`;
    const outputDir = path.join(storeDir, packageVersionKey);
    reportProgress({ version: installed.version });

    const packageExists = await fsp
      .stat(outputDir)
      .then((stats) => stats.isDirectory())
      .catch(() => false);

    if (packageExists) {
      const result: PullResult = {
        packageName,
        version: installed.version,
        status: 'complete',
        fromCache: true,
        storeDir,
      };
      reportProgress({
        status: 'complete',
        version: installed.version,
        fromCache: true,
      });
      return result;
    }

    let repo: ResolvedRepository | null =
      normalizeRepositoryToHttpsRepo(installed.repository)?.repo ?? null;
    if (!repo) {
      const metadata = await fetchPackageMetadata(
        packageName,
        installed.version,
        cwd
      );
      repo = normalizeRepositoryToHttpsRepo(metadata.repository)?.repo ?? null;
    }
    if (!repo) {
      repo = await resolveRepositoryFromReadme(
        installed.packageDir,
        packageName
      );
    }

    if (!repo) {
      throw new Error(
        'No repository information found in installed package, registry metadata, or package README'
      );
    }

    let tagResult: { tag: string | null; usedFallback: boolean };
    if (shouldSkipTagLookup(packageName, repo)) {
      tagResult = { tag: null, usedFallback: true };
    } else {
      reportProgress({ status: 'finding-tag', version: installed.version });
      tagResult = await findTag(repo, installed.version, packageName);
    }

    reportProgress({ status: 'downloading', version: installed.version });
    await downloadRepositorySource(
      repo,
      packageName,
      installed.version,
      { global: options?.global, cwd },
      tagResult.tag
    );

    const result: PullResult = {
      packageName,
      version: installed.version,
      status: 'complete',
      fromCache: false,
      storeDir,
    };
    reportProgress({
      status: 'complete',
      version: installed.version,
      fromCache: false,
    });
    return result;
  } catch (error) {
    const message = (error as Error).message;
    reportProgress({
      status: 'error',
      error: message,
    });
    return {
      packageName,
      status: 'error',
      error: message,
      storeDir,
    };
  }
}

export async function syncProjectDependencies(
  cwd: string,
  options?: SourceStorageOptions
): Promise<SyncProjectDependenciesResult> {
  const dependencies = await getProjectDependencies(cwd);
  const packages = dependencies.map((dependency) => dependency.name);

  const results = await Promise.all(
    packages.map((packageName) =>
      pullPackageForProject(cwd, packageName, options)
    )
  );

  return {
    storeDir: getStoreDir({ global: options?.global, cwd }),
    packages,
    results,
  };
}
