import { MultiSelect } from '@inkjs/ui';
import { Box, render, Text } from 'ink';
import React, { useCallback, useRef, useState } from 'react';

const SELECT_ALL_VALUE = '__SELECT_ALL__';

interface PackageOption {
  name: string;
  version: string;
}

interface PackagePickerProps {
  packages: PackageOption[];
  previousSelections: string[];
  onSubmit: (selected: string[]) => void;
}

function PackagePicker(props: PackagePickerProps): React.ReactElement {
  const { packages, previousSelections, onSubmit } = props;

  const allPackageValues = packages.map((pkg) => pkg.name);

  const options = [
    { label: 'Select all', value: SELECT_ALL_VALUE },
    ...packages.map((pkg) => ({
      label: `${pkg.name} ${pkg.version}`,
      value: pkg.name,
    })),
  ];

  const [selectAllActive, setSelectAllActive] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const currentSelectionRef = useRef<string[]>(previousSelections);

  const defaultValue = selectAllActive
    ? [SELECT_ALL_VALUE, ...allPackageValues]
    : previousSelections;

  const handleChange = useCallback(
    (selectedValues: string[]) => {
      const hasSelectAll = selectedValues.includes(SELECT_ALL_VALUE);

      if (hasSelectAll && !selectAllActive) {
        setSelectAllActive(true);
        currentSelectionRef.current = allPackageValues;
        setResetKey((k) => k + 1);
        return;
      }

      if (!hasSelectAll && selectAllActive) {
        setSelectAllActive(false);
        currentSelectionRef.current = [];
        setResetKey((k) => k + 1);
        return;
      }

      currentSelectionRef.current = selectedValues.filter(
        (v) => v !== SELECT_ALL_VALUE
      );
    },
    [selectAllActive, allPackageValues]
  );

  const handleSubmit = useCallback(
    (selectedValues: string[]) => {
      const result = selectedValues.filter((v) => v !== SELECT_ALL_VALUE);
      onSubmit(result);
    },
    [onSubmit]
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select packages to sync</Text>
        <Text color="gray"> (Space to toggle, Enter to confirm)</Text>
      </Box>
      <MultiSelect
        key={resetKey}
        options={options}
        defaultValue={defaultValue}
        onChange={handleChange}
        onSubmit={handleSubmit}
        visibleOptionCount={15}
      />
    </Box>
  );
}

export function renderPackagePicker(props: {
  packages: PackageOption[];
  previousSelections: string[];
}): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const instance = render(
      <PackagePicker
        packages={props.packages}
        previousSelections={props.previousSelections}
        onSubmit={(selected) => {
          instance.unmount();
          resolve(selected);
        }}
      />
    );
  });
}
