import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { getAllowedChannels, getQuestionPreviewFormat } from 'src/bootstrap/state.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { getModeColor } from 'src/utils/permissions/PermissionMode.js';
import { z } from 'zod/v4';
import { Box, Text } from '../../ink.js';
import type { Tool } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { ASK_USER_QUESTION_TOOL_CHIP_WIDTH, ASK_USER_QUESTION_TOOL_NAME, ASK_USER_QUESTION_TOOL_PROMPT, DESCRIPTION, PREVIEW_FEATURE_PROMPT } from './prompt.js';
const questionOptionSchema = lazySchema(() => z.object({
  label: z.string().describe('The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.'),
  description: z.string().describe('Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.'),
  preview: z.string().optional().describe('Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.')
}));
const questionSchema = lazySchema(() => z.object({
  question: z.string().describe('The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"'),
  header: z.string().describe(`Very short label displayed as a chip/tag (max ${ASK_USER_QUESTION_TOOL_CHIP_WIDTH} chars). Examples: "Auth method", "Library", "Approach".`),
  options: z.array(questionOptionSchema()).min(2).max(4).describe(`The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.`),
  multiSelect: z.boolean().default(false).describe('Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.')
}));
const annotationsSchema = lazySchema(() => {
  const annotationSchema = z.object({
    preview: z.string().optional().describe('The preview content of the selected option, if the question used previews.'),
    notes: z.string().optional().describe('Free-text notes the user added to their selection.')
  });
  return z.record(z.string(), annotationSchema).optional().describe('Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text.');
});
const UNIQUENESS_REFINE = {
  check: (data: {
    questions: {
      question: string;
      options: {
        label: string;
      }[];
    }[];
  }) => {
    const questions = data.questions.map(q => q.question);
    if (questions.length !== new Set(questions).size) {
      return false;
    }
    for (const question of data.questions) {
      const labels = question.options.map(opt => opt.label);
      if (labels.length !== new Set(labels).size) {
        return false;
      }
    }
    return true;
  },
  message: 'Question texts must be unique, option labels must be unique within each question'
} as const;
const commonFields = lazySchema(() => ({
  answers: z.record(z.string(), z.string()).optional().describe('User answers collected by the permission component'),
  annotations: annotationsSchema(),
  metadata: z.object({
    source: z.string().optional().describe('Optional identifier for the source of this question (e.g., "remember" for /remember command). Used for analytics tracking.')
  }).optional().describe('Optional metadata for tracking and analytics purposes. Not displayed to user.')
}));
const inputSchema = lazySchema(() => z.strictObject({
  questions: z.array(questionSchema()).min(1).max(4).describe('Questions to ask the user (1-4 questions)'),
  ...commonFields()
}).refine(UNIQUENESS_REFINE.check, {
  message: UNIQUENESS_REFINE.message
}));
type InputSchema = ReturnType<typeof inputSchema>;
const outputSchema = lazySchema(() => z.object({
  questions: z.array(questionSchema()).describe('The questions that were asked'),
  answers: z.record(z.string(), z.string()).describe('The answers provided by the user (question text -> answer string; multi-select answers are comma-separated)'),
  annotations: annotationsSchema()
}));
type OutputSchema = ReturnType<typeof outputSchema>;

