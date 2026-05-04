import { c as _c } from "react-compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import type { StructuredPatchHunk } from 'diff';
import { isAbsolute, relative, resolve } from 'path';
import * as React from 'react';
import { Suspense, use, useState } from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { extractTag } from 'src/utils/messages.js';
import { CtrlOToExpand } from '../../components/CtrlOToExpand.js';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { FileEditToolUpdatedMessage } from '../../components/FileEditToolUpdatedMessage.js';
import { FileEditToolUseRejectedMessage } from '../../components/FileEditToolUseRejectedMessage.js';
import { FilePathLink } from '../../components/FilePathLink.js';
import { HighlightedCode } from '../../components/HighlightedCode.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { getCwd } from '../../utils/cwd.js';
import { getPatchForDisplay } from '../../utils/diff.js';
import { getDisplayPath } from '../../utils/file.js';
import { logError } from '../../utils/log.js';
import { getPlansDirectory } from '../../utils/plans.js';
import { openForScan, readCapped } from '../../utils/readEditContext.js';
import type { Output } from './FileWriteTool.js';
const MAX_LINES_TO_RENDER = 10;
// Model output uses \n regardless of platform, so always split on \n.
// os.EOL is \r\n on Windows, which would give numLines=1 for all files.
const EOL = '\n';

/**
 * Count visible lines in file content. A trailing newline is treated as a
 * line terminator (not a new empty line), matching editor line numbering.
 */
