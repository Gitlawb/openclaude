import { c as _c } from "react-compiler-runtime";
import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { Suspense, use, useState } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '../ink.js';
import type { FileEdit } from '../tools/FileEditTool/types.js';
import { findActualString, preserveQuoteStyle } from '../tools/FileEditTool/utils.js';
import { adjustHunkLineNumbers, CONTEXT_LINES, getPatchForDisplay } from '../utils/diff.js';
import { logError } from '../utils/log.js';
import { CHUNK_SIZE, openForScan, readCapped, scanForContext } from '../utils/readEditContext.js';
import { firstLineOf } from '../utils/stringUtils.js';
import { StructuredDiffList } from './StructuredDiffList.js';
type Props = {
  file_path: string;
  edits: FileEdit[];
};
type DiffData = {
  patch: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent: string | undefined;
};
export function FileEditToolDiff(props) {
  const $ = _c(7);
  let t0;
  if ($[0] !== props.edits || $[1] !== props.file_path) {
    t0 = () => loadDiffData(props.file_path, props.edits);
    $[0] = props.edits;
    $[1] = props.file_path;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const [dataPromise] = useState(t0);
  let t1;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <DiffFrame placeholder={true} />;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== dataPromise || $[5] !== props.file_path) {
    t2 = <Suspense fallback={t1}><DiffBody promise={dataPromise} file_path={props.file_path} /></Suspense>;
    $[4] = dataPromise;
    $[5] = props.file_path;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  return t2;
}
function DiffBody(t0) {
  const $ = _c(6);
  const {
    promise,
    file_path
  } = t0;
  const {
    // @ts-expect-error property does not exist on inferred type
    patch,
    // @ts-expect-error property does not exist on inferred type
    firstLine,
    // @ts-expect-error property does not exist on inferred type
    fileContent
  } = use(promise);
  const {
    columns
  } = useTerminalSize();
  let t1;
  if ($[0] !== columns || $[1] !== fileContent || $[2] !== file_path || $[3] !== firstLine || $[4] !== patch) {
    t1 = <DiffFrame><StructuredDiffList hunks={patch} dim={false} width={columns} filePath={file_path} firstLine={firstLine} fileContent={fileContent} /></DiffFrame>;
    $[0] = columns;
    $[1] = fileContent;
    $[2] = file_path;
    $[3] = firstLine;
    $[4] = patch;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  return t1;
}
function DiffFrame(t0) {
  const $ = _c(5);
  const {
    children,
    placeholder
  } = t0;
  let t1;
  if ($[0] !== children || $[1] !== placeholder) {
    t1 = placeholder ? <Text dimColor={true}>…</Text> : children;
    $[0] = children;
    $[1] = placeholder;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== t1) {
    t2 = <Box flexDirection="column"><Box borderColor="subtle" borderStyle="dashed" flexDirection="column" borderLeft={false} borderRight={false}>{t1}</Box></Box>;
    $[3] = t1;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}
async function loadDiffData(file_path: string, edits: FileEdit[]): Promise<DiffData> {
  const valid = edits.filter(e => e.old_string != null && e.new_string != null);
  const single = valid.length === 1 ? valid[0]! : undefined;

  // SedEditPermissionRequest passes the entire file as old_string. Scanning for
  // a needle ≥ CHUNK_SIZE allocates O(needle) for the overlap buffer — skip the
  // file read entirely and diff the inputs we already have.
  if (single && single.old_string.length >= CHUNK_SIZE) {
    return diffToolInputsOnly(file_path, [single]);
  }
  try {
    const handle = await openForScan(file_path);
    if (handle === null) return diffToolInputsOnly(file_path, valid);
    try {
      // Multi-edit and empty old_string genuinely need full-file for sequential
      // replacements — structuredPatch needs before/after strings. replace_all
      // routes through the chunked path below (shows first-occurrence window;
      // matches within the slice still replace via edit.replace_all).
      if (!single || single.old_string === '') {
        const file = await readCapped(handle);
        if (file === null) return diffToolInputsOnly(file_path, valid);
        const normalized = valid.map(e => normalizeEdit(file, e));
        return {
          patch: getPatchForDisplay({
            filePath: file_path,
            fileContents: file,
            edits: normalized
          }),
          firstLine: firstLineOf(file),
          fileContent: file
        };
      }
      const ctx = await scanForContext(handle, single.old_string, CONTEXT_LINES);
      if (ctx.truncated || ctx.content === '') {
        return diffToolInputsOnly(file_path, [single]);
      }
      const normalized = normalizeEdit(ctx.content, single);
      const hunks = getPatchForDisplay({
        filePath: file_path,
        fileContents: ctx.content,
        edits: [normalized]
      });
      return {
        patch: adjustHunkLineNumbers(hunks, ctx.lineOffset - 1),
        firstLine: ctx.lineOffset === 1 ? firstLineOf(ctx.content) : null,
        fileContent: ctx.content
      };
    } finally {
      await handle.close();
    }
  } catch (e) {
    logError(e as Error);
    return diffToolInputsOnly(file_path, valid);
  }
}
function diffToolInputsOnly(filePath: string, edits: FileEdit[]): DiffData {
  return {
    patch: edits.flatMap(e => getPatchForDisplay({
      filePath,
      fileContents: e.old_string,
      edits: [e]
    })),
    firstLine: null,
    fileContent: undefined
  };
}
function normalizeEdit(fileContent: string, edit: FileEdit): FileEdit {
  const actualOld = findActualString(fileContent, edit.old_string) || edit.old_string;
  const actualNew = preserveQuoteStyle(edit.old_string, actualOld, edit.new_string);
  return {
    ...edit,
    old_string: actualOld,
    new_string: actualNew
  };
}
