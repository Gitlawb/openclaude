import { c as _c } from "react-compiler-runtime";
import type { ElicitRequestFormParams, ElicitRequestURLParams, ElicitResult, PrimitiveSchemaDefinition } from '@modelcontextprotocol/sdk/types.js';
import figures from 'figures';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { useNotifyAfterTimeout } from '../../hooks/useNotifyAfterTimeout.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text input for elicitation form
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { ElicitationRequestEvent } from '../../services/mcp/elicitationHandler.js';
import { openBrowser } from '../../utils/browser.js';
import { getEnumLabel, getEnumValues, getMultiSelectLabel, getMultiSelectValues, isDateTimeSchema, isEnumSchema, isMultiSelectEnumSchema, validateElicitationInput, validateElicitationInputAsync } from '../../utils/mcp/elicitationValidation.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import TextInput from '../TextInput.js';
type Props = {
  event: ElicitationRequestEvent;
  onResponse: (action: ElicitResult['action'], content?: ElicitResult['content']) => void;
  /** Called when the phase 2 waiting state is dismissed (URL elicitations only). */
  onWaitingDismiss?: (action: 'dismiss' | 'retry' | 'cancel') => void;
};
const isTextField = (s: PrimitiveSchemaDefinition) => ['string', 'number', 'integer'].includes(s.type);
const RESOLVING_SPINNER_CHARS = '\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F';
const advanceSpinnerFrame = (f: number) => (f + 1) % RESOLVING_SPINNER_CHARS.length;

/** Timer callback for enumTypeaheadRef — module-scope to avoid closure capture. */
function resetTypeahead(ta: {
  buffer: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}): void {
  ta.buffer = '';
  ta.timer = undefined;
}

/**
 * Isolated spinner glyph for a field that is being resolved asynchronously.
 * Owns its own 80ms animation timer so ticks only re-render this tiny leaf,
 * not the entire ElicitationFormDialog (~1200 lines + renderFormFields).
 * Mounted/unmounted by the parent via the `isResolving` condition.
 *
 * Not using the shared <Spinner /> from ../Spinner.js: that one renders in a
 * <Box width={2}> with color="text", which would break the 1-col checkbox
 * column alignment here (other checkbox states are width-1 glyphs).
 */
function ResolvingSpinner() {
  const $ = _c(4);
  const [frame, setFrame] = useState(0);
  let t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = () => {
      const timer = setInterval(setFrame, 80, advanceSpinnerFrame);
      return () => clearInterval(timer);
    };
    t1 = [];
    $[0] = t0;
    $[1] = t1;
  } else {
    t0 = $[0];
    t1 = $[1];
  }
  useEffect(t0, t1);
  const t2 = RESOLVING_SPINNER_CHARS[frame];
  let t3;
  if ($[2] !== t2) {
    t3 = <Text color="warning">{t2}</Text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  return t3;
}