export function countLines(content: string): number {
  const parts = content.split(EOL);
  return content.endsWith(EOL) ? parts.length - 1 : parts.length;
}
function FileWriteToolCreatedMessage(t0) {
  const $ = _c(25);
  const {
    filePath,
    content,
    verbose
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const contentWithFallback = content || "(No content)";
  const numLines = countLines(content);
  const plusLines = numLines - MAX_LINES_TO_RENDER;
  let t1;
  if ($[0] !== numLines) {
    t1 = <Text bold={true}>{numLines}</Text>;
    $[0] = numLines;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== filePath || $[3] !== verbose) {
    t2 = verbose ? filePath : relative(getCwd(), filePath);
    $[2] = filePath;
    $[3] = verbose;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== t2) {
    t3 = <Text bold={true}>{t2}</Text>;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t1 || $[8] !== t3) {
    t4 = <Text>Wrote {t1} lines to{" "}{t3}</Text>;
    $[7] = t1;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== contentWithFallback || $[11] !== verbose) {
    t5 = verbose ? contentWithFallback : contentWithFallback.split("\n").slice(0, MAX_LINES_TO_RENDER).join("\n");
    $[10] = contentWithFallback;
    $[11] = verbose;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const t6 = columns - 12;
  let t7;
  if ($[13] !== filePath || $[14] !== t5 || $[15] !== t6) {
    // @ts-expect-error type mismatch
    t7 = <Box flexDirection="column"><HighlightedCode code={t5} filePath={filePath} width={t6} /></Box>;
    $[13] = filePath;
    $[14] = t5;
    $[15] = t6;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== numLines || $[18] !== plusLines || $[19] !== verbose) {
    t8 = !verbose && plusLines > 0 && <Text dimColor={true}>… +{plusLines} {plusLines === 1 ? "line" : "lines"}{" "}{numLines > 0 && <CtrlOToExpand />}</Text>;
    $[17] = numLines;
    $[18] = plusLines;
    $[19] = verbose;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  let t9;
  if ($[21] !== t4 || $[22] !== t7 || $[23] !== t8) {
    t9 = <MessageResponse><Box flexDirection="column">{t4}{t7}{t8}</Box></MessageResponse>;
    $[21] = t4;
    $[22] = t7;
    $[23] = t8;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  return t9;
}
export function userFacingName(input: Partial<{
  file_path: string;
  content: string;
}> | undefined): string {
  if (input?.file_path?.startsWith(getPlansDirectory())) {
    return 'Updated plan';
  }
  return 'Write';
}

/** Gates fullscreen click-to-expand. Only `create` truncates (to
 *  MAX_LINES_TO_RENDER); `update` renders the full diff regardless of verbose.
 *  Called per visible message on hover/scroll, so early-exit after finding the
 *  (MAX+1)th line instead of splitting the whole (possibly huge) content. */
export function isResultTruncated({
  type,
  content
}: Output): boolean {
  if (type !== 'create') return false;
  let pos = 0;
  for (let i = 0; i < MAX_LINES_TO_RENDER; i++) {
    pos = content.indexOf(EOL, pos);
    if (pos === -1) return false;
    pos++;
  }
  // countLines treats a trailing EOL as a terminator, not a new line
  return pos < content.length;
}
export function getToolUseSummary(input: Partial<{
  file_path: string;
  content: string;
}> | undefined): string | null {
  if (!input?.file_path) {
    return null;
  }
  return getDisplayPath(input.file_path);
}
export function renderToolUseMessage(input: Partial<{
  file_path: string;
  content: string;
}>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!input.file_path) {
    return null;
  }
  // For plan files, path is already in userFacingName
  if (input.file_path.startsWith(getPlansDirectory())) {
    return '';
  }
  return <FilePathLink filePath={input.file_path}>
      {verbose ? input.file_path : getDisplayPath(input.file_path)}
    </FilePathLink>;
}
export function renderToolUseRejectedMessage({
  file_path,
  content
}: {
  file_path: string;
  content: string;
}, {
  style,
  verbose
}: {
  style?: 'condensed';
  verbose: boolean;
}): React.ReactNode {
  return <WriteRejectionDiff filePath={file_path} content={content} style={style} verbose={verbose} />;
}
type RejectionDiffData = {
  type: 'create';
} | {
  type: 'update';
  patch: StructuredPatchHunk[];
  oldContent: string;
} | {
  type: 'error';
};
function WriteRejectionDiff(t0) {
  const $ = _c(20);
  const {
    filePath,
    content,
    style,
    verbose
  } = t0;
  let t1;
  if ($[0] !== content || $[1] !== filePath) {
    t1 = () => loadRejectionDiff(filePath, content);
    $[0] = content;
    $[1] = filePath;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const [dataPromise] = useState(t1);
  let t2;
  if ($[3] !== content) {
    t2 = content.split("\n")[0] ?? null;
    $[3] = content;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const firstLine = t2;
  let t3;
  if ($[5] !== content || $[6] !== filePath || $[7] !== firstLine || $[8] !== verbose) {
    t3 = <FileEditToolUseRejectedMessage file_path={filePath} operation="write" content={content} firstLine={firstLine} verbose={verbose} />;
    $[5] = content;
    $[6] = filePath;
    $[7] = firstLine;
    $[8] = verbose;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  const createFallback = t3;
  let t4;
  if ($[10] !== createFallback || $[11] !== dataPromise || $[12] !== filePath || $[13] !== firstLine || $[14] !== style || $[15] !== verbose) {
    t4 = <WriteRejectionBody promise={dataPromise} filePath={filePath} firstLine={firstLine} createFallback={createFallback} style={style} verbose={verbose} />;
    $[10] = createFallback;
    $[11] = dataPromise;
    $[12] = filePath;
    $[13] = firstLine;
    $[14] = style;
    $[15] = verbose;
    $[16] = t4;
  } else {
    t4 = $[16];
  }
  let t5;
  if ($[17] !== createFallback || $[18] !== t4) {
    t5 = <Suspense fallback={createFallback}>{t4}</Suspense>;
    $[17] = createFallback;
    $[18] = t4;
    $[19] = t5;
  } else {
    t5 = $[19];
  }
  return t5;
}
function WriteRejectionBody(t0) {
  const $ = _c(8);
  const {
    promise,
    filePath,
    firstLine,
    createFallback,
    style,
    verbose
  } = t0;
  const data = use(promise);
  if ((data as any).type === "create") {
    return createFallback;
  }
  if ((data as any).type === "error") {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <MessageResponse><Text>(No changes)</Text></MessageResponse>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  let t1;
  if ($[1] !== (data as any).oldContent || $[2] !== (data as any).patch || $[3] !== filePath || $[4] !== firstLine || $[5] !== style || $[6] !== verbose) {
    t1 = <FileEditToolUseRejectedMessage file_path={filePath} operation="update" patch={(data as any).patch} firstLine={firstLine} fileContent={(data as any).oldContent} style={style} verbose={verbose} />;
    $[1] = (data as any).oldContent;
    $[2] = (data as any).patch;
    $[3] = filePath;
    $[4] = firstLine;
    $[5] = style;
    $[6] = verbose;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  return t1;
}
async function loadRejectionDiff(filePath: string, content: string): Promise<RejectionDiffData> {
  try {
    const fullFilePath = isAbsolute(filePath) ? filePath : resolve(getCwd(), filePath);
    const handle = await openForScan(fullFilePath);
    if (handle === null) return {
      type: 'create'
    };
    let oldContent: string | null;
    try {
      oldContent = await readCapped(handle);
    } finally {
      await handle.close();
    }
    // File exceeds MAX_SCAN_BYTES — fall back to the create view rather than
    // OOMing on a diff of a multi-GB file.
    if (oldContent === null) return {
      type: 'create'
    };
    const patch = getPatchForDisplay({
      filePath,
      fileContents: oldContent,
      edits: [{
        old_string: oldContent,
        new_string: content,
        replace_all: false
      }]
    });
    return {
      type: 'update',
      patch,
      oldContent
    };
  } catch (e) {
    // User may have manually applied the change while the diff was shown.
    logError(e as Error);
    return {
      type: 'error'
    };
  }
}
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse>
        <Text color="error">Error writing file</Text>
      </MessageResponse>;
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
export function renderToolResultMessage({
  filePath,
  content,
  structuredPatch,
  type,
  originalFile
}: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  style,
  verbose
}: {
  style?: 'condensed';
  verbose: boolean;
}): React.ReactNode {
  switch (type) {
    case 'create':
      {
        const isPlanFile = filePath.startsWith(getPlansDirectory());

        // Plan files: invert condensed behavior
        // - Regular mode: just show hint (user can type /plan to see full content)
        // - Condensed mode (subagent view): show full content
        if (isPlanFile && !verbose) {
          if (style !== 'condensed') {
            return <MessageResponse>
              <Text dimColor>/plan to preview</Text>
            </MessageResponse>;
          }
        } else if (style === 'condensed' && !verbose) {
          const numLines = countLines(content);
          return <Text>
            Wrote <Text bold>{numLines}</Text> lines to{' '}
            <Text bold>{relative(getCwd(), filePath)}</Text>
          </Text>;
        }
        return <FileWriteToolCreatedMessage filePath={filePath} content={content} verbose={verbose} />;
      }
    case 'update':
      {
        const isPlanFile = filePath.startsWith(getPlansDirectory());
        return <FileEditToolUpdatedMessage filePath={filePath} structuredPatch={structuredPatch} firstLine={content.split('\n')[0] ?? null} fileContent={originalFile ?? undefined} style={style} verbose={verbose} previewHint={isPlanFile ? '/plan to preview' : undefined} />;
      }
  }
}
