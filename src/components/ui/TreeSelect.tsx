import { c as _c } from "react-compiler-runtime";
import React from 'react';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box } from '../../ink.js';
import { type OptionWithDescription, Select } from '../CustomSelect/select.js';
export type TreeNode<T> = {
  id: string | number;
  value: T;
  label: string;
  description?: string;
  dimDescription?: boolean;
  children?: TreeNode<T>[];
  metadata?: Record<string, unknown>;
};
type FlattenedNode<T> = {
  node: TreeNode<T>;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  parentId?: string | number;
};
export type TreeSelectProps<T> = {
  /**
   * Tree nodes to display.
   */
  readonly nodes: TreeNode<T>[];

  /**
   * Callback when a node is selected.
   */
  readonly onSelect: (node: TreeNode<T>) => void;

  /**
   * Callback when cancel is pressed.
   */
  readonly onCancel?: () => void;

  /**
   * Callback when focused node changes.
   */
  readonly onFocus?: (node: TreeNode<T>) => void;

  /**
   * Node to focus by ID.
   */
  readonly focusNodeId?: string | number;

  /**
   * Number of visible options.
   */
  readonly visibleOptionCount?: number;

  /**
   * Layout of the options.
   */
  readonly layout?: 'compact' | 'expanded' | 'compact-vertical';

  /**
   * When disabled, user input is ignored.
   */
  readonly isDisabled?: boolean;

  /**
   * When true, hides the numeric indexes next to each option.
   */
  readonly hideIndexes?: boolean;

  /**
   * Function to determine if a node should be initially expanded.
   * If not provided, all nodes start collapsed.
   */
  readonly isNodeExpanded?: (nodeId: string | number) => boolean;

  /**
   * Callback when a node is expanded.
   */
  readonly onExpand?: (nodeId: string | number) => void;

  /**
   * Callback when a node is collapsed.
   */
  readonly onCollapse?: (nodeId: string | number) => void;

  /**
   * Custom prefix function for parent nodes
   * @param isExpanded - Whether the parent node is currently expanded
   * @returns The prefix string to display (default: '▼ ' when expanded, '▶ ' when collapsed)
   */
  readonly getParentPrefix?: (isExpanded: boolean) => string;

  /**
   * Custom prefix function for child nodes
   * @param depth - The depth of the child node in the tree (0-indexed from parent)
   * @returns The prefix string to display (default: '  ▸ ')
   */
  readonly getChildPrefix?: (depth: number) => string;

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  readonly onUpFromFirstItem?: () => void;
};

/**
 * TreeSelect is a generic component for selecting items from a hierarchical tree structure.
 * It handles expand/collapse state, keyboard navigation, and renders the tree as a flat list
 * using the Select component.
 */
