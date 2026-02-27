import { Text } from 'ink';
import React, { useEffect } from 'react';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner(): React.ReactElement {
  const [frame, setFrame] = React.useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{spinnerFrames[frame]}</Text>;
}
