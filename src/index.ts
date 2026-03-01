#!/usr/bin/env node
import { Command } from 'commander';

import { pruneCache } from './features/prune.ts';
import { executePullAction } from './features/pull/command.ts';
import { renderPullView } from './features/pull/components/pull-view.tsx';
import { createPullStore } from './features/pull/store.ts';
import { getCacheStatus } from './features/status.ts';
import { getProjectDependencies } from './lib/package-json.ts';
import {
  getCachedPackageSource,
  listCachedPackageSources,
} from './lib/store.ts';

const program = new Command();

program
  .name('cocon')
  .description('Pull npm package source repositories for agentic coding tools')
  .version('0.0.1');

program
  .command('pull')
  .description('Pull source repositories for specified packages')
  .argument('<packages...>', 'Package names to pull')
  .action(async (packages: string[]) => {
    const cwd = process.cwd();

    const store = createPullStore({ packages });

    const pullView = renderPullView({ store });

    await executePullAction({
      store,
      packages,
      cwd,
    }).finally(() => {
      pullView.unmount();
    });
  });

program
  .command('sync')
  .description(
    'Prefetch cache for all dependencies in package.json using resolved versions and parallel pulls'
  )
  .action(async () => {
    const dependencies = await getProjectDependencies(process.cwd());
    const packages = dependencies.map((dependency) => dependency.name);

    if (packages.length === 0) {
      console.log('No dependencies found in package.json.');
      return;
    }

    const cwd = process.cwd();

    const store = createPullStore({ packages });
    const pullView = renderPullView({ store });

    await executePullAction({
      store,
      packages,
      cwd,
    }).finally(() => {
      pullView.unmount();
    });
  });

program
  .command('status')
  .description(
    'Show installed vs cached versions, missing package cache entries, and target versions to pull'
  )
  .action(async () => {
    const result = await getCacheStatus(process.cwd());
    console.log(`Store: ${result.storeDir}`);

    if (result.packages.length === 0) {
      console.log('No dependencies found in package.json.');
      return;
    }

    const missingCount = result.packages.filter((pkg) => pkg.isMissing).length;
    console.log(
      `Dependencies: ${result.packages.length} | Missing cache targets: ${missingCount}`
    );

    for (const pkg of result.packages) {
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

      console.log(`\n${status} ${pkg.packageName}`);
      console.log(`  declared (${pkg.declaredSource}): ${pkg.declaredRange}`);
      console.log(`  installed: ${installed}`);
      console.log(`  target to pull: ${target} [${pkg.targetVersionSource}]`);
      console.log(`  cached: ${cached}`);
    }
  });

program
  .command('prune')
  .description('Remove old or unused cached versions using keep rules')
  .option(
    '--keep-latest <count>',
    'Keep latest N cached versions per package',
    '1'
  )
  .option(
    '--no-keep-project-dependencies',
    'Do not keep versions currently targeted by project dependencies'
  )
  .option(
    '--keep <packageVersion...>',
    'Always keep explicit package@version references'
  )
  .option('--dry-run', 'Show what would be removed without deleting')
  .action(
    async (options: {
      keepLatest: string;
      keepProjectDependencies: boolean;
      keep?: string[];
      dryRun?: boolean;
    }) => {
      const keepLatest = Number.parseInt(options.keepLatest, 10);
      if (!Number.isFinite(keepLatest) || keepLatest < 0) {
        throw new Error('--keep-latest must be a non-negative integer');
      }

      const result = await pruneCache(process.cwd(), {
        keepLatest,
        keepProjectDependencies: options.keepProjectDependencies,
        keep: options.keep,
        dryRun: options.dryRun,
      });

      console.log(`Store: ${result.storeDir}`);
      console.log(
        `${result.dryRun ? 'Dry run' : 'Prune'}: ${result.removed.length} removed, ${result.kept} kept, ${result.totalBefore} total before`
      );
      console.log(`Total after: ${result.totalAfter}`);

      for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
      }

      if (result.removed.length === 0) {
        console.log('No cache entries matched prune criteria.');
        return;
      }

      for (const removed of result.removed) {
        console.log(
          `- ${removed.packageName}@${removed.version} (${removed.reason}) -> ${removed.repositoryPath}`
        );
      }
    }
  );

program
  .command('list')
  .description('List cached package sources in the shared cache')
  .action(async () => {
    const result = await listCachedPackageSources(process.cwd());
    console.log(`Store: ${result.storeDir}`);

    if (result.packages.length === 0) {
      console.log('No cached packages found.');
      return;
    }

    for (const pkg of result.packages) {
      console.log(`${pkg.packageName}@${pkg.version}`);
    }
  });

program
  .command('get')
  .description('Get cached package source information from the shared cache')
  .option('--version <version>', 'Filter to a specific cached version')
  .argument('<packageName>', 'Package name to inspect')
  .action(async (packageName: string, options: { version?: string }) => {
    const result = await getCachedPackageSource(process.cwd(), packageName, {
      version: options.version,
    });

    console.log(`Store: ${result.storeDir}`);
    for (const pkg of result.packages) {
      console.log(`- ${pkg.packageName}@${pkg.version}: ${pkg.outputDir}`);
    }
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
}