export function TreeSelect(t0) {
  const $ = _c(48);
  const {
    nodes,
    onSelect,
    onCancel,
    onFocus,
    focusNodeId,
    visibleOptionCount,
    layout: t1,
    isDisabled: t2,
    hideIndexes: t3,
    isNodeExpanded,
    onExpand,
    onCollapse,
    getParentPrefix,
    getChildPrefix,
    onUpFromFirstItem
  } = t0;
  const layout = t1 === undefined ? "expanded" : t1;
  const isDisabled = t2 === undefined ? false : t2;
  const hideIndexes = t3 === undefined ? false : t3;
  let t4;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = new Set();
    $[0] = t4;
  } else {
    t4 = $[0];
  }
  const [internalExpandedIds, setInternalExpandedIds] = React.useState(t4);
  const isProgrammaticFocusRef = React.useRef(false);
  const lastFocusedIdRef = React.useRef(null);
  let t5;
  if ($[1] !== internalExpandedIds || $[2] !== isNodeExpanded) {
    t5 = nodeId => {
      if (isNodeExpanded) {
        return isNodeExpanded(nodeId);
      }
      return internalExpandedIds.has(nodeId);
    };
    $[1] = internalExpandedIds;
    $[2] = isNodeExpanded;
    $[3] = t5;
  } else {
    t5 = $[3];
  }
  const isExpanded = t5;
  let result;
  if ($[4] !== isExpanded || $[5] !== nodes) {
    result = [];
    function traverse(node, depth, parentId) {
      const hasChildren = !!node.children && node.children.length > 0;
      const nodeIsExpanded = isExpanded(node.id);
      result.push({
        node,
        depth,
        isExpanded: nodeIsExpanded,
        hasChildren,
        parentId
      });
      if (hasChildren && nodeIsExpanded && node.children) {
        for (const child of node.children) {
          traverse(child, depth + 1, node.id);
        }
      }
    }
    for (const node_0 of nodes) {
      traverse(node_0, 0);
    }
    $[4] = isExpanded;
    $[5] = nodes;
    $[6] = result;
  } else {
    result = $[6];
  }
  const flattenedNodes = result;
  const defaultGetParentPrefix = _temp;
  const defaultGetChildPrefix = _temp2;
  const parentPrefixFn = getParentPrefix ?? defaultGetParentPrefix;
  const childPrefixFn = getChildPrefix ?? defaultGetChildPrefix;
  let t6;
  if ($[7] !== childPrefixFn || $[8] !== parentPrefixFn) {
    t6 = flatNode => {
      let prefix = "";
      if (flatNode.hasChildren) {
        prefix = parentPrefixFn(flatNode.isExpanded);
      } else {
        if (flatNode.depth > 0) {
          prefix = childPrefixFn(flatNode.depth);
        }
      }
      return prefix + flatNode.node.label;
    };
    $[7] = childPrefixFn;
    $[8] = parentPrefixFn;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  const buildLabel = t6;
  let t7;
  if ($[10] !== buildLabel || $[11] !== flattenedNodes) {
    t7 = flattenedNodes.map(flatNode_0 => ({
      label: buildLabel(flatNode_0),
      description: flatNode_0.node.description,
      dimDescription: flatNode_0.node.dimDescription ?? true,
      value: flatNode_0.node.id
    }));
    $[10] = buildLabel;
    $[11] = flattenedNodes;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  const options = t7;
  let map;
  if ($[13] !== flattenedNodes) {
    map = new Map();
    flattenedNodes.forEach(fn => map.set(fn.node.id, fn.node));
    $[13] = flattenedNodes;
    $[14] = map;
  } else {
    map = $[14];
  }
  const nodeMap = map;
  let t8;
  if ($[15] !== flattenedNodes) {
    t8 = nodeId_0 => flattenedNodes.find(fn_0 => fn_0.node.id === nodeId_0);
    $[15] = flattenedNodes;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  const findFlattenedNode = t8;
  let t9;
  if ($[17] !== findFlattenedNode || $[18] !== onCollapse || $[19] !== onExpand) {
    t9 = (nodeId_1, shouldExpand) => {
      const flatNode_1 = findFlattenedNode(nodeId_1);
      if (!flatNode_1 || !flatNode_1.hasChildren) {
        return;
      }
      if (shouldExpand) {
        if (onExpand) {
          onExpand(nodeId_1);
        } else {
          setInternalExpandedIds(prev => new Set(prev).add(nodeId_1));
        }
      } else {
        if (onCollapse) {
          onCollapse(nodeId_1);
        } else {
          setInternalExpandedIds(prev_0 => {
            const newSet = new Set(prev_0);
            newSet.delete(nodeId_1);
            return newSet;
          });
        }
      }
    };
    $[17] = findFlattenedNode;
    $[18] = onCollapse;
    $[19] = onExpand;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  const toggleExpand = t9;
  let t10;
  if ($[21] !== findFlattenedNode || $[22] !== focusNodeId || $[23] !== isDisabled || $[24] !== nodeMap || $[25] !== onFocus || $[26] !== toggleExpand) {
    t10 = e => {
      if (!focusNodeId || isDisabled) {
        return;
      }
      const flatNode_2 = findFlattenedNode(focusNodeId);
      if (!flatNode_2) {
        return;
      }
      if (e.key === "right" && flatNode_2.hasChildren) {
        e.preventDefault();
        toggleExpand(focusNodeId, true);
      } else {
        if (e.key === "left") {
          if (flatNode_2.hasChildren && flatNode_2.isExpanded) {
            e.preventDefault();
            toggleExpand(focusNodeId, false);
          } else {
            if (flatNode_2.parentId !== undefined) {
              e.preventDefault();
              isProgrammaticFocusRef.current = true;
              toggleExpand(flatNode_2.parentId, false);
              if (onFocus) {
                const parentNode = nodeMap.get(flatNode_2.parentId);
                if (parentNode) {
                  onFocus(parentNode);
                }
              }
            }
          }
        }
      }
    };
    $[21] = findFlattenedNode;
    $[22] = focusNodeId;
    $[23] = isDisabled;
    $[24] = nodeMap;
    $[25] = onFocus;
    $[26] = toggleExpand;
    $[27] = t10;
  } else {
    t10 = $[27];
  }
  const handleKeyDown = t10;
  let t11;
  if ($[28] !== nodeMap || $[29] !== onSelect) {
    t11 = nodeId_2 => {
      const node_1 = nodeMap.get(nodeId_2);
      if (!node_1) {
        return;
      }
      onSelect(node_1);
    };
    $[28] = nodeMap;
    $[29] = onSelect;
    $[30] = t11;
  } else {
    t11 = $[30];
  }
  const handleChange = t11;
  let t12;
  if ($[31] !== nodeMap || $[32] !== onFocus) {
    t12 = nodeId_3 => {
      if (isProgrammaticFocusRef.current) {
        isProgrammaticFocusRef.current = false;
        return;
      }
      if (lastFocusedIdRef.current === nodeId_3) {
        return;
      }
      lastFocusedIdRef.current = nodeId_3;
      if (onFocus) {
        const node_2 = nodeMap.get(nodeId_3);
        if (node_2) {
          onFocus(node_2);
        }
      }
    };
    $[31] = nodeMap;
    $[32] = onFocus;
    $[33] = t12;
  } else {
    t12 = $[33];
  }
  const handleFocus = t12;
  let t13;
  if ($[34] !== focusNodeId || $[35] !== handleChange || $[36] !== handleFocus || $[37] !== hideIndexes || $[38] !== isDisabled || $[39] !== layout || $[40] !== onCancel || $[41] !== onUpFromFirstItem || $[42] !== options || $[43] !== visibleOptionCount) {
    t13 = <Select options={options} onChange={handleChange} onFocus={handleFocus} onCancel={onCancel} defaultFocusValue={focusNodeId} visibleOptionCount={visibleOptionCount} layout={layout} isDisabled={isDisabled} hideIndexes={hideIndexes} onUpFromFirstItem={onUpFromFirstItem} />;
    $[34] = focusNodeId;
    $[35] = handleChange;
    $[36] = handleFocus;
    $[37] = hideIndexes;
    $[38] = isDisabled;
    $[39] = layout;
    $[40] = onCancel;
    $[41] = onUpFromFirstItem;
    $[42] = options;
    $[43] = visibleOptionCount;
    $[44] = t13;
  } else {
    t13 = $[44];
  }
  let t14;
  if ($[45] !== handleKeyDown || $[46] !== t13) {
    t14 = <Box tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t13}</Box>;
    $[45] = handleKeyDown;
    $[46] = t13;
    $[47] = t14;
  } else {
    t14 = $[47];
  }
  return t14;
}
function _temp2(_depth) {
  return "  \u25B8 ";
}
function _temp(isExpanded_0) {
  return isExpanded_0 ? "\u25BC " : "\u25B6 ";
}
