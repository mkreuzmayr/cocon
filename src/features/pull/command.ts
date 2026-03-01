import { getProjectDependencies } from '../../lib/package-json.ts';
import { getProjectStoreDir, getStoreDir } from '../../lib/store';
import { pullPackageForProject } from './lib/pull';
import { createPullStoreActions, type PullRuntimeStore } from './store';

export async function executePullAction(props: {
  packages: string[];
  store: PullRuntimeStore;
  cwd: string;
}): Promise<void> {
  const actions = createPullStoreActions(props.store);
  actions.setStoreDir(getStoreDir());
  actions.setProjectStoreDir(getProjectStoreDir(props.cwd));
  const dependencySpecs = new Map<string, string>();

  try {
    for (const dependency of await getProjectDependencies(props.cwd)) {
      dependencySpecs.set(dependency.name, dependency.spec);
    }
  } catch {
    // pull can still run for explicit packages outside a project manifest
  }

  try {
    await Promise.all(
      props.packages.map(async (packageName) => {
        const result = await pullPackageForProject(
          props.cwd,
          packageName,
          dependencySpecs.get(packageName),
          (update) => {
            actions.updatePackage(packageName, update);
          }
        );

        actions.recordResult(result);
      })
    );
  } finally {
    actions.finishRun();
  }
}
