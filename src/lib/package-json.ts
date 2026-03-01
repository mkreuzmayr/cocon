import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

interface ModulePackageJson {
  name?: string;
  version?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
}

export interface InstalledPackage {
  name: string;
  version: string;
  isLatest?: boolean;
}

export interface InstalledPackageFromCwd {
  name: string;
  version: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  packageJsonPath: string;
  packageDir: string;
  realPackageJsonPath: string;
  realPackageDir: string;
  isLocalSource: boolean;
}

export interface ProjectDependency {
  name: string;
  spec: string;
  source: DependencySourceProperty;
}

const DEPENDENCY_SOURCE_PROPERTIES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export type DependencySourceProperty =
  (typeof DEPENDENCY_SOURCE_PROPERTIES)[number];

type PackageJson = Record<DependencySourceProperty, Record<string, string>>;

export async function readPackageJson(
  cwd: string = process.cwd()
): Promise<PackageJson> {
  const packageJsonPath = path.join(cwd, 'package.json');

  try {
    const content = await fsp.readFile(packageJsonPath, 'utf-8');
    return JSON.parse(content) as PackageJson;
  } catch (error) {
    throw new Error(`Failed to read package.json: ${(error as Error).message}`);
  }
}

export async function getProjectDependencies(
  cwd: string = process.cwd()
): Promise<ProjectDependency[]> {
  const packageJson = await readPackageJson(cwd);
  const dependenciesByName = new Map<string, ProjectDependency>();

  for (const sourceProperty of DEPENDENCY_SOURCE_PROPERTIES) {
    const sourceDependencies = packageJson[sourceProperty];
    if (!sourceDependencies) {
      continue;
    }

    for (const [name, spec] of Object.entries(sourceDependencies)) {
      dependenciesByName.set(name, { name, spec, source: sourceProperty });
    }
  }

  return [...dependenciesByName.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function normalizeVersionFromSpecifier(
  specifier: string
): string | null {
  const version = specifier.replace(/^[\^~>=<\s]+/, '');
  const parsedVersion = version.split(/[^\dA-Za-z.+-]/).shift() || version;

  if (/^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(parsedVersion)) {
    return parsedVersion;
  }

  return null;
}

export function isWorkspaceSpecifier(specifier: string): boolean {
  return /^\s*workspace:/i.test(specifier);
}

async function findPackageJsonFromEntryPoint(
  packageName: string,
  entryPoint: string
): Promise<string | null> {
  let dir = path.dirname(entryPoint);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, 'package.json');
    try {
      const content = await fsp.readFile(candidate, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name === packageName) {
        return candidate;
      }
    } catch {
      // no package.json here, keep walking up
    }
    dir = path.dirname(dir);
  }

  return null;
}

function packageNameToSegments(packageName: string): string[] {
  return packageName.split('/').filter(Boolean);
}

async function findPackageJsonFromNodeModules(
  packageName: string,
  cwd: string
): Promise<string | null> {
  let currentDir = cwd;
  const root = path.parse(currentDir).root;
  const packageSegments = packageNameToSegments(packageName);

  while (true) {
    const candidate = path.join(
      currentDir,
      'node_modules',
      ...packageSegments,
      'package.json'
    );

    try {
      const content = await fsp.readFile(candidate, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name === packageName) {
        return candidate;
      }
    } catch {
      // no readable package.json at this node_modules level
    }

    if (currentDir === root) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  return null;
}

function hasNodeModulesSegment(candidatePath: string): boolean {
  return candidatePath.split(path.sep).includes('node_modules');
}

export async function resolveInstalledPackageFromCwd(
  packageName: string,
  cwd: string
): Promise<InstalledPackageFromCwd> {
  const resolvedCwd = path.resolve(cwd);
  const runtimeRequire = createRequire(path.join(resolvedCwd, 'noop.js'));

  let modulePackageJsonPath: string | null = null;

  // Try resolving package.json subpath directly (works when exports allow it)
  let directResolvedPath: string | null = null;
  try {
    directResolvedPath = runtimeRequire.resolve(`${packageName}/package.json`);
  } catch {
    // exports field may block this, fall back to resolving main entry
  }

  // Verify direct resolution found the root package.json (not a nested one)
  if (directResolvedPath) {
    try {
      const content = await fsp.readFile(directResolvedPath, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name === packageName) {
        modulePackageJsonPath = directResolvedPath;
      }
    } catch {
      // file unreadable, try other strategies
    }
  }

  // Walk up from the misresolved path (e.g. exports ./* redirected to dist/cjs/package.json)
  if (!modulePackageJsonPath && directResolvedPath) {
    modulePackageJsonPath = await findPackageJsonFromEntryPoint(
      packageName,
      directResolvedPath
    );
  }

  // Fall back: resolve main entry point, walk up to find root package.json
  if (!modulePackageJsonPath) {
    try {
      const entryPoint = runtimeRequire.resolve(packageName);
      modulePackageJsonPath = await findPackageJsonFromEntryPoint(
        packageName,
        entryPoint
      );
    } catch {
      // package could not be resolved at all
    }
  }

  if (!modulePackageJsonPath) {
    modulePackageJsonPath = await findPackageJsonFromNodeModules(
      packageName,
      resolvedCwd
    );
  }

  if (!modulePackageJsonPath) {
    throw new Error(
      `Could not resolve installed package "${packageName}" from "${resolvedCwd}". Ensure dependencies are installed.`
    );
  }

  let modulePackageJson: ModulePackageJson;
  try {
    const content = await fsp.readFile(modulePackageJsonPath, 'utf-8');
    modulePackageJson = JSON.parse(content) as ModulePackageJson;
  } catch (error) {
    throw new Error(
      `Failed to read resolved package.json for "${packageName}": ${(error as Error).message}`
    );
  }

  if (!modulePackageJson.version) {
    throw new Error(
      `Resolved package "${packageName}" does not contain a valid version in ${modulePackageJsonPath}`
    );
  }

  const realPackageJsonPath = await fsp
    .realpath(modulePackageJsonPath)
    .catch(() => modulePackageJsonPath);
  const realPackageDir = path.dirname(realPackageJsonPath);

  return {
    name: modulePackageJson.name ?? packageName,
    version: modulePackageJson.version,
    repository: modulePackageJson.repository,
    packageJsonPath: modulePackageJsonPath,
    packageDir: path.dirname(modulePackageJsonPath),
    realPackageJsonPath,
    realPackageDir,
    isLocalSource: !hasNodeModulesSegment(realPackageDir),
  };
}
