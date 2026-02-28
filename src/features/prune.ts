import { rm } from 'node:fs/promises';

import {
  getProjectDependencies,
  normalizeVersionFromSpecifier,
  resolveInstalledPackageFromCwd,
} from '../lib/package-json.ts';
import { getStoreDir, getStoredPackages } from '../lib/store.ts';
import type {
  PruneCacheOptions,
  PruneCacheRemoved,
  PruneCacheResult,
  StoredPackageEntry,
} from '../lib/types.ts';

async function getProjectTargetVersions(
  cwd: string
): Promise<Map<string, Set<string>>> {
  const dependencies = await getProjectDependencies(cwd);
  const targets = new Map<string, Set<string>>();

  await Promise.all(
    dependencies.map(async (dependency) => {
      let targetVersion: string | null = null;

      try {
        const installed = await resolveInstalledPackageFromCwd(
          dependency.name,
          cwd
        );
        targetVersion = installed.version;
      } catch {
        targetVersion = normalizeVersionFromSpecifier(dependency.spec);
      }

      if (!targetVersion) {
        return;
      }

      const existing = targets.get(dependency.name) ?? new Set<string>();
      existing.add(targetVersion);
      targets.set(dependency.name, existing);
    })
  );

  return targets;
}

function parsePackageVersionReference(
  reference: string
): { packageName: string; version: string } | null {
  const separatorIndex = reference.lastIndexOf('@');
  if (separatorIndex <= 0 || separatorIndex >= reference.length - 1) {
    return null;
  }

  const packageName = reference.slice(0, separatorIndex);
  const version = reference.slice(separatorIndex + 1);

  if (!packageName || !version) {
    return null;
  }

  return { packageName, version };
}

export async function pruneCache(
  cwd: string,
  options?: PruneCacheOptions
): Promise<PruneCacheResult> {
  const storeDir = getStoreDir();

  const keepLatest = Math.max(0, options?.keepLatest ?? 1);
  const keepProjectDependencies = options?.keepProjectDependencies ?? true;
  const dryRun = options?.dryRun ?? false;
  const warnings: string[] = [];

  const stored = await getStoredPackages(storeDir);
  const groupedByPackage = new Map<string, StoredPackageEntry[]>();

  for (const entry of stored) {
    const existing = groupedByPackage.get(entry.packageName) ?? [];
    existing.push(entry);
    groupedByPackage.set(entry.packageName, existing);
  }

  for (const entries of groupedByPackage.values()) {
    entries.sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true })
    );
  }

  const keepReasons = new Map<string, string[]>();
  const addKeepReason = (
    packageName: string,
    version: string,
    reason: string
  ) => {
    const key = `${packageName}@${version}`;
    const reasons = keepReasons.get(key) ?? [];
    reasons.push(reason);
    keepReasons.set(key, reasons);
  };

  if (keepLatest > 0) {
    for (const entries of groupedByPackage.values()) {
      for (const entry of entries.slice(0, keepLatest)) {
        addKeepReason(
          entry.packageName,
          entry.version,
          `keepLatest(${keepLatest})`
        );
      }
    }
  }

  if (keepProjectDependencies) {
    try {
      const projectTargets = await getProjectTargetVersions(cwd);
      for (const [packageName, versions] of projectTargets) {
        for (const version of versions) {
          addKeepReason(packageName, version, 'project-target-version');
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to resolve project dependency targets: ${(error as Error).message}`
      );
    }
  }

  for (const reference of options?.keep ?? []) {
    const parsed = parsePackageVersionReference(reference);
    if (!parsed) {
      warnings.push(
        `Invalid keep reference "${reference}" (expected package@version)`
      );
      continue;
    }

    addKeepReason(parsed.packageName, parsed.version, 'explicit-keep');
  }

  const removed: PruneCacheRemoved[] = [];
  let kept = 0;

  for (const entry of stored) {
    const key = `${entry.packageName}@${entry.version}`;
    const reasons = keepReasons.get(key);

    if (reasons && reasons.length > 0) {
      kept += 1;
      continue;
    }

    if (!dryRun) {
      await rm(entry.outputDir, { recursive: true, force: true });
    }

    removed.push({
      packageName: entry.packageName,
      version: entry.version,
      repositoryPath: entry.outputDir,
      reason: 'not matched by keep rules',
    });
  }

  return {
    storeDir,
    totalBefore: stored.length,
    totalAfter: dryRun ? stored.length : stored.length - removed.length,
    removed,
    kept,
    dryRun,
    warnings,
  };
}
