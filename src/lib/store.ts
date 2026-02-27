import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  GetCachedSourceOptions,
  SourceStorageOptions,
  StoredPackageEntry,
} from './types.ts';

export function getStoreDir(options?: {
  global?: boolean;
  cwd?: string;
}): string {
  if (!options?.global) {
    const cwd = options?.cwd ?? process.cwd();

    return path.join(cwd, '.cocon', 'packages');
  }

  return path.join(os.homedir(), '.cocon', 'packages');
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

export async function listCachedPackageSources(
  cwd: string,
  options?: SourceStorageOptions
) {
  const storeDir = getStoreDir({ global: options?.global, cwd });

  const packages = await getStoredPackages(storeDir);

  return {
    storeDir,
    packages,
  };
}

export async function getCachedPackageSource(
  cwd: string,
  packageName: string,
  options?: GetCachedSourceOptions
) {
  const listResult = await listCachedPackageSources(cwd, options);

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
