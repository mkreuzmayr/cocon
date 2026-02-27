import { createStore, type StoreApi } from 'zustand/vanilla';

import { getStoreDir } from '../../lib/store.ts';
import type { PullProgressUpdate, PullResult } from '../../lib/types.ts';
import { pullPackageForProject } from './lib/pull.ts';
import type { PackageState } from './lib/types.ts';

export interface PullRuntimeState {
  packages: PackageState[];
  results: PullResult[];
  running: boolean;
  done: boolean;
  storeDir: string;
}

export type PullRuntimeStore = StoreApi<PullRuntimeState>;

export function createPullStore(props: {
  packages: string[];
}): PullRuntimeStore {
  return createStore<PullRuntimeState>(() => ({
    packages: props.packages.map((name) => ({ name, status: 'pending' })),
    results: [],
    running: true,
    done: false,
    storeDir: '',
  }));
}

export interface PullRuntimeActions {
  updatePackage: (name: string, update: PullProgressUpdate) => void;
  recordResult: (result: PullResult) => void;
  finishRun: () => void;
  setStoreDir: (storeDir: string) => void;
}

export function createPullStoreActions(
  store: PullRuntimeStore
): PullRuntimeActions {
  return {
    updatePackage: (name, update) => {
      store.setState((state) => ({
        packages: state.packages.map((pkg) => {
          if (pkg.name !== name) {
            return pkg;
          }

          const next: PackageState = {
            ...pkg,
            ...update,
            status: update.status ?? pkg.status,
          };

          if (update.status && update.status !== 'error') {
            next.error = undefined;
          }

          return next;
        }),
      }));
    },
    recordResult: (result) => {
      store.setState((state) => ({
        results: [
          ...state.results.filter(
            (item) => item.packageName !== result.packageName
          ),
          result,
        ],
      }));
    },
    finishRun: () => {
      store.setState({
        running: false,
        done: true,
      });
    },
    setStoreDir: (storeDir) => {
      store.setState({ storeDir });
    },
  };
}

export async function executePullAction(props: {
  packages: string[];
  global: boolean;
  store: PullRuntimeStore;
  cwd: string;
}): Promise<void> {
  const actions = createPullStoreActions(props.store);
  actions.setStoreDir(getStoreDir({ global: props.global, cwd: props.cwd }));

  try {
    await Promise.all(
      props.packages.map(async (packageName) => {
        const result = await pullPackageForProject(
          props.cwd,
          packageName,
          { global: props.global },
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
