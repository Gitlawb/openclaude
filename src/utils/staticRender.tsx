import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useLayoutEffect } from 'react';
import { PassThrough } from 'stream';
import stripAnsi from 'strip-ansi';
import { render, useApp } from '../ink.js';

// This is a workaround for the fact that Ink doesn't support multiple <Static>
// components in the same render tree. Instead of using a <Static> we just render
// the component to a string and then print it to stdout

/**
 * Wrapper component that exits after rendering.
 * Uses useLayoutEffect to ensure we wait for React's commit phase to complete
 * before exiting. This is more robust than process.nextTick() for React 19's
 * async render cycle.
 */
function RenderOnceAndExit(t0) {
  const $ = _c(5);
  const {
    children
  } = t0;
  const {
    exit
  } = useApp();
  let t1;
  let t2;
  if ($[0] !== exit) {
    t1 = () => {
      const timer = setTimeout(exit, 0);
      return () => clearTimeout(timer);
    };
    t2 = [exit];
    $[0] = exit;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useLayoutEffect(t1, t2);
  let t3;
  if ($[3] !== children) {
    t3 = <>{children}</>;
    $[3] = children;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}

// DEC synchronized update markers used by terminals
const SYNC_START = '\x1B[?2026h';
const SYNC_END = '\x1B[?2026l';

/**
 * Extracts content from the first complete frame in Ink's output.
 * Ink with non-TTY stdout outputs multiple frames, each wrapped in DEC synchronized
 * update sequences ([?2026h ... [?2026l). We only want the first frame's content.
 */
function extractFirstFrame(output: string): string {
  const startIndex = output.indexOf(SYNC_START);
  if (startIndex === -1) return output;
  const contentStart = startIndex + SYNC_START.length;
  const endIndex = output.indexOf(SYNC_END, contentStart);
  if (endIndex === -1) return output;
  return output.slice(contentStart, endIndex);
}

/**
 * Renders a React node to a string with ANSI escape codes (for terminal output).
 */
export function renderToAnsiString(node: React.ReactNode, columns?: number): Promise<string> {
  return new Promise(async resolve => {
    let output = '';

    // Capture all writes. Set .columns so Ink (ink.tsx:~165) picks up a
    // chosen width instead of PassThrough's undefined → 80 fallback —
    // useful for rendering at terminal width for file dumps that should
    // match what the user sees on screen.
    const stream = new PassThrough();
    if (columns !== undefined) {
      ;
      (stream as unknown as {
        columns: number;
      }).columns = columns;
    }
    stream.on('data', chunk => {
      output += chunk.toString();
    });

    // Render the component wrapped in RenderOnceAndExit
    // Non-TTY stdout (PassThrough) gives full-frame output instead of diffs
    const instance = await render(<RenderOnceAndExit>{node}</RenderOnceAndExit>, {
      stdout: stream as unknown as NodeJS.WriteStream,
      patchConsole: false
    });

    // Wait for the component to exit naturally
    await instance.waitUntilExit();

    // Extract only the first frame's content to avoid duplication
    // (Ink outputs multiple frames in non-TTY mode)
    await resolve(extractFirstFrame(output));
  });
}

/**
 * Renders a React node to a plain text string (ANSI codes stripped).
 */
export async function renderToString(node: React.ReactNode, columns?: number): Promise<string> {
  const output = await renderToAnsiString(node, columns);
  return stripAnsi(output);
}
