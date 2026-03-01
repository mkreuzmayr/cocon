#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { pruneCache } from './features/prune.ts';
import {
  ensurePackageSourceFromInstalled,
  syncProjectDependencies,
} from './features/pull/lib/pull.ts';
import { getCacheStatus } from './features/status.ts';
import { getCachedPackageSource } from './lib/store.ts';
import { listCachedPackageSources } from './lib/store.ts';

const server = new McpServer({
  name: 'cocon',
  version: '1.0.0',
});

function displayPath(path: string): string {
  return path.replace(/\\/g, '/');
}

server.registerTool(
  'get_package_source',
  {
    description:
      "Use this when you need to understand how a dependency works internally or when the user asks how something works in an npm package (e.g., 'how does X work in lodash?'). Resolves the installed package version from the provided project working directory and fetches package source for exploration.",
    inputSchema: {
      cwd: z
        .string()
        .describe(
          "Absolute path to the project's working directory where dependencies are installed"
        ),
      packageName: z
        .string()
        .describe(
          "The npm package name (e.g., 'lodash' or '@tanstack/react-query')"
        ),
    },
  },
  async ({ cwd, packageName }) => {
    let result;
    try {
      result = await ensurePackageSourceFromInstalled(cwd, packageName);
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    // Use forward slashes in prompts for consistency across platforms.
    const displayRepositoryPath = result.repositoryPath.replace(/\\/g, '/');
    const displayPackagePath = result.packagePath.replace(/\\/g, '/');
    const locationDetails = result.packageSubdirectory
      ? `Package subdirectory in repository: ${result.packageSubdirectory}\nRecommended package context path: ${displayPackagePath}`
      : `Package is located at repository root.\nRecommended package context path: ${displayPackagePath}`;
    const monorepoHint = result.packageSubdirectory
      ? `- If monorepo context is needed, repository root is: ${displayRepositoryPath}\n`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `Package ${packageName}@${result.version} repository source available at: ${displayRepositoryPath}
${locationDetails}

To research this package, spawn an Explore agent with the Task tool:
- Set the path parameter to: ${displayPackagePath}
- Use package-specific path context first
- ${result.packageSubdirectory ? 'This package lives in a nested repository subdirectory' : 'This package is at repository root'}
${monorepoHint}- Ask your question about the package
- The agent will use Glob, Grep, and Read to find the answer`,
        },
      ],
    };
  }
);

server.registerTool(
  'sync_project_dependencies',
  {
    description:
      'Prefetch cache for all dependencies in package.json by resolving target versions and pulling package repositories in parallel.',
    inputSchema: {
      cwd: z
        .string()
        .describe(
          'Absolute path to the project working directory containing package.json'
        ),
    },
  },
  async ({ cwd }) => {
    let result;
    try {
      result = await syncProjectDependencies(cwd);
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    if (result.packages.length === 0) {
      return {
        content: [
          { type: 'text', text: 'No dependencies found in package.json.' },
        ],
      };
    }

    const success = result.results.filter((item) => item.status === 'complete');
    const skipped = result.results.filter((item) => item.status === 'skipped');
    const failed = result.results.filter((item) => item.status === 'error');
    const reused = success.filter((item) => item.fromCache).length;
    const downloaded = success.length - reused;

    const lines = result.results.map((item) => {
      if (item.status === 'error') {
        return `- FAIL ${item.packageName}: ${item.error}`;
      }

      if (item.status === 'skipped') {
        const version = item.version ? `@${item.version}` : '';
        return `- SKIP ${item.packageName}${version} (${item.skipReason ?? 'skipped'})`;
      }

      const version = item.version ? `@${item.version}` : '';
      const source = item.fromCache ? 'reused' : 'downloaded';
      return `- OK ${item.packageName}${version} (${source})`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Synced dependencies into ${displayPath(result.storeDir)}
Project links: ${displayPath(result.projectStoreDir)}
Total: ${result.results.length}
Succeeded: ${success.length}
Skipped: ${skipped.length}
Failed: ${failed.length}
Reused: ${reused}
Downloaded: ${downloaded}

${lines.join('\n')}`,
        },
      ],
      isError: failed.length > 0,
    };
  }
);

server.registerTool(
  'get_cache_status',
  {
    description:
      'Show installed vs cached versions and identify missing cache entries for project dependency targets.',
    inputSchema: {
      cwd: z
        .string()
        .describe(
          'Absolute path to the project working directory containing package.json'
        ),
    },
  },
  async ({ cwd }) => {
    let result;
    try {
      result = await getCacheStatus(cwd);
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    if (result.packages.length === 0) {
      return {
        content: [
          { type: 'text', text: 'No dependencies found in package.json.' },
        ],
      };
    }

    const missingCount = result.packages.filter((pkg) => pkg.isMissing).length;
    const lines = result.packages.map((pkg) => {
      const cached =
        pkg.cachedVersions.length > 0
          ? pkg.cachedVersions.join(', ')
          : '(none)';
      const installed = pkg.installedVersion ?? '(not installed)';
      const target =
        pkg.targetVersionSource === 'workspace'
          ? '(workspace)'
          : (pkg.targetVersion ?? '(unknown)');
      const status = pkg.isMissing ? 'MISSING' : 'OK';

      return `${status} ${pkg.packageName}
  declared (${pkg.declaredSource}): ${pkg.declaredRange}
  installed: ${installed}
  target to pull: ${target} [${pkg.targetVersionSource}]
  cached: ${cached}`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Cache status for ${displayPath(result.cwd)}
Store: ${displayPath(result.storeDir)}
Dependencies: ${result.packages.length}
Missing targets: ${missingCount}

${lines.join('\n')}`,
        },
      ],
    };
  }
);

