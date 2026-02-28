import { Box, render, Text } from 'ink';
import React from 'react';
import { useStore } from 'zustand';

import type { PullRuntimeStore } from '../store.ts';
import { PackageRow } from './package-row.tsx';

export function PullView(props: {
  title: string;
  store: PullRuntimeStore;
}): React.ReactElement {
  const packages = useStore(props.store, (state) => state.packages);
  const done = useStore(props.store, (state) => state.done);
  const storeDir = useStore(props.store, (state) => state.storeDir);
  const projectStoreDir = useStore(
    props.store,
    (state) => state.projectStoreDir
  );

  const successCount = packages.filter(
    (pkg) => pkg.status === 'complete'
  ).length;
  const errorCount = packages.filter((pkg) => pkg.status === 'error').length;
  const reusedCount = packages.filter(
    (pkg) => pkg.status === 'complete' && pkg.fromCache
  ).length;
  const downloadedCount = packages.filter(
    (pkg) => pkg.status === 'complete' && pkg.fromCache === false
  ).length;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>{props.title}</Text>
      </Box>

      {packages.map((pkg) => (
        <PackageRow key={pkg.name} pkg={pkg} />
      ))}

      <Box marginTop={1} flexDirection="column">
        <Text>
          {successCount > 0 && (
            <Text color="green">
              {successCount} package{successCount !== 1 ? 's' : ''} pulled
              successfully ({reusedCount} reused, {downloadedCount} downloaded)
            </Text>
          )}
          {successCount > 0 && errorCount > 0 && <Text>, </Text>}
          {errorCount > 0 && <Text color="red">{errorCount} failed</Text>}
        </Text>
        {done ? (
          <Text color="gray">Stored in {storeDir}</Text>
        ) : (
          <Text color="gray">Storing in {storeDir}</Text>
        )}
        <Text color="gray">Linked in {projectStoreDir}</Text>
      </Box>
    </Box>
  );
}

export function renderPullView(props: { store: PullRuntimeStore }) {
  return render(
    <PullView store={props.store} title="Pulling package sources..." />
  );
}

export function renderSyncView(props: { store: PullRuntimeStore }) {
  return render(
    <PullView
      store={props.store}
      title="Syncing project dependency sources..."
    />
  );
}
