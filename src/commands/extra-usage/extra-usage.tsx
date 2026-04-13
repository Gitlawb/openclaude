import React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { Login } from '../login/login.js';
import { runExtraUsage } from './extra-usage-core.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode | null> {
  const result = await runExtraUsage();
  if (result.type === 'message') {
    onDone(result.value);
    return null;
  }
  return <Login startingMessage={'Starting new login following /extra-usage. Exit with Ctrl-C to use existing account.'} onDone={success => {
    context.onChangeAPIKey();
    onDone(success ? 'Login successful' : 'Login interrupted');
  }} />;
}
