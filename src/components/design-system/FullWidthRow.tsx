import * as React from 'react';
import { Box } from '../../ink.js';

type Props = {
  children: React.ReactNode;
};

export default function FullWidthRow({
  children
}: Props): React.ReactNode {
  return <Box flexDirection="row" width="100%">
      {children}
      <Box flexGrow={1} />
    </Box>;
}
