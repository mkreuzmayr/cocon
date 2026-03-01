import { Box, Text } from 'ink';
import React from 'react';

import { Spinner } from '../../../components/spinner.tsx';
import type { PackageState, StatusType } from '../lib/types.ts';

export function StatusText({
  status,
  message,
  fromCache,
  skipReason,
}: {
  status: StatusType;
  message?: string;
  fromCache?: boolean;
  skipReason?: 'workspace' | 'private';
}): React.ReactElement {
  switch (status) {
    case 'pending':
      return <Text color="gray">Pending</Text>;
    case 'fetching':
      return <Text color="cyan">Fetching registry info...</Text>;
    case 'finding-tag':
      return <Text color="cyan">Finding tag...</Text>;
    case 'downloading':
      return <Text color="cyan">Downloading...</Text>;
    case 'complete':
      return <Text color="green">{fromCache ? 'Reused' : 'Downloaded'}</Text>;
    case 'skipped':
      return (
        <Text color="yellow">
          {skipReason === 'workspace' ? 'Workspace' : 'Private'}
        </Text>
      );
    case 'error':
      return <Text color="red">Error: {message}</Text>;
  }
}

function StatusIcon({ status }: { status: StatusType }): React.ReactElement {
  switch (status) {
    case 'pending':
      return <Text color="gray">[ ]</Text>;
    case 'fetching':
    case 'finding-tag':
    case 'downloading':
      return (
        <Text color="cyan">
          [<Spinner />]
        </Text>
      );
    case 'complete':
      return <Text color="green">[✓]</Text>;
    case 'skipped':
      return <Text color="yellow">[-]</Text>;
    case 'error':
      return <Text color="red">[✗]</Text>;
  }
}

export function PackageRow({ pkg }: { pkg: PackageState }): React.ReactElement {
  const displayName = pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;

  if (pkg.status === 'error') {
    return (
      <Box flexDirection="column">
        <Box>
          <StatusIcon status={pkg.status} />
          <Text> </Text>
          <Text bold>{displayName}</Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="red">{pkg.error}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <StatusIcon status={pkg.status} />
      <Text> </Text>
      <Text bold>{displayName}</Text>
      <Text> </Text>
      <StatusText
        status={pkg.status}
        message={pkg.error}
        fromCache={pkg.fromCache}
        skipReason={pkg.skipReason}
      />
    </Box>
  );
}
