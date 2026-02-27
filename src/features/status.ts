import {
  getProjectDependencies,
  normalizeVersionFromSpecifier,
  resolveInstalledPackageFromCwd,
} from '../lib/package-json.ts';
import { getStoreDir, getStoredPackages } from '../lib/store.ts';
import type {
  CacheStatusEntry,
  CacheStatusResult,
  SourceStorageOptions,
  StoredPackageEntry,
  TargetVersionSource,
} from '../lib/types.ts';

function buildCachedVersionMap(
  entries: StoredPackageEntry[]
): Map<string, string[]> {
  const versionMap = new Map<string, string[]>();

  for (const entry of entries) {
    const versions = versionMap.get(entry.packageName) ?? [];
    versions.push(entry.version);
    versionMap.set(entry.packageName, versions);
  }

  for (const versions of versionMap.values()) {
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  return versionMap;
}

export async function getCacheStatus(
  cwd: string,
  options?: SourceStorageOptions
): Promise<CacheStatusResult> {
  const storeDir = getStoreDir({ global: options?.global, cwd });

  const [dependencies, stored] = await Promise.all([
    getProjectDependencies(cwd),
    getStoredPackages(storeDir),
  ]);

  const cachedVersionMap = buildCachedVersionMap(stored);

  const packages = await Promise.all(
    dependencies.map(async (dependency): Promise<CacheStatusEntry> => {
      let installedVersion: string | null = null;

      try {
        const installed = await resolveInstalledPackageFromCwd(
          dependency.name,
          cwd
        );
        installedVersion = installed.version;
      } catch {
        installedVersion = null;
      }

      const targetVersion =
        installedVersion ?? normalizeVersionFromSpecifier(dependency.spec);

      const targetVersionSource: TargetVersionSource = installedVersion
        ? 'installed'
        : targetVersion
          ? 'declared-range'
          : 'unknown';

      const cachedVersions = cachedVersionMap.get(dependency.name) ?? [];

      const isTargetCached = targetVersion
        ? cachedVersions.includes(targetVersion)
        : false;

      const isMissing = targetVersion
        ? !isTargetCached
        : cachedVersions.length === 0;

      return {
        packageName: dependency.name,
        declaredRange: dependency.spec,
        declaredSource: dependency.source,
        installedVersion,
        targetVersion,
        targetVersionSource,
        cachedVersions,
        isTargetCached,
        isMissing,
      };
    })
  );

  return {
    cwd,
    storeDir,
    packages,
  };
}
