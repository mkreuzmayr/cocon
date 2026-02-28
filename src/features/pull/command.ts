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

  try {
    await Promise.all(
      props.packages.map(async (packageName) => {
        const result = await pullPackageForProject(
          props.cwd,
          packageName,
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
