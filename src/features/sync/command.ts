import {
  getProjectDependencies,
  isWorkspaceSpecifier,
  type ProjectDependency,
} from '../../lib/package-json.ts';
import { getProjectStoreDir, getStoredPackages } from '../../lib/store.ts';
import { executePullAction } from '../pull/command.ts';
import { renderSyncView } from '../pull/components/pull-view.tsx';
import { createPullStore } from '../pull/store.ts';
import { renderPackagePicker } from './components/package-picker.tsx';

async function askUserForPackages(
  cwd: string,
  syncableDeps: ProjectDependency[]
): Promise<string[]> {
  const projectStoreDir = getProjectStoreDir(cwd);
  const linkedPackages = await getStoredPackages(projectStoreDir);
  const linkedNames = new Set(linkedPackages.map((p) => p.packageName));

  const previousSelections = syncableDeps
    .filter((dep) => linkedNames.has(dep.name))
    .map((dep) => dep.name);

  const packages = await renderPackagePicker({
    packages: syncableDeps.map((dep) => ({
      name: dep.name,
      version: dep.spec,
    })),
    previousSelections,
  });

  return packages;
}

export async function executeSyncCommand(options: {
  all?: boolean;
  cwd: string;
}): Promise<void> {
  const { all, cwd } = options;

  const dependencies = await getProjectDependencies(cwd);
  const syncableDeps = dependencies.filter(
    (dep) => !isWorkspaceSpecifier(dep.spec)
  );

  if (syncableDeps.length === 0) {
    console.log('No syncable dependencies found in package.json.');
    return;
  }

  if (!all && !process.stdin.isTTY) {
    console.error(
      'Interactive package picker requires a TTY. Use --all to sync all packages.'
    );
    process.exit(1);
  }

  const packages = all
    ? syncableDeps.map((dep) => dep.name)
    : await askUserForPackages(cwd, syncableDeps);

  if (packages.length === 0) {
    console.log('No packages selected.');
    return;
  }

  const store = createPullStore({ packages });
  const syncView = renderSyncView({ store });

  await executePullAction({
    store,
    packages,
    cwd,
  }).finally(() => {
    syncView.unmount();
  });
}
