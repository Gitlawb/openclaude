import React, { type ReactNode } from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
type Props = {
  instructions?: ReactNode;
};
export function WizardNavigationFooter({
  instructions = <Byline>
      <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
      <KeyboardShortcutHint shortcut="Enter" action="select" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
    </Byline>
}: Props): ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings();
  return <Box marginLeft={3} marginTop={1}>
      <Text dimColor>
        {exitState.pending ? `Press ${exitState.keyName} again to exit` : instructions}
      </Text>
    </Box>;
}