// SDK schemas are identical to internal schemas now that `preview` and
// `annotations` are public (configurable via `toolConfig.askUserQuestion`).
export const _sdkInputSchema = inputSchema;
export const _sdkOutputSchema = outputSchema;
export type Question = z.infer<ReturnType<typeof questionSchema>>;
export type QuestionOption = z.infer<ReturnType<typeof questionOptionSchema>>;
export type Output = z.infer<OutputSchema>;
function AskUserQuestionResultMessage(t0) {
  const $ = _c(3);
  const {
    answers
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="row"><Text color={getModeColor("default")}>{BLACK_CIRCLE} </Text><Text>User answered Claude's questions:</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== answers) {
    t2 = <Box flexDirection="column" marginTop={1}>{t1}<MessageResponse><Box flexDirection="column">{Object.entries(answers).map(_temp)}</Box></MessageResponse></Box>;
    $[1] = answers;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
}
function _temp(t0) {
  const [questionText, answer] = t0;
  return <Text key={questionText} color="inactive">· {questionText} → {answer}</Text>;
}
export const AskUserQuestionTool: Tool<InputSchema, Output> = buildTool({
  name: ASK_USER_QUESTION_TOOL_NAME,
  searchHint: 'prompt the user with a multiple-choice question',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return DESCRIPTION;
  },
  async prompt() {
    const format = getQuestionPreviewFormat();
    if (format === undefined) {
      // SDK consumer that hasn't opted into a preview format — omit preview
      // guidance (they may not render the field at all).
      return ASK_USER_QUESTION_TOOL_PROMPT;
    }
    return ASK_USER_QUESTION_TOOL_PROMPT + PREVIEW_FEATURE_PROMPT[format];
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return '';
  },
  isEnabled() {
    // When --channels is active the user is likely on Telegram/Discord, not
    // watching the TUI. The multiple-choice dialog would hang with nobody at
    // the keyboard. Channel permission relay already skips
    // requiresUserInteraction() tools (interactiveHandler.ts) so there's
    // no alternate approval path.
    if ((false || false) && getAllowedChannels().length > 0) {
      return false;
    }
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.questions.map(q => q.question).join(' | ');
  },
  requiresUserInteraction() {
    return true;
  },
  async validateInput({
    questions
  }) {
    if (getQuestionPreviewFormat() !== 'html') {
      return {
        result: true
      };
    }
    for (const q of questions) {
      for (const opt of q.options) {
        const err = validateHtmlPreview(opt.preview);
        if (err) {
          return {
            result: false,
            message: `Option "${opt.label}" in question "${q.question}": ${err}`,
            errorCode: 1
          };
        }
      }
    }
    return {
      result: true
    };
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      message: 'Answer questions?',
      updatedInput: input
    };
  },
  renderToolUseMessage() {
    return null;
  },
  renderToolUseProgressMessage() {
    return null;
  },
  renderToolResultMessage({
    answers
  }, _toolUseID) {
    return <AskUserQuestionResultMessage answers={answers} />;
  },
  renderToolUseRejectedMessage() {
    return <Box flexDirection="row" marginTop={1}>
        <Text color={getModeColor('default')}>{BLACK_CIRCLE}&nbsp;</Text>
        <Text>User declined to answer questions</Text>
      </Box>;
  },
  renderToolUseErrorMessage() {
    return null;
  },
  async call({
    questions,
    answers = {},
    annotations
  }, _context) {
    return {
      data: {
        questions,
        answers,
        ...(annotations && {
          annotations
        })
      }
    };
  },
  mapToolResultToToolResultBlockParam({
    answers,
    annotations
  }, toolUseID) {
    const answersText = Object.entries(answers).map(([questionText, answer]) => {
      const annotation = annotations?.[questionText];
      const parts = [`"${questionText}"="${answer}"`];
      if (annotation?.preview) {
        parts.push(`selected preview:\n${annotation.preview}`);
      }
      if (annotation?.notes) {
        parts.push(`user notes: ${annotation.notes}`);
      }
      return parts.join(' ');
    }).join(', ');
    return {
      type: 'tool_result',
      content: `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`,
      tool_use_id: toolUseID
    };
  }
} satisfies ToolDef<InputSchema, Output>);

// Lightweight HTML fragment check. Not a parser — HTML5 parsers are
// error-recovering by spec and accept anything. We're checking model intent
// (did it emit HTML?) and catching the specific things we told it not to do.
function validateHtmlPreview(preview: string | undefined): string | null {
  if (preview === undefined) return null;
  if (/<\s*(html|body|!doctype)\b/i.test(preview)) {
    return 'preview must be an HTML fragment, not a full document (no <html>, <body>, or <!DOCTYPE>)';
  }
  // SDK consumers typically set this via innerHTML — disallow executable/style
  // tags so a preview can't run code or restyle the host page. Inline event
  // handlers (onclick etc.) are still possible; consumers should sanitize.
  if (/<\s*(script|style)\b/i.test(preview)) {
    return 'preview must not contain <script> or <style> tags. Use inline styles via the style attribute if needed.';
  }
  if (!/<[a-z][^>]*>/i.test(preview)) {
    return 'preview must contain HTML (previewFormat is set to "html"). Wrap content in a tag like <div> or <pre>.';
  }
  return null;
}
