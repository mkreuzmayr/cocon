export interface PackageSourceResult {
  packageName: string;
  version: string;
  repositoryPath: string;
  packagePath: string;
  packageSubdirectory: string | null;
  fromCache: boolean;
}

export interface StoreOptions {
  global?: boolean;
  cwd?: string;
}

export interface StoredPackageEntry {
  packageName: string;
  version: string;
  outputDir: string;
}

export interface PullResult {
  packageName: string;
  version?: string;
  status: 'complete' | 'error';
  error?: string;
  fromCache?: boolean;
  storeDir: string;
}

export type PullProgressStatus =
  | 'fetching'
  | 'finding-tag'
  | 'downloading'
  | 'complete'
  | 'error';

export interface PullProgressUpdate {
  status?: PullProgressStatus;
  version?: string;
  error?: string;
  fromCache?: boolean;
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
  packages: string[];
  results: PullResult[];
}

export type TargetVersionSource = 'installed' | 'declared-range' | 'unknown';

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

export interface SourceStorageOptions {
  global?: boolean;
}

export interface GetCachedSourceOptions extends SourceStorageOptions {
  version?: string;
}

export interface PruneCacheOptions extends SourceStorageOptions {
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