server.registerTool(
  'prune_cache',
  {
    description:
      'Remove old/unused cache versions while keeping latest versions and project-target versions according to keep rules.',
    inputSchema: {
      cwd: z
        .string()
        .describe(
          'Absolute path to the project working directory (used for keep-project-dependencies rule)'
        ),
      keepLatest: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .default(1)
        .describe('Keep latest N versions per package'),
      keepProjectDependencies: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Keep versions currently targeted by the project's dependencies"
        ),
      keep: z
        .array(z.string())
        .optional()
        .default([])
        .describe('Additional package@version references to always keep'),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, reports what would be removed without deleting'),
    },
  },
  async ({ cwd, keepLatest, keepProjectDependencies, keep, dryRun }) => {
    let result;
    try {
      result = await pruneCache(cwd, {
        keepLatest,
        keepProjectDependencies,
        keep,
        dryRun,
      });
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    const warningsSection = result.warnings.length
      ? `\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}`
      : '';

    const removedSection = result.removed.length
      ? `\nRemoved entries:\n${result.removed
          .map(
            (entry) =>
              `- ${entry.packageName}@${entry.version}: ${displayPath(entry.repositoryPath)} (${entry.reason})`
          )
          .join('\n')}`
      : '\nNo cache entries matched prune criteria.';

    return {
      content: [
        {
          type: 'text',
          text: `${result.dryRun ? 'Dry run' : 'Prune'} for ${displayPath(result.storeDir)}
Removed: ${result.removed.length}
Kept: ${result.kept}
Total before: ${result.totalBefore}
Total after: ${result.totalAfter}${warningsSection}${removedSection}`,
        },
      ],
    };
  }
);

server.registerTool(
  'list_cached_package_sources',
  {
    description:
      'List all cached package sources already available in the shared cache.',
    inputSchema: {
      cwd: z
        .string()
        .describe('Absolute path to the project working directory'),
    },
  },
  async ({ cwd }) => {
    let result;
    try {
      result = await listCachedPackageSources(cwd);
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    const storeDir = displayPath(result.storeDir);
    if (result.packages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No cached package sources found in ${storeDir}`,
          },
        ],
      };
    }

    const lines = result.packages.map(
      (pkg) =>
        `- ${pkg.packageName}@${pkg.version}: ${displayPath(pkg.outputDir)}`
    );

    return {
      content: [
        {
          type: 'text',
          text: `Cached package sources in ${storeDir}:\n${lines.join('\n')}`,
        },
      ],
    };
  }
);

server.registerTool(
  'get_cached_package_source',
  {
    description:
      'Get information for one cached package source already present in cache (without downloading).',
    inputSchema: {
      cwd: z
        .string()
        .describe('Absolute path to the project working directory'),
      packageName: z
        .string()
        .describe(
          "The npm package name (e.g., 'lodash' or '@tanstack/react-query')"
        ),
      version: z
        .string()
        .optional()
        .describe('Optional exact version to select a single cache entry'),
    },
  },
  async ({ cwd, packageName, version }) => {
    let result;
    try {
      result = await getCachedPackageSource(cwd, packageName, {
        version,
      });
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }

    const storeDir = displayPath(result.storeDir);

    const lines = result.packages.map((pkg) => {
      const repositoryPath = displayPath(pkg.outputDir);
      return `- ${pkg.packageName}@${pkg.version}\n  repositoryPath: ${repositoryPath}`;
    });

    const versionHint =
      version || result.packages.length === 1
        ? ''
        : '\nMultiple versions found. Pass version to select one exact entry.';

    return {
      content: [
        {
          type: 'text',
          text: `Cached package source matches in ${storeDir}:\n${lines.join('\n')}${versionHint}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
