import { c as _c } from "react-compiler-runtime";
import setWith from 'lodash-es/setWith.js';
import * as React from 'react';
import { Box, Text, useTheme } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { type TreeNode, treeify } from '../utils/treeify.js';

/**
 * Builds a nested tree structure from dot-notation paths
 * Uses lodash setWith to avoid automatic array creation
 */
function buildNestedTree(errors: ValidationError[]): TreeNode {
  const tree: TreeNode = {};
  errors.forEach(error => {
    if (!error.path) {
      // Root level error - use empty string as key
      tree[''] = error.message;
      return;
    }

    // Try to enhance the path with meaningful values
    const pathParts = error.path.split('.');
    let modifiedPath = error.path;

    // If we have an invalid value, try to make the path more readable
    if (error.invalidValue !== null && error.invalidValue !== undefined && pathParts.length > 0) {
      const newPathParts: string[] = [];
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        if (!part) continue;
        const numericPart = parseInt(part, 10);

        // If this is a numeric index and it's the last part where we have the invalid value
        if (!isNaN(numericPart) && i === pathParts.length - 1) {
          // Format the value for display
          let displayValue: string;
          if (typeof error.invalidValue === 'string') {
            displayValue = `"${error.invalidValue}"`;
          } else if (error.invalidValue === null) {
            displayValue = 'null';
          } else if (error.invalidValue === undefined) {
            displayValue = 'undefined';
          } else {
            displayValue = String(error.invalidValue);
          }
          newPathParts.push(displayValue);
        } else {
          // Keep other parts as-is
          newPathParts.push(part);
        }
      }
      modifiedPath = newPathParts.join('.');
    }
    setWith(tree, modifiedPath, error.message, Object);
  });
  return tree;
}

/**
 * Groups and displays validation errors using treeify with deduplication
 */
export function ValidationErrorsList(t0) {
  const $ = _c(9);
  const {
    errors
  } = t0;
  const [themeName] = useTheme();
  if (errors.length === 0) {
    return null;
  }
  let T0;
  let t1;
  let t2;
  if ($[0] !== errors || $[1] !== themeName) {
    const errorsByFile = errors.reduce(_temp, {});
    const sortedFiles = Object.keys(errorsByFile).sort();
    T0 = Box;
    t1 = "column";
    t2 = sortedFiles.map(file_0 => {
      const fileErrors = errorsByFile[file_0] || [];
      fileErrors.sort(_temp2);
      const errorTree = buildNestedTree(fileErrors);
      const suggestionPairs = new Map();
      fileErrors.forEach(error_0 => {
        if (error_0.suggestion || error_0.docLink) {
          const key = `${error_0.suggestion || ""}|${error_0.docLink || ""}`;
          if (!suggestionPairs.has(key)) {
            suggestionPairs.set(key, {
              suggestion: error_0.suggestion,
              docLink: error_0.docLink
            });
          }
        }
      });
      const treeOutput = treeify(errorTree, {
        showValues: true,
        themeName,
        treeCharColors: {
          treeChar: "inactive",
          key: "text",
          value: "inactive"
        }
      });
      return <Box key={file_0} flexDirection="column"><Text>{file_0}</Text><Box marginLeft={1}><Text dimColor={true}>{treeOutput}</Text></Box>{suggestionPairs.size > 0 && <Box flexDirection="column" marginTop={1}>{Array.from(suggestionPairs.values()).map(_temp3)}</Box>}</Box>;
    });
    $[0] = errors;
    $[1] = themeName;
    $[2] = T0;
    $[3] = t1;
    $[4] = t2;
  } else {
    T0 = $[2];
    t1 = $[3];
    t2 = $[4];
  }
  let t3;
  if ($[5] !== T0 || $[6] !== t1 || $[7] !== t2) {
    t3 = <T0 flexDirection={t1}>{t2}</T0>;
    $[5] = T0;
    $[6] = t1;
    $[7] = t2;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
function _temp3(pair, index) {
  return <Box key={`suggestion-pair-${index}`} flexDirection="column" marginBottom={1}>{pair.suggestion && <Text dimColor={true} wrap="wrap">{pair.suggestion}</Text>}{pair.docLink && <Text dimColor={true} wrap="wrap">Learn more: {pair.docLink}</Text>}</Box>;
}
function _temp2(a, b) {
  if (!a.path && b.path) {
    return -1;
  }
  if (a.path && !b.path) {
    return 1;
  }
  return (a.path || "").localeCompare(b.path || "");
}
function _temp(acc, error) {
  const file = error.file || "(file not specified)";
  if (!acc[file]) {
    acc[file] = [];
  }
  acc[file].push(error);
  return acc;
}
