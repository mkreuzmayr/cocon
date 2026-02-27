import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { regex } from 'arkregex';

import { fetchWithRetry } from './http.ts';

export interface PackageMetadata {
  name: string;
  version: string;
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
}

async function getRegistryUrl(cwd?: string): Promise<string> {
  const defaultRegistry = 'https://registry.npmjs.org';

  // Try to read .npmrc from current directory, then home directory
  const paths = [path.join(cwd ?? process.cwd(), '.npmrc')];
  paths.push(path.join(os.homedir(), '.npmrc'));

  for (const npmrcPath of paths) {
    try {
      const content = await fsp.readFile(npmrcPath, 'utf-8');
      const lines = content.split(/\r?\n/);

      for (const line of lines) {
        const match = regex('^registry\\s*=\\s*(.+)$').exec(line);

        if (!match) {
          continue;
        }

        return match[1].trim().replace(/\/$/, '');
      }
    } catch {
      // File doesn't exist, continue
    }
  }

  return defaultRegistry;
}

export async function fetchPackageMetadata(
  packageName: string,
  version: string,
  cwd?: string
): Promise<PackageMetadata> {
  const registryUrl = await getRegistryUrl(cwd);
  const encodedName = packageName.replace('/', '%2f');
  const url = `${registryUrl}/${encodedName}`;

  const response = await fetchWithRetry(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch package metadata: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    versions?: Record<
      string,
      { repository?: { type?: string; url?: string; directory?: string } }
    >;
  };

  const versionData = data.versions?.[version];

  if (!versionData) {
    throw new Error(`Version ${version} not found for package ${packageName}`);
  }

  return {
    name: packageName,
    version,
    repository: versionData.repository,
  };
}
