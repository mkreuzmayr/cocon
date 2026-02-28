import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GetCachedSourceOptions, StoredPackageEntry } from './types.ts';

export function getStoreDir(): string {
  return path.join(os.homedir(), '.cocon', 'packages');
}

export function getProjectStoreDir(cwd: string): string {
  return path.join(cwd, '.cocon', 'packages');
}

export function getStoredPackagePath(
  storeDir: string,
  packageName: string,
  version: string
): string {
  return path.join(storeDir, `${packageName}@${version}`);
}

export async function ensureStoreDir(): Promise<string> {
  const storeDir = getStoreDir();
  await fsp.mkdir(storeDir, { recursive: true });
  return storeDir;
}

async function pathsMatch(pathA: string, pathB: string): Promise<boolean> {
  const [resolvedA, resolvedB] = await Promise.all([
    fsp.realpath(pathA).catch(() => null),
    fsp.realpath(pathB).catch(() => null),
  ]);

  return resolvedA !== null && resolvedA === resolvedB;
}

async function createDirectorySymlink(
  targetPath: string,
  linkPath: string
): Promise<void> {
  const symlinkTarget =
    process.platform === 'win32'
      ? targetPath
      : path.relative(path.dirname(linkPath), targetPath);
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

  await fsp.symlink(symlinkTarget, linkPath, symlinkType);
}

export async function ensureProjectPackageLink(
  cwd: string,
  packageName: string,
  version: string
): Promise<string> {
  const storeDir = await ensureStoreDir();
  const targetPath = getStoredPackagePath(storeDir, packageName, version);
  const linkPath = getStoredPackagePath(
    getProjectStoreDir(cwd),
    packageName,
    version
  );

  const targetStats = await fsp.stat(targetPath).catch(() => null);
  if (!targetStats?.isDirectory()) {
    throw new Error(`Cached package source is missing: ${targetPath}`);
  }

  await fsp.mkdir(path.dirname(linkPath), { recursive: true });

  const existing = await fsp.lstat(linkPath).catch(() => null);
  if (!existing) {
    await createDirectorySymlink(targetPath, linkPath);
    return linkPath;
  }

  if (existing.isSymbolicLink() && (await pathsMatch(linkPath, targetPath))) {
    return linkPath;
  }

  if (existing.isDirectory() && !(await pathsMatch(linkPath, targetPath))) {
    await fsp.rm(linkPath, { recursive: true, force: true });
  } else if (!existing.isSymbolicLink()) {
    await fsp.rm(linkPath, { recursive: true, force: true });
  } else {
    await fsp.rm(linkPath, { recursive: true, force: true });
  }

  await createDirectorySymlink(targetPath, linkPath);
  return linkPath;
}

function parseStoredPackageRelativePath(
  relativePath: string
): { packageName: string; version: string } | null {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const leafSegment = segments.at(-1);

  if (!leafSegment) {
    return null;
  }

  const versionSeparatorIndex = leafSegment.lastIndexOf('@');

  if (
    versionSeparatorIndex <= 0 ||
    versionSeparatorIndex === leafSegment.length - 1
  ) {
    return null;
  }

  const leafPackageName = leafSegment.slice(0, versionSeparatorIndex);
  const version = leafSegment.slice(versionSeparatorIndex + 1);
  const parentSegments = segments.slice(0, -1);
  const packageName = parentSegments.length
    ? `${parentSegments.join('/')}/${leafPackageName}`
    : leafPackageName;

  return { packageName, version };
}

async function collectStoredPackages(
  storeDir: string,
  output: StoredPackageEntry[]
): Promise<void> {
  try {
    const allEntries = await fsp.readdir(storeDir, { recursive: true });
    const matchingEntries = allEntries.filter((entry) => entry.includes('@'));
    for (const relativePath of matchingEntries) {
      const parsed = parseStoredPackageRelativePath(relativePath);
      if (!parsed) {
        continue;
      }

      const outputDir = path.join(storeDir, relativePath);
      let stats;
      try {
        stats = await fsp.stat(outputDir);
      } catch {
        continue;
      }

      if (!stats.isDirectory()) {
        continue;
      }

      output.push({
        packageName: parsed.packageName,
        version: parsed.version,
        outputDir,
      });
    }
  } catch {
    return;
  }
}

export async function getStoredPackages(
  storeDir: string
): Promise<StoredPackageEntry[]> {
  const packages: StoredPackageEntry[] = [];

  await collectStoredPackages(storeDir, packages);

  packages.sort((a, b) => {
    const nameOrder = a.packageName.localeCompare(b.packageName);
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });

  return packages;
}

export async function listCachedPackageSources(_cwd?: string) {
  const storeDir = getStoreDir();

  const packages = await getStoredPackages(storeDir);

  return {
    storeDir,
    packages,
  };
}

export async function getCachedPackageSource(
  _cwd: string,
  packageName: string,
  options?: GetCachedSourceOptions
) {
  const listResult = await listCachedPackageSources();

  const matchingPackages = listResult.packages.filter(
    (pkg) =>
      pkg.packageName === packageName &&
      (!options?.version || pkg.version === options.version)
  );

  if (matchingPackages.length === 0) {
    const versionInfo = options?.version ? `@${options.version}` : '';
    throw new Error(
      `No cached source found for ${packageName}${versionInfo} in ${listResult.storeDir}`
    );
  }

  return {
    storeDir: listResult.storeDir,
    packages: matchingPackages,
  };
}