/** Format an ISO date/datetime for display, keeping the ISO value for submission. */
function formatDateDisplay(isoValue: string, schema: PrimitiveSchemaDefinition): string {
  try {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return isoValue;
    const format = 'format' in schema ? schema.format : undefined;
    if (format === 'date-time') {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    }
    // date-only: parse as local date to avoid timezone shift
    const parts = isoValue.split('-');
    if (parts.length === 3) {
      const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return local.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    return isoValue;
  } catch {
    return isoValue;
  }
}
export function ElicitationDialog(t0) {
  const $ = _c(7);
  const {
    event,
    onResponse,
    onWaitingDismiss
  } = t0;
  if (event.params.mode === "url") {
    let t1;
    if ($[0] !== event || $[1] !== onResponse || $[2] !== onWaitingDismiss) {
      t1 = <ElicitationURLDialog event={event} onResponse={onResponse} onWaitingDismiss={onWaitingDismiss} />;
      $[0] = event;
      $[1] = onResponse;
      $[2] = onWaitingDismiss;
      $[3] = t1;
    } else {
      t1 = $[3];
    }
    return t1;
  }
  let t1;
  if ($[4] !== event || $[5] !== onResponse) {
    t1 = <ElicitationFormDialog event={event} onResponse={onResponse} />;
    $[4] = event;
    $[5] = onResponse;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  return t1;
}
function ElicitationFormDialog({
  event,
  onResponse
}: {
  event: ElicitationRequestEvent;
  onResponse: Props['onResponse'];
}): React.ReactNode {
  const {
    serverName,
    signal
  } = event;
  const request = event.params as ElicitRequestFormParams;
  const {
    message,
    requestedSchema
  } = request;
  const hasFields = Object.keys(requestedSchema.properties).length > 0;
  const [focusedButton, setFocusedButton] = useState<'accept' | 'decline' | null>(hasFields ? null : 'accept');
  const [formValues, setFormValues] = useState<Record<string, string | number | boolean | string[]>>(() => {
    const initialValues: Record<string, string | number | boolean | string[]> = {};
    if (requestedSchema.properties) {
      for (const [propName, propSchema] of Object.entries(requestedSchema.properties)) {
        if (typeof propSchema === 'object' && propSchema !== null) {
          if (propSchema.default !== undefined) {
            initialValues[propName] = propSchema.default;
          }
        }
      }
    }
    return initialValues;
  });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>(() => {
    const initialErrors: Record<string, string> = {};
    for (const [propName_0, propSchema_0] of Object.entries(requestedSchema.properties)) {
      if (isTextField(propSchema_0) && propSchema_0?.default !== undefined) {
        const validation = validateElicitationInput(String(propSchema_0.default), propSchema_0);
        if (!validation.isValid && validation.error) {
          initialErrors[propName_0] = validation.error;
        }
      }
    }
    return initialErrors;
  });
  useEffect(() => {
    if (!signal) return;
    const handleAbort = () => {
      onResponse('cancel');
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort);
    return () => {
      signal.removeEventListener('abort', handleAbort);
    };
  }, [signal, onResponse]);
  const schemaFields = useMemo(() => {
    const requiredFields = requestedSchema.required ?? [];
    return Object.entries(requestedSchema.properties).map(([name, schema]) => ({
      name,
      schema,
      isRequired: requiredFields.includes(name)
    }));
  }, [requestedSchema]);
  const [currentFieldIndex, setCurrentFieldIndex] = useState<number | undefined>(hasFields ? 0 : undefined);
  const [textInputValue, setTextInputValue] = useState(() => {
    // Initialize from the first field's value if it's a text field
    const firstField = schemaFields[0];
    if (firstField && isTextField(firstField.schema)) {
      const val = formValues[firstField.name];
      if (val === undefined) return '';
      return String(val);
    }
    return '';
  });
  const [textInputCursorOffset, setTextInputCursorOffset] = useState(textInputValue.length);
  const [resolvingFields, setResolvingFields] = useState<Set<string>>(() => new Set());
  // Accordion state (shared by multi-select and single-select enum)
  const [expandedAccordion, setExpandedAccordion] = useState<string | undefined>();
  const [accordionOptionIndex, setAccordionOptionIndex] = useState(0);
  const dateDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resolveAbortRef = useRef<Map<string, AbortController>>(new Map());
  const enumTypeaheadRef = useRef({
    buffer: '',
    timer: undefined as ReturnType<typeof setTimeout> | undefined
  });

  // Clear pending debounce/typeahead timers and abort in-flight async
  // validations on unmount so they don't fire against an unmounted component
  // (e.g. dialog dismissed mid-debounce or mid-resolve).
  useEffect(() => () => {
    if (dateDebounceRef.current !== undefined) {
      clearTimeout(dateDebounceRef.current);
    }
    const ta = enumTypeaheadRef.current;
    if (ta.timer !== undefined) {
      clearTimeout(ta.timer);
    }
    for (const controller of resolveAbortRef.current.values()) {
      controller.abort();
    }
    resolveAbortRef.current.clear();
  }, []);
  const {
    columns,
    rows
  } = useTerminalSize();
  const currentField = currentFieldIndex !== undefined ? schemaFields[currentFieldIndex] : undefined;
  const currentFieldIsText = currentField !== undefined && isTextField(currentField.schema) && !isEnumSchema(currentField.schema);

  // Text fields are always in edit mode when focused — no Enter-to-edit step.
  const isEditingTextField = currentFieldIsText && !focusedButton;
  useRegisterOverlay('elicitation');
  useNotifyAfterTimeout('Claude Code needs your input', 'elicitation_dialog');

  // Sync textInputValue when the focused field changes
  const syncTextInput = useCallback((fieldIndex: number | undefined) => {
    if (fieldIndex === undefined) {
      setTextInputValue('');
      setTextInputCursorOffset(0);
      return;
    }
    const field = schemaFields[fieldIndex];
    if (field && isTextField(field.schema) && !isEnumSchema(field.schema)) {
      const val_0 = formValues[field.name];
      const text = val_0 !== undefined ? String(val_0) : '';
      setTextInputValue(text);
      setTextInputCursorOffset(text.length);
    }
  }, [schemaFields, formValues]);
  function validateMultiSelect(fieldName: string, schema_0: PrimitiveSchemaDefinition) {
    if (!isMultiSelectEnumSchema(schema_0)) return;
    const selected = formValues[fieldName] as string[] | undefined ?? [];
    const fieldRequired = schemaFields.find(f => f.name === fieldName)?.isRequired ?? false;
    const min = schema_0.minItems;
    const max = schema_0.maxItems;
    // Skip minItems check when field is optional and unset
    if (min !== undefined && selected.length < min && (selected.length > 0 || fieldRequired)) {
      updateValidationError(fieldName, `Select at least ${min} ${plural(min, 'item')}`);
    } else if (max !== undefined && selected.length > max) {
      updateValidationError(fieldName, `Select at most ${max} ${plural(max, 'item')}`);
    } else {
      updateValidationError(fieldName);
    }
  }
  function handleNavigation(direction: 'up' | 'down'): void {
    // Collapse accordion and validate on navigate away
    if (currentField && isMultiSelectEnumSchema(currentField.schema)) {
      validateMultiSelect(currentField.name, currentField.schema);
      setExpandedAccordion(undefined);
    } else if (currentField && isEnumSchema(currentField.schema)) {
      setExpandedAccordion(undefined);
    }

    // Commit current text field before navigating away
    if (isEditingTextField && currentField) {
      commitTextField(currentField.name, currentField.schema, textInputValue);

      // Cancel any pending debounce — we're resolving now on navigate-away
      if (dateDebounceRef.current !== undefined) {
        clearTimeout(dateDebounceRef.current);
        dateDebounceRef.current = undefined;
      }

      // For date/datetime fields that failed sync validation, try async NL parsing
      if (isDateTimeSchema(currentField.schema) && textInputValue.trim() !== '' && validationErrors[currentField.name]) {
        resolveFieldAsync(currentField.name, currentField.schema, textInputValue);
      }
    }

    // Fields + accept + decline
    const itemCount = schemaFields.length + 2;
    const index = currentFieldIndex ?? (focusedButton === 'accept' ? schemaFields.length : focusedButton === 'decline' ? schemaFields.length + 1 : undefined);
    const nextIndex = index !== undefined ? (index + (direction === 'up' ? itemCount - 1 : 1)) % itemCount : 0;
    if (nextIndex < schemaFields.length) {
      setCurrentFieldIndex(nextIndex);
      setFocusedButton(null);
      syncTextInput(nextIndex);
    } else {
      setCurrentFieldIndex(undefined);
      setFocusedButton(nextIndex === schemaFields.length ? 'accept' : 'decline');
      setTextInputValue('');
    }
  }
  function setField(fieldName_0: string, value: number | string | boolean | string[] | undefined) {
    setFormValues(prev => {
      const next = {
        ...prev
      };
      if (value === undefined) {
        delete next[fieldName_0];
      } else {
        next[fieldName_0] = value;
      }
      return next;
    });
    // Clear "required" error when a value is provided
    if (value !== undefined && validationErrors[fieldName_0] === 'This field is required') {
      updateValidationError(fieldName_0);
    }
  }
  function updateValidationError(fieldName_1: string, error?: string) {
    setValidationErrors(prev_0 => {
      const next_0 = {
        ...prev_0
      };
      if (error) {
        next_0[fieldName_1] = error;
      } else {
        delete next_0[fieldName_1];
      }
      return next_0;
    });
  }
  function unsetField(fieldName_2: string) {
    if (!fieldName_2) return;
    setField(fieldName_2, undefined);
    updateValidationError(fieldName_2);
    setTextInputValue('');
    setTextInputCursorOffset(0);
  }
  function commitTextField(fieldName_3: string, schema_1: PrimitiveSchemaDefinition, value_0: string) {
    const trimmedValue = value_0.trim();

    // Empty input for non-plain-string types means unset
    if (trimmedValue === '' && (schema_1.type !== 'string' || 'format' in schema_1 && schema_1.format !== undefined)) {
      unsetField(fieldName_3);
      return;
    }
    if (trimmedValue === '') {
      // Empty plain string — keep or unset depending on whether it was set
      if (formValues[fieldName_3] !== undefined) {
        setField(fieldName_3, '');
      }
      return;
    }
    const validation_0 = validateElicitationInput(value_0, schema_1);
    setField(fieldName_3, validation_0.isValid ? validation_0.value : value_0);
    updateValidationError(fieldName_3, validation_0.isValid ? undefined : validation_0.error);
  }
  function resolveFieldAsync(fieldName_4: string, schema_2: PrimitiveSchemaDefinition, rawValue: string) {
    if (!signal) return;

    // Abort any existing resolution for this field
    const existing = resolveAbortRef.current.get(fieldName_4);
    if (existing) {
      existing.abort();
    }
    const controller_0 = new AbortController();
    resolveAbortRef.current.set(fieldName_4, controller_0);
    setResolvingFields(prev_1 => new Set(prev_1).add(fieldName_4));
    void validateElicitationInputAsync(rawValue, schema_2, controller_0.signal).then(result => {
      resolveAbortRef.current.delete(fieldName_4);
      setResolvingFields(prev_2 => {
        const next_1 = new Set(prev_2);
        next_1.delete(fieldName_4);
        return next_1;
      });
      if (controller_0.signal.aborted) return;
      if (result.isValid) {
        setField(fieldName_4, result.value);
        updateValidationError(fieldName_4);
        // Update the text input if we're still on this field
        const isoText = String(result.value);
        setTextInputValue(prev_3 => {
          // Only replace if the field is still showing the raw input
          if (prev_3 === rawValue) {
            setTextInputCursorOffset(isoText.length);
            return isoText;
          }
          return prev_3;
        });
      } else {
        // Keep raw text, show validation error
        updateValidationError(fieldName_4, result.error);
      }
    }, () => {
      resolveAbortRef.current.delete(fieldName_4);
      setResolvingFields(prev_4 => {
        const next_2 = new Set(prev_4);
        next_2.delete(fieldName_4);
        return next_2;
      });
    });
  }
  function handleTextInputChange(newValue: string) {
    setTextInputValue(newValue);
    // Commit immediately on each keystroke (sync validation)
    if (currentField) {
      commitTextField(currentField.name, currentField.schema, newValue);

      // For date/datetime fields, debounce async NL parsing after 2s of inactivity
      if (dateDebounceRef.current !== undefined) {
        clearTimeout(dateDebounceRef.current);
        dateDebounceRef.current = undefined;
      }
      if (isDateTimeSchema(currentField.schema) && newValue.trim() !== '' && validationErrors[currentField.name]) {
        const fieldName_5 = currentField.name;
        const schema_3 = currentField.schema;
        dateDebounceRef.current = setTimeout((dateDebounceRef_0, resolveFieldAsync_0, fieldName_6, schema_4, newValue_0) => {
          dateDebounceRef_0.current = undefined;
          resolveFieldAsync_0(fieldName_6, schema_4, newValue_0);
        }, 2000, dateDebounceRef, resolveFieldAsync, fieldName_5, schema_3, newValue);
      }
    }
  }
  function handleTextInputSubmit() {
    handleNavigation('down');
  }

  /**
   * Append a keystroke to the typeahead buffer (reset after 2s idle) and
   * call `onMatch` with the index of the first label that prefix-matches.
   * Shared by boolean y/n, enum accordion, and multi-select accordion.
   */
  function runTypeahead(char: string, labels: string[], onMatch: (index: number) => void) {
    const ta_0 = enumTypeaheadRef.current;
    if (ta_0.timer !== undefined) clearTimeout(ta_0.timer);
    ta_0.buffer += char.toLowerCase();
    ta_0.timer = setTimeout(resetTypeahead, 2000, ta_0);
    const match = labels.findIndex(l => l.startsWith(ta_0.buffer));
    if (match !== -1) onMatch(match);
  }

  // Esc while a field is focused: cancel the dialog.
  // Uses Settings context (escape-only, no 'n' key) since Dialog's
  // Confirmation-context cancel is suppressed when a field is focused.
  useKeybinding('confirm:no', () => {
    // For text fields, revert uncommitted changes first
    if (isEditingTextField && currentField) {
      const val_1 = formValues[currentField.name];
      setTextInputValue(val_1 !== undefined ? String(val_1) : '');
      setTextInputCursorOffset(0);
    }
    onResponse('cancel');
  }, {
    context: 'Settings',
    isActive: !!currentField && !focusedButton && !expandedAccordion
  });
  useInput((_input, key) => {
    // Text fields handle their own character input; we only intercept
    // navigation keys and backspace-on-empty here.
    if (isEditingTextField && !key.upArrow && !key.downArrow && !key.return && !key.backspace) {
      return;
    }

    // Expanded multi-select accordion
    if (expandedAccordion && currentField && isMultiSelectEnumSchema(currentField.schema)) {
      const msSchema = currentField.schema;
      const msValues = getMultiSelectValues(msSchema);
      const selected_0 = formValues[currentField.name] as string[] ?? [];
      if (key.leftArrow || key.escape) {
        setExpandedAccordion(undefined);
        validateMultiSelect(currentField.name, msSchema);
        return;
      }
      if (key.upArrow) {
        if (accordionOptionIndex === 0) {
          setExpandedAccordion(undefined);
          validateMultiSelect(currentField.name, msSchema);
        } else {
          setAccordionOptionIndex(accordionOptionIndex - 1);
        }
        return;
      }
      if (key.downArrow) {
        if (accordionOptionIndex >= msValues.length - 1) {
          setExpandedAccordion(undefined);
          handleNavigation('down');
        } else {
          setAccordionOptionIndex(accordionOptionIndex + 1);
        }
        return;
      }
      if (_input === ' ') {
        const optionValue = msValues[accordionOptionIndex];
        if (optionValue !== undefined) {
          const newSelected = selected_0.includes(optionValue) ? selected_0.filter(v => v !== optionValue) : [...selected_0, optionValue];
          const newValue_1 = newSelected.length > 0 ? newSelected : undefined;
          setField(currentField.name, newValue_1);
          const min_0 = msSchema.minItems;
          const max_0 = msSchema.maxItems;
          if (min_0 !== undefined && newSelected.length < min_0 && (newSelected.length > 0 || currentField.isRequired)) {
            updateValidationError(currentField.name, `Select at least ${min_0} ${plural(min_0, 'item')}`);
          } else if (max_0 !== undefined && newSelected.length > max_0) {
            updateValidationError(currentField.name, `Select at most ${max_0} ${plural(max_0, 'item')}`);
          } else {
            updateValidationError(currentField.name);
          }
        }
        return;
      }
      if (key.return) {
        // Check (not toggle) the focused item, then collapse and advance
        const optionValue_0 = msValues[accordionOptionIndex];
        if (optionValue_0 !== undefined && !selected_0.includes(optionValue_0)) {
          setField(currentField.name, [...selected_0, optionValue_0]);
        }
        setExpandedAccordion(undefined);
        handleNavigation('down');
        return;
      }
      if (_input) {
        const labels_0 = msValues.map(v_0 => getMultiSelectLabel(msSchema, v_0).toLowerCase());
        runTypeahead(_input, labels_0, setAccordionOptionIndex);
        return;
      }
      return;
    }

    // Expanded single-select enum accordion
    if (expandedAccordion && currentField && isEnumSchema(currentField.schema)) {
      const enumSchema = currentField.schema;
      const enumValues = getEnumValues(enumSchema);
      if (key.leftArrow || key.escape) {
        setExpandedAccordion(undefined);
        return;
      }
      if (key.upArrow) {
        if (accordionOptionIndex === 0) {
          setExpandedAccordion(undefined);
        } else {
          setAccordionOptionIndex(accordionOptionIndex - 1);
        }
        return;
      }
      if (key.downArrow) {
        if (accordionOptionIndex >= enumValues.length - 1) {
          setExpandedAccordion(undefined);
          handleNavigation('down');
        } else {
          setAccordionOptionIndex(accordionOptionIndex + 1);
        }
        return;
      }
      // Space: select and collapse
      if (_input === ' ') {
        const optionValue_1 = enumValues[accordionOptionIndex];
        if (optionValue_1 !== undefined) {
          setField(currentField.name, optionValue_1);
        }
        setExpandedAccordion(undefined);
        return;
      }
      // Enter: select, collapse, and move to next field
      if (key.return) {
        const optionValue_2 = enumValues[accordionOptionIndex];
        if (optionValue_2 !== undefined) {
          setField(currentField.name, optionValue_2);
        }
        setExpandedAccordion(undefined);
        handleNavigation('down');
        return;
      }
      if (_input) {
        const labels_1 = enumValues.map(v_1 => getEnumLabel(enumSchema, v_1).toLowerCase());
        runTypeahead(_input, labels_1, setAccordionOptionIndex);
        return;
      }
      return;
    }

    // Accept / Decline buttons
    if (key.return && focusedButton === 'accept') {
      if (validateRequired() && Object.keys(validationErrors).length === 0) {
        onResponse('accept', formValues);
      } else {
        // Show "required" validation errors on missing fields
        const requiredFields_0 = requestedSchema.required || [];
        for (const fieldName_7 of requiredFields_0) {
          if (formValues[fieldName_7] === undefined) {
            updateValidationError(fieldName_7, 'This field is required');
          }
        }
        const firstBadIndex = schemaFields.findIndex(f_0 => requiredFields_0.includes(f_0.name) && formValues[f_0.name] === undefined || validationErrors[f_0.name] !== undefined);
        if (firstBadIndex !== -1) {
          setCurrentFieldIndex(firstBadIndex);
          setFocusedButton(null);
          syncTextInput(firstBadIndex);
        }
      }
      return;
    }
    if (key.return && focusedButton === 'decline') {
      onResponse('decline');
      return;
    }

    // Up/Down navigation
    if (key.upArrow || key.downArrow) {
      // Reset enum typeahead when leaving a field
      const ta_1 = enumTypeaheadRef.current;
      ta_1.buffer = '';
      if (ta_1.timer !== undefined) {
        clearTimeout(ta_1.timer);
        ta_1.timer = undefined;
      }
      handleNavigation(key.upArrow ? 'up' : 'down');
      return;
    }

    // Left/Right to switch between Accept and Decline buttons
    if (focusedButton && (key.leftArrow || key.rightArrow)) {
      setFocusedButton(focusedButton === 'accept' ? 'decline' : 'accept');
      return;
    }
    if (!currentField) return;
    const {
      schema: schema_5,
      name: name_0
    } = currentField;
    const value_1 = formValues[name_0];

    // Boolean: Space to toggle, Enter to move on
    if (schema_5.type === 'boolean') {
      if (_input === ' ') {
        setField(name_0, value_1 === undefined ? true : !value_1);
        return;
      }
      if (key.return) {
        handleNavigation('down');
        return;
      }
      if (key.backspace && value_1 !== undefined) {
        unsetField(name_0);
        return;
      }
      // y/n typeahead
      if (_input && !key.return) {
        runTypeahead(_input, ['yes', 'no'], i => setField(name_0, i === 0));
        return;
      }
      return;
    }

    // Enum or multi-select (collapsed) — accordion style
    if (isEnumSchema(schema_5) || isMultiSelectEnumSchema(schema_5)) {
      if (key.return) {
        handleNavigation('down');
        return;
      }
      if (key.backspace && value_1 !== undefined) {
        unsetField(name_0);
        return;
      }
      // Compute option labels + initial focus index for rightArrow expand.
      // Single-select focuses on the current value; multi-select starts at 0.
      let labels_2: string[];
      let startIdx = 0;
      if (isEnumSchema(schema_5)) {
        const vals = getEnumValues(schema_5);
        labels_2 = vals.map(v_2 => getEnumLabel(schema_5, v_2).toLowerCase());
        if (value_1 !== undefined) {
          startIdx = Math.max(0, vals.indexOf(value_1 as string));
        }
      } else {
        const vals_0 = getMultiSelectValues(schema_5);
        labels_2 = vals_0.map(v_3 => getMultiSelectLabel(schema_5, v_3).toLowerCase());
      }
      if (key.rightArrow) {
        setExpandedAccordion(name_0);
        setAccordionOptionIndex(startIdx);
        return;
      }
      // Typeahead: expand and jump to matching option
      if (_input && !key.leftArrow) {
        runTypeahead(_input, labels_2, i_0 => {
          setExpandedAccordion(name_0);
          setAccordionOptionIndex(i_0);
        });
        return;
      }
      return;
    }

    // Backspace: text fields when empty
    if (key.backspace) {
      if (isEditingTextField && textInputValue === '') {
        unsetField(name_0);
        return;
      }
    }

    // Text field Enter is handled by TextInput's onSubmit
  }, {
    isActive: true
  });
  function validateRequired(): boolean {
    const requiredFields_1 = requestedSchema.required || [];
    for (const fieldName_8 of requiredFields_1) {
      const value_2 = formValues[fieldName_8];
      if (value_2 === undefined || value_2 === null || value_2 === '') {
        return false;
      }
      if (Array.isArray(value_2) && value_2.length === 0) {
        return false;
      }
    }
    return true;
  }

  // Scroll windowing: compute visible field range
  // Overhead: ~9 lines (dialog chrome, buttons, footer).
  // Each field: ~3 lines (label + description + validation spacer).
  // NOTE(v2): Multi-select accordion expands to N+3 lines when open.
  // For now we assume 3 lines per field; an expanded accordion may
  // temporarily push content off-screen (terminal scrollback handles it).
  // To generalize: track per-field height (3 for collapsed, N+3 for
  // expanded multi-select) and compute a pixel-budget window instead
  // of a simple item-count window.
  const LINES_PER_FIELD = 3;
  const DIALOG_OVERHEAD = 14;
  const maxVisibleFields = Math.max(2, Math.floor((rows - DIALOG_OVERHEAD) / LINES_PER_FIELD));
  const scrollWindow = useMemo(() => {
    const total = schemaFields.length;
    if (total <= maxVisibleFields) {
      return {
        start: 0,
        end: total
      };
    }
    // When buttons are focused (currentFieldIndex undefined), pin to end
    const focusIdx = currentFieldIndex ?? total - 1;
    let start = Math.max(0, focusIdx - Math.floor(maxVisibleFields / 2));
    const end = Math.min(start + maxVisibleFields, total);
    // Adjust start if we hit the bottom
    start = Math.max(0, end - maxVisibleFields);
    return {
      start,
      end
    };
  }, [schemaFields.length, maxVisibleFields, currentFieldIndex]);
  const hasFieldsAbove = scrollWindow.start > 0;
  const hasFieldsBelow = scrollWindow.end < schemaFields.length;
  function renderFormFields(): React.ReactNode {
    if (!schemaFields.length) return null;
    return <Box flexDirection="column">
        {hasFieldsAbove && <Box marginLeft={2}>
            <Text dimColor>
              {figures.arrowUp} {scrollWindow.start} more above
            </Text>
          </Box>}
        {schemaFields.slice(scrollWindow.start, scrollWindow.end).map((field_0, visibleIdx) => {
        const index_0 = scrollWindow.start + visibleIdx;
        const {
          name: name_1,
          schema: schema_6,
          isRequired
        } = field_0;
        const isActive = index_0 === currentFieldIndex && !focusedButton;
        const value_3 = formValues[name_1];
        const hasValue = value_3 !== undefined && (!Array.isArray(value_3) || value_3.length > 0);
        const error_0 = validationErrors[name_1];

        // Checkbox: spinner → ⚠ error → ✔ set → * required → space
        const isResolving = resolvingFields.has(name_1);
        const checkbox = isResolving ? <ResolvingSpinner /> : error_0 ? <Text color="error">{figures.warning}</Text> : hasValue ? <Text color="success" dimColor={!isActive}>
                {figures.tick}
              </Text> : isRequired ? <Text color="error">*</Text> : <Text> </Text>;

        // Selection color matches field status
        const selectionColor = error_0 ? 'error' : hasValue ? 'success' : isRequired ? 'error' : 'suggestion';
        const activeColor = isActive ? selectionColor : undefined;
        const label = <Text color={activeColor} bold={isActive}>
                {schema_6.title || name_1}
              </Text>;

        // Render the value portion based on field type
        let valueContent: React.ReactNode;
        let accordionContent: React.ReactNode = null;
        if (isMultiSelectEnumSchema(schema_6)) {
          const msValues_0 = getMultiSelectValues(schema_6);
          const selected_1 = value_3 as string[] | undefined ?? [];
          const isExpanded = expandedAccordion === name_1 && isActive;
          if (isExpanded) {
            valueContent = <Text dimColor>{figures.triangleDownSmall}</Text>;
            accordionContent = <Box flexDirection="column" marginLeft={6}>
                    {msValues_0.map((optVal, optIdx) => {
                const optLabel = getMultiSelectLabel(schema_6, optVal);
                const isChecked = selected_1.includes(optVal);
                const isFocused = optIdx === accordionOptionIndex;
                return <Box key={optVal} gap={1}>
                          <Text color="suggestion">
                            {isFocused ? figures.pointer : ' '}
                          </Text>
                          <Text color={isChecked ? 'success' : undefined}>
                            {isChecked ? figures.checkboxOn : figures.checkboxOff}
                          </Text>
                          <Text color={isFocused ? 'suggestion' : undefined} bold={isFocused}>
                            {optLabel}
                          </Text>
                        </Box>;
              })}
                  </Box>;
          } else {
            // Collapsed: ▸ arrow then comma-joined selected items
            const arrow = isActive ? <Text dimColor>{figures.triangleRightSmall} </Text> : null;
            if (selected_1.length > 0) {
              const displayLabels = selected_1.map(v_4 => getMultiSelectLabel(schema_6, v_4));
              valueContent = <Text>
                      {arrow}
                      <Text color={activeColor} bold={isActive}>
                        {displayLabels.join(', ')}
                      </Text>
                    </Text>;
            } else {
              valueContent = <Text>
                      {arrow}
                      <Text dimColor italic>
                        not set
                      </Text>
                    </Text>;
            }
          }
        } else if (isEnumSchema(schema_6)) {
          const enumValues_0 = getEnumValues(schema_6);
          const isExpanded_0 = expandedAccordion === name_1 && isActive;
          if (isExpanded_0) {
            valueContent = <Text dimColor>{figures.triangleDownSmall}</Text>;
            accordionContent = <Box flexDirection="column" marginLeft={6}>
                    {enumValues_0.map((optVal_0, optIdx_0) => {
                const optLabel_0 = getEnumLabel(schema_6, optVal_0);
                const isSelected = value_3 === optVal_0;
                const isFocused_0 = optIdx_0 === accordionOptionIndex;
                return <Box key={optVal_0} gap={1}>
                          <Text color="suggestion">
                            {isFocused_0 ? figures.pointer : ' '}
                          </Text>
                          <Text color={isSelected ? 'success' : undefined}>
                            {isSelected ? figures.radioOn : figures.radioOff}
                          </Text>
                          <Text color={isFocused_0 ? 'suggestion' : undefined} bold={isFocused_0}>
                            {optLabel_0}
                          </Text>
                        </Box>;
              })}
                  </Box>;
          } else {
            // Collapsed: ▸ arrow then current value
            const arrow_0 = isActive ? <Text dimColor>{figures.triangleRightSmall} </Text> : null;
            if (hasValue) {
              valueContent = <Text>
                      {arrow_0}
                      <Text color={activeColor} bold={isActive}>
                        {getEnumLabel(schema_6, value_3 as string)}
                      </Text>
                    </Text>;
            } else {
              valueContent = <Text>
                      {arrow_0}
                      <Text dimColor italic>
                        not set
                      </Text>
                    </Text>;
            }
          }
        } else if (schema_6.type === 'boolean') {
          if (isActive) {
            valueContent = hasValue ? <Text color={activeColor} bold>
                    {value_3 ? figures.checkboxOn : figures.checkboxOff}
                  </Text> : <Text dimColor>{figures.checkboxOff}</Text>;
          } else {
            valueContent = hasValue ? <Text>
                    {value_3 ? figures.checkboxOn : figures.checkboxOff}
                  </Text> : <Text dimColor italic>
                    not set
                  </Text>;
          }
        } else if (isTextField(schema_6)) {
          if (isActive) {
            valueContent = <TextInput value={textInputValue} onChange={handleTextInputChange} onSubmit={handleTextInputSubmit} placeholder={`Type something\u{2026}`} columns={Math.min(columns - 20, 60)} cursorOffset={textInputCursorOffset} onChangeCursorOffset={setTextInputCursorOffset} focus showCursor />;
          } else {
            const displayValue = hasValue && isDateTimeSchema(schema_6) ? formatDateDisplay(String(value_3), schema_6) : String(value_3);
            valueContent = hasValue ? <Text>{displayValue}</Text> : <Text dimColor italic>
                    not set
                  </Text>;
          }
        } else {
          valueContent = hasValue ? <Text>{String(value_3)}</Text> : <Text dimColor italic>
                  not set
                </Text>;
        }
        return <Box key={name_1} flexDirection="column">
                <Box gap={1}>
                  <Text color={selectionColor}>
                    {isActive ? figures.pointer : ' '}
                  </Text>
                  {checkbox}
                  <Box>
                    {label}
                    <Text color={activeColor}>: </Text>
                    {valueContent}
                  </Box>
                </Box>
                {accordionContent}
                {schema_6.description && <Box marginLeft={6}>
                    <Text dimColor>{schema_6.description}</Text>
                  </Box>}
                <Box marginLeft={6} height={1}>
                  {error_0 ? <Text color="error" italic>
                      {error_0}
                    </Text> : <Text> </Text>}
                </Box>
              </Box>;
      })}
        {hasFieldsBelow && <Box marginLeft={2}>
            <Text dimColor>
              {figures.arrowDown} {schemaFields.length - scrollWindow.end} more
              below
            </Text>
          </Box>}
      </Box>;
  }
  return <Dialog title={`MCP server \u201c${serverName}\u201d requests your input`} subtitle={`\n${message}`} color="permission" onCancel={() => onResponse('cancel')} isCancelActive={(!currentField || !!focusedButton) && !expandedAccordion} inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
            {currentField && <KeyboardShortcutHint shortcut="Backspace" action="unset" />}
            {currentField && currentField.schema.type === 'boolean' && <KeyboardShortcutHint shortcut="Space" action="toggle" />}
            {currentField && isEnumSchema(currentField.schema) && (expandedAccordion ? <KeyboardShortcutHint shortcut="Space" action="select" /> : <KeyboardShortcutHint shortcut="→" action="expand" />)}
            {currentField && isMultiSelectEnumSchema(currentField.schema) && (expandedAccordion ? <KeyboardShortcutHint shortcut="Space" action="toggle" /> : <KeyboardShortcutHint shortcut="→" action="expand" />)}
          </Byline>}>
      <Box flexDirection="column">
        {renderFormFields()}
        <Box>
          <Text color="success">
            {focusedButton === 'accept' ? figures.pointer : ' '}
          </Text>
          <Text bold={focusedButton === 'accept'} color={focusedButton === 'accept' ? 'success' : undefined} dimColor={focusedButton !== 'accept'}>
            {' Accept  '}
          </Text>
          <Text color="error">
            {focusedButton === 'decline' ? figures.pointer : ' '}
          </Text>
          <Text bold={focusedButton === 'decline'} color={focusedButton === 'decline' ? 'error' : undefined} dimColor={focusedButton !== 'decline'}>
            {' Decline'}
          </Text>
        </Box>
      </Box>
    </Dialog>;
}
function ElicitationURLDialog({
  event,
  onResponse,
  onWaitingDismiss
}: {
  event: ElicitationRequestEvent;
  onResponse: Props['onResponse'];
  onWaitingDismiss: Props['onWaitingDismiss'];
}): React.ReactNode {
  const {
    serverName,
    signal,
    waitingState
  } = event;
  const urlParams = event.params as ElicitRequestURLParams;
  const {
    message,
    url
  } = urlParams;
  const [phase, setPhase] = useState<'prompt' | 'waiting'>('prompt');
  const phaseRef = useRef<'prompt' | 'waiting'>('prompt');
  const [focusedButton, setFocusedButton] = useState<'accept' | 'decline' | 'open' | 'action' | 'cancel'>('accept');
  const showCancel = waitingState?.showCancel ?? false;
  useNotifyAfterTimeout('Claude Code needs your input', 'elicitation_url_dialog');
  useRegisterOverlay('elicitation-url');

  // Keep refs in sync for use in abort handler (avoids re-registering listener)
  phaseRef.current = phase;
  const onWaitingDismissRef = useRef(onWaitingDismiss);
  onWaitingDismissRef.current = onWaitingDismiss;
  useEffect(() => {
    const handleAbort = () => {
      if (phaseRef.current === 'waiting') {
        onWaitingDismissRef.current?.('cancel');
      } else {
        onResponse('cancel');
      }
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort);
    return () => signal.removeEventListener('abort', handleAbort);
  }, [signal, onResponse]);

  // Parse URL to highlight the domain
  let domain = '';
  let urlBeforeDomain = '';
  let urlAfterDomain = '';
  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
    const domainStart = url.indexOf(domain);
    urlBeforeDomain = url.slice(0, domainStart);
    urlAfterDomain = url.slice(domainStart + domain.length);
  } catch {
    domain = url;
  }

  // Auto-dismiss when the server sends a completion notification (sets completed flag)
  useEffect(() => {
    if (phase === 'waiting' && event.completed) {
      onWaitingDismiss?.(showCancel ? 'retry' : 'dismiss');
    }
  }, [phase, event.completed, onWaitingDismiss, showCancel]);
  const handleAccept = useCallback(() => {
    void openBrowser(url);
    onResponse('accept');
    setPhase('waiting');
    phaseRef.current = 'waiting';
    setFocusedButton('open');
  }, [onResponse, url]);

  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw input for button navigation
  useInput((_input, key) => {
    if (phase === 'prompt') {
      if (key.leftArrow || key.rightArrow) {
        setFocusedButton(prev => prev === 'accept' ? 'decline' : 'accept');
        return;
      }
      if (key.return) {
        if (focusedButton === 'accept') {
          handleAccept();
        } else {
          onResponse('decline');
        }
      }
    } else {
      // waiting phase — cycle through buttons
      type ButtonName = 'accept' | 'decline' | 'open' | 'action' | 'cancel';
      const waitingButtons: readonly ButtonName[] = showCancel ? ['open', 'action', 'cancel'] : ['open', 'action'];
      if (key.leftArrow || key.rightArrow) {
        setFocusedButton(prev_0 => {
          const idx = waitingButtons.indexOf(prev_0);
          const delta = key.rightArrow ? 1 : -1;
          return waitingButtons[(idx + delta + waitingButtons.length) % waitingButtons.length]!;
        });
        return;
      }
      if (key.return) {
        if (focusedButton === 'open') {
          void openBrowser(url);
        } else if (focusedButton === 'cancel') {
          onWaitingDismiss?.('cancel');
        } else {
          onWaitingDismiss?.(showCancel ? 'retry' : 'dismiss');
        }
      }
    }
  });
  if (phase === 'waiting') {
    const actionLabel = waitingState?.actionLabel ?? 'Continue without waiting';
    return <Dialog title={`MCP server \u201c${serverName}\u201d \u2014 waiting for completion`} subtitle={`\n${message}`} color="permission" onCancel={() => onWaitingDismiss?.('cancel')} isCancelActive inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
              <KeyboardShortcutHint shortcut="\u2190\u2192" action="switch" />
            </Byline>}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text>
              {urlBeforeDomain}
              <Text bold>{domain}</Text>
              {urlAfterDomain}
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text dimColor italic>
              Waiting for the server to confirm completion…
            </Text>
          </Box>
          <Box>
            <Text color="success">
              {focusedButton === 'open' ? figures.pointer : ' '}
            </Text>
            <Text bold={focusedButton === 'open'} color={focusedButton === 'open' ? 'success' : undefined} dimColor={focusedButton !== 'open'}>
              {' Reopen URL  '}
            </Text>
            <Text color="success">
              {focusedButton === 'action' ? figures.pointer : ' '}
            </Text>
            <Text bold={focusedButton === 'action'} color={focusedButton === 'action' ? 'success' : undefined} dimColor={focusedButton !== 'action'}>
              {` ${actionLabel}`}
            </Text>
            {showCancel && <>
                <Text> </Text>
                <Text color="error">
                  {focusedButton === 'cancel' ? figures.pointer : ' '}
                </Text>
                <Text bold={focusedButton === 'cancel'} color={focusedButton === 'cancel' ? 'error' : undefined} dimColor={focusedButton !== 'cancel'}>
                  {' Cancel'}
                </Text>
              </>}
          </Box>
        </Box>
      </Dialog>;
  }
  return <Dialog title={`MCP server \u201c${serverName}\u201d wants to open a URL`} subtitle={`\n${message}`} color="permission" onCancel={() => onResponse('cancel')} isCancelActive inputGuide={exitState_0 => exitState_0.pending ? <Text>Press {exitState_0.keyName} again to exit</Text> : <Byline>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            <KeyboardShortcutHint shortcut="\u2190\u2192" action="switch" />
          </Byline>}>
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text>
            {urlBeforeDomain}
            <Text bold>{domain}</Text>
            {urlAfterDomain}
          </Text>
        </Box>
        <Box>
          <Text color="success">
            {focusedButton === 'accept' ? figures.pointer : ' '}
          </Text>
          <Text bold={focusedButton === 'accept'} color={focusedButton === 'accept' ? 'success' : undefined} dimColor={focusedButton !== 'accept'}>
            {' Accept  '}
          </Text>
          <Text color="error">
            {focusedButton === 'decline' ? figures.pointer : ' '}
          </Text>
          <Text bold={focusedButton === 'decline'} color={focusedButton === 'decline' ? 'error' : undefined} dimColor={focusedButton !== 'decline'}>
            {' Decline'}
          </Text>
        </Box>
      </Box>
    </Dialog>;
}
