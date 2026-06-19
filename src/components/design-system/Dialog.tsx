import React from 'react';
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { Theme } from '../../utils/theme.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from './Byline.js';
import FullWidthRow from './FullWidthRow.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { Pane } from './Pane.js';
type DialogProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onCancel: () => void;
  color?: keyof Theme;
  hideInputGuide?: boolean;
  hideBorder?: boolean;
  /** Custom input guide content. Receives exitState for Ctrl+C/D pending display. */
  inputGuide?: (exitState: ExitState) => React.ReactNode;
  /** Prepend "↑/↓ navigate" to the default input guide. Opt in from dialogs
   *  that host a Select so the navigation affordance is discoverable. */
  showNavigationHint?: boolean;
  /**
   * Controls whether Dialog's built-in confirm:no (Esc/n) and app:exit/interrupt
   * (Ctrl-C/D) keybindings are active. Set to `false` while an embedded text
   * field is being edited so those keys reach the field instead of being
   * consumed by Dialog. TextInput has its own ctrl+c/d handlers (cancel on
   * press, delete-forward on ctrl+d with text). Defaults to `true`.
   */
  isCancelActive?: boolean;
};

// Plain React (not react-compiler output): dialogs render rarely, and the
// memo-slot bookkeeping isn't worth maintaining here.
export function Dialog({
  title,
  subtitle,
  children,
  onCancel,
  color = 'permission',
  hideInputGuide,
  hideBorder,
  inputGuide,
  showNavigationHint,
  isCancelActive = true
}: DialogProps): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings(undefined, undefined, isCancelActive);
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: isCancelActive
  });
  const defaultInputGuide = exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>
        {showNavigationHint && <KeyboardShortcutHint shortcut="↑/↓" action="navigate" />}
        <KeyboardShortcutHint shortcut="Enter" action="confirm" />
        {isCancelActive && <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />}
      </Byline>;
  const content = <>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold={true} color={color}>{title}</Text>
          {subtitle && <Text dimColor={true}>{subtitle}</Text>}
        </Box>
        {children}
      </Box>
      {!hideInputGuide && <Box marginTop={1}><FullWidthRow><Text dimColor={true} italic={true}>{inputGuide ? inputGuide(exitState) : defaultInputGuide}</Text></FullWidthRow></Box>}
    </>;
  if (hideBorder) {
    return content;
  }
  return <Pane color={color}>{content}</Pane>;
}
