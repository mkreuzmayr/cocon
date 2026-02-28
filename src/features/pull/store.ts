import { createStore, type StoreApi } from 'zustand/vanilla';

import type { PullProgressUpdate, PullResult } from '../../lib/types.ts';
import type { PackageState } from './lib/types.ts';

export interface PullRuntimeState {
  packages: PackageState[];
  results: PullResult[];
  running: boolean;
  done: boolean;
  storeDir: string;
  projectStoreDir: string;
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
    projectStoreDir: '',
  }));
}

export interface PullRuntimeActions {
  updatePackage: (name: string, update: PullProgressUpdate) => void;
  recordResult: (result: PullResult) => void;
  finishRun: () => void;
  setStoreDir: (storeDir: string) => void;
  setProjectStoreDir: (projectStoreDir: string) => void;
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
    setProjectStoreDir: (projectStoreDir) => {
      store.setState({ projectStoreDir });
    },
  };
}
