import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  getProjectDependencies,
  isWorkspaceSpecifier,
  resolveInstalledPackageFromCwd,
} from '../../../lib/package-json.ts';
import { execAsync } from '../../../lib/spawn.ts';
import {
  ensureProjectPackageLink,
  ensureStoreDir,
  getProjectStoreDir,
  getStoreDir,
  getStoredPackagePath,
} from '../../../lib/store.ts';
import type {
  PackageSourceResult,
  PullProgressUpdate,
  PullResult,
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
  subdirectory: string,
  ref: string | null
): Promise<void> {
  const storeDir = await ensureStoreDir();
  const outputDir = getStoredPackagePath(storeDir, packageName, version);

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
  tag: string | null
): Promise<void> {
  if (repo.directory) {
    await downloadSparseSubdirectory(
      repo,
      packageName,
      version,
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
        undefined
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
      await downloadAndExtract(url, packageName, version, undefined);
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

async function pathExists(candidatePath: string): Promise<boolean> {
  return fsp
    .stat(candidatePath)
    .then(() => true)
    .catch(() => false);
}

async function findLocalRepositoryRoot(
  startDir: string
): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (true) {
    if (await pathExists(path.join(currentDir, '.git'))) {
      return currentDir;
    }

    if (await pathExists(path.join(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir;
    }

    if (currentDir === root) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  return null;
}

async function resolveLocalPackageSource(
  packageDir: string
): Promise<{ repositoryDir: string; packageSubdirectory: string | null }> {
  const repositoryDir = await findLocalRepositoryRoot(packageDir);

  if (!repositoryDir) {
    return {
      repositoryDir: packageDir,
      packageSubdirectory: null,
    };
  }

  const relativePackagePath = path.relative(repositoryDir, packageDir);

  return {
    repositoryDir,
    packageSubdirectory:
      relativePackagePath && relativePackagePath !== '.'
        ? relativePackagePath
        : null,
  };
}

function buildSkippedPullResult(
  packageName: string,
  storeDir: string,
  projectStoreDir: string,
  version: string | undefined,
  skipReason: 'workspace' | 'private'
): PullResult {
  return {
    packageName,
    version,
    status: 'skipped',
    skipReason,
    storeDir,
    projectStoreDir,
  };
}

export async function ensurePackageSourceFromInstalled(
  cwd: string,
  packageName: string
): Promise<PackageSourceResult> {
  const storeDir = getStoreDir();
  const installed = await resolveInstalledPackageFromCwd(packageName, cwd);
  const version = installed.version;
  const outputDir = getStoredPackagePath(storeDir, packageName, version);
  const localPackageSource = installed.isLocalSource
    ? await resolveLocalPackageSource(installed.realPackageDir)
    : null;

  const localRepo = normalizeRepositoryToHttpsRepo(installed.repository);

  const packageExists = await fsp
    .stat(outputDir)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (packageExists) {
    const repositoryPath = await ensureProjectPackageLink(
      cwd,
      packageName,
      version
    );
    const packageSubdirectory =
      localPackageSource?.packageSubdirectory ??
      localRepo?.repo.directory ??
      null;
    const packagePath = getCachedPackagePath(
      repositoryPath,
      packageSubdirectory
    );

    return {
      packageName,
      version,
      repositoryPath,
      packagePath,
      packageSubdirectory,
      fromCache: true,
    };
  }

  if (localPackageSource) {
    const packagePath = localPackageSource.packageSubdirectory
      ? path.join(
          localPackageSource.repositoryDir,
          localPackageSource.packageSubdirectory
        )
      : localPackageSource.repositoryDir;

    return {
      packageName,
      version,
      repositoryPath: localPackageSource.repositoryDir,
      packagePath,
      packageSubdirectory: localPackageSource.packageSubdirectory,
      fromCache: false,
    };
  }

  let repo = localRepo?.repo ?? null;
  if (!repo) {
    try {
      const metadata = await fetchPackageMetadata(packageName, version, cwd);
      repo = normalizeRepositoryToHttpsRepo(metadata.repository)?.repo ?? null;
    } catch {
      repo = null;
    }
  }

  if (!repo) {
    throw new Error(
      `No repository metadata found for ${packageName}@${version}. This package is likely private or proprietary`
    );
  }

  const tagResult = shouldSkipTagLookup(packageName, repo)
    ? { tag: null, usedFallback: true }
    : await findTag(repo, version, packageName);

  await downloadRepositorySource(repo, packageName, version, tagResult.tag);

  const repositoryPath = await ensureProjectPackageLink(
    cwd,
    packageName,
    version
  );
  const packagePath = getCachedPackagePath(
    repositoryPath,
    repo.directory ?? null
  );

  return {
    packageName,
    version,
    repositoryPath,
    packagePath,
    packageSubdirectory: repo.directory ?? null,
    fromCache: false,
  };
}

function getCachedPackagePath(
  repositoryPath: string,
  packageSubdirectory: string | null
): string {
  return packageSubdirectory
    ? path.join(repositoryPath, packageSubdirectory)
    : repositoryPath;
}

export async function pullPackageForProject(
  cwd: string,
  packageName: string,
  declaredSpec?: string,
  onProgress?: (update: PullProgressUpdate) => void
): Promise<PullResult> {
  const storeDir = getStoreDir();
  const projectStoreDir = getProjectStoreDir(cwd);

  const reportProgress = (update: PullProgressUpdate) => {
    onProgress?.(update);
  };

  try {
    if (declaredSpec && isWorkspaceSpecifier(declaredSpec)) {
      reportProgress({ status: 'skipped', skipReason: 'workspace' });
      return buildSkippedPullResult(
        packageName,
        storeDir,
        projectStoreDir,
        undefined,
        'workspace'
      );
    }

    reportProgress({ status: 'fetching' });
    const installed = await resolveInstalledPackageFromCwd(packageName, cwd);

    const outputDir = getStoredPackagePath(
      storeDir,
      packageName,
      installed.version
    );
    reportProgress({ version: installed.version });

    const packageExists = await fsp
      .stat(outputDir)
      .then((stats) => stats.isDirectory())
      .catch(() => false);

    if (packageExists) {
      await ensureProjectPackageLink(cwd, packageName, installed.version);
      const result: PullResult = {
        packageName,
        version: installed.version,
        status: 'complete',
        fromCache: true,
        storeDir,
        projectStoreDir,
      };
      reportProgress({
        status: 'complete',
        version: installed.version,
        fromCache: true,
      });
      return result;
    }

    if (installed.isLocalSource) {
      reportProgress({
        status: 'skipped',
        version: installed.version,
        skipReason: 'workspace',
      });
      return buildSkippedPullResult(
        packageName,
        storeDir,
        projectStoreDir,
        installed.version,
        'workspace'
      );
    }

    let repo: ResolvedRepository | null =
      normalizeRepositoryToHttpsRepo(installed.repository)?.repo ?? null;
    if (!repo) {
      try {
        const metadata = await fetchPackageMetadata(
          packageName,
          installed.version,
          cwd
        );
        repo =
          normalizeRepositoryToHttpsRepo(metadata.repository)?.repo ?? null;
      } catch {
        repo = null;
      }
    }

    if (!repo) {
      reportProgress({
        status: 'skipped',
        version: installed.version,
        skipReason: 'private',
      });
      return buildSkippedPullResult(
        packageName,
        storeDir,
        projectStoreDir,
        installed.version,
        'private'
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
      tagResult.tag
    );
    await ensureProjectPackageLink(cwd, packageName, installed.version);

    const result: PullResult = {
      packageName,
      version: installed.version,
      status: 'complete',
      fromCache: false,
      storeDir,
      projectStoreDir,
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
      projectStoreDir,
    };
  }
}

export async function syncProjectDependencies(
  cwd: string
): Promise<SyncProjectDependenciesResult> {
  const dependencies = await getProjectDependencies(cwd);
  const packages = dependencies.map((dependency) => dependency.name);

  const results = await Promise.all(
    dependencies.map((dependency) =>
      pullPackageForProject(cwd, dependency.name, dependency.spec)
    )
  );

  return {
    storeDir: getStoreDir(),
    projectStoreDir: getProjectStoreDir(cwd),
    packages,
    results,
  };
}
