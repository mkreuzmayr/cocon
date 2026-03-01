export interface PackageSourceResult {
  packageName: string;
  version: string;
  repositoryPath: string;
  packagePath: string;
  packageSubdirectory: string | null;
  fromCache: boolean;
}

export interface StoredPackageEntry {
  packageName: string;
  version: string;
  outputDir: string;
}

export interface PullResult {
  packageName: string;
  version?: string;
  status: 'complete' | 'skipped' | 'error';
  error?: string;
  fromCache?: boolean;
  skipReason?: 'workspace' | 'private';
  storeDir: string;
  projectStoreDir: string;
}

export type PullProgressStatus =
  | 'fetching'
  | 'finding-tag'
  | 'downloading'
  | 'complete'
  | 'skipped'
  | 'error';

export interface PullProgressUpdate {
  status?: PullProgressStatus;
  version?: string;
  error?: string;
  fromCache?: boolean;
  skipReason?: 'workspace' | 'private';
}

export interface CachedPackageSource {
  packageName: string;
  version: string;
  repositoryPath: string;
  packagePath: string;
  packageSubdirectory: null;
}

export interface CachedPackageSourceResult {
  storeDir: string;
  packages: CachedPackageSource[];
}

export interface SyncProjectDependenciesResult {
  storeDir: string;
  projectStoreDir: string;
  packages: string[];
  results: PullResult[];
}

export type TargetVersionSource =
  | 'installed'
  | 'declared-range'
  | 'workspace'
  | 'unknown';

export interface CacheStatusEntry {
  packageName: string;
  declaredRange: string;
  declaredSource: string;
  installedVersion: string | null;
  targetVersion: string | null;
  targetVersionSource: TargetVersionSource;
  cachedVersions: string[];
  isTargetCached: boolean;
  isMissing: boolean;
}

export interface CacheStatusResult {
  cwd: string;
  storeDir: string;
  packages: CacheStatusEntry[];
}

export interface GetCachedSourceOptions {
  version?: string;
}

export interface PruneCacheOptions {
  keepLatest?: number;
  keepProjectDependencies?: boolean;
  keep?: string[];
  dryRun?: boolean;
}

export interface PruneCacheRemoved {
  packageName: string;
  version: string;
  repositoryPath: string;
  reason: string;
}

export interface PruneCacheResult {
  storeDir: string;
  totalBefore: number;
  totalAfter: number;
  removed: PruneCacheRemoved[];
  kept: number;
  dryRun: boolean;
  warnings: string[];
}
