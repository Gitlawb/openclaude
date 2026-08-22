import * as React from 'react'
import { useCallback, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'

type SingleSelectQuestion = {
  type: 'single-select'
  label: string
  options: string[]
}

type MultiSelectQuestion = {
  type: 'multi-select'
  label: string
  options: string[]
}

type TextInputQuestion = {
  type: 'text-input'
  label: string
  placeholder: string
}

type Question = SingleSelectQuestion | MultiSelectQuestion | TextInputQuestion

const DEFAULT_QUESTIONS: Question[] = [
  {
    type: 'single-select',
    label: 'Task Type',
    options: [
      'Implement feature',
      'Fix bug',
      'Refactor',
      'Review code',
      'Research/explore',
      'Other',
    ],
  },
  {
    type: 'single-select',
    label: 'Approach',
    options: [
      'Code only',
      'Code + explanation',
      'Plan first then code',
      'Ask me as you go',
    ],
  },
  {
    type: 'multi-select',
    label: 'Constraints',
    options: [
      'Keep changes minimal',
      'No new dependencies',
      'Tests required',
      'Follow existing patterns',
      'Performance critical',
    ],
  },
  {
    type: 'text-input',
    label: 'Additional context',
    placeholder: 'Type any extra context here...',
  },
]

type Answers = Record<number, string | string[]>

type Props = {
  onSubmit: (formatted: string) => void
  onCancel: () => void
  questions?: Question[]
}

function formatAnswers(questions: Question[], answers: Answers): string {
  const lines: string[] = ['## Steering']
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!
    const answer = answers[i]
    if (!answer || (Array.isArray(answer) && answer.length === 0)) continue
    if (Array.isArray(answer)) {
      lines.push(`- **${q.label}**: ${answer.join(', ')}`)
    } else if (typeof answer === 'string' && answer.trim()) {
      lines.push(`- **${q.label}**: ${answer}`)
    }
  }
  return lines.join('\n')
}

function SingleSelectTab({
  question,
  value,
  onChange,
  focusIndex,
  onFocusChange,
}: {
  question: SingleSelectQuestion
  value: string | undefined
  onChange: (val: string) => void
  focusIndex: number
  onFocusChange: (idx: number) => void
}) {
  useInput((input, key) => {
    if (key.upArrow) {
      onFocusChange(
        focusIndex <= 0 ? question.options.length - 1 : focusIndex - 1,
      )
    } else if (key.downArrow) {
      onFocusChange(
        focusIndex >= question.options.length - 1 ? 0 : focusIndex + 1,
      )
    } else if (key.return) {
      onChange(question.options[focusIndex]!)
    }
  })

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>{question.label}</Text>
      <Box marginTop={1} flexDirection="column">
        {question.options.map((opt, i) => {
          const selected = value === opt
          const focused = focusIndex === i
          return (
            <Text key={opt}>
              {focused ? '> ' : '  '}
              {selected ? '[x] ' : '[ ] '}
              {opt}
            </Text>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Up/Down to navigate, Enter to select</Text>
      </Box>
    </Box>
  )
}

function MultiSelectTab({
  question,
  value,
  onChange,
  focusIndex,
  onFocusChange,
}: {
  question: MultiSelectQuestion
  value: string[]
  onChange: (val: string[]) => void
  focusIndex: number
  onFocusChange: (idx: number) => void
}) {
  useInput((input, key) => {
    if (key.upArrow) {
      onFocusChange(
        focusIndex <= 0 ? question.options.length - 1 : focusIndex - 1,
      )
    } else if (key.downArrow) {
      onFocusChange(
        focusIndex >= question.options.length - 1 ? 0 : focusIndex + 1,
      )
    } else if (key.return) {
      const opt = question.options[focusIndex]!
      if (value.includes(opt)) {
        onChange(value.filter(v => v !== opt))
      } else {
        onChange([...value, opt])
      }
    }
  })

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>{question.label}</Text>
      <Box marginTop={1} flexDirection="column">
        {question.options.map((opt, i) => {
          const selected = value.includes(opt)
          const focused = focusIndex === i
          return (
            <Text key={opt}>
              {focused ? '> ' : '  '}
              {selected ? '[x] ' : '[ ] '}
              {opt}
            </Text>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Up/Down to navigate, Enter to toggle</Text>
      </Box>
    </Box>
  )
}

function TextInputTab({
  question,
  value,
  onChange,
}: {
  question: TextInputQuestion
  value: string
  onChange: (val: string) => void
}) {
  useInput((input, key) => {
    if (key.backspace) {
      onChange(value.slice(0, -1))
    } else if (
      !key.return &&
      !key.escape &&
      !key.tab &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow &&
      !key.ctrl &&
      !key.meta &&
      input.length > 0
    ) {
      onChange(value + input)
    }
  })

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>{question.label}</Text>
      <Box marginTop={1}>
        <Text>
          {value ? value : <Text dimColor>{question.placeholder}</Text>}
          <Text inverse> </Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Type your text, Backspace to delete</Text>
      </Box>
    </Box>
  )
}

function ReviewTab({
  questions,
  answers,
}: {
  questions: Question[]
  answers: Answers
}) {
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>Review your answers</Text>
      <Box marginTop={1} flexDirection="column">
        {questions.map((q, i) => {
          const answer = answers[i]
          let display = ''
          if (Array.isArray(answer)) {
            display = answer.length > 0 ? answer.join(', ') : '(none)'
          } else if (typeof answer === 'string' && answer.trim()) {
            display = answer
          } else {
            display = '(none)'
          }
          return (
            <Text key={q.label}>
              <Text bold>{q.label}:</Text> {display}
            </Text>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter to submit, Escape to cancel</Text>
      </Box>
    </Box>
  )
}

export function SteeringQuestionsOverlay({
  onSubmit,
  onCancel,
  questions = DEFAULT_QUESTIONS,
}: Props): React.ReactNode {
  const totalTabs = questions.length + 1 // +1 for review tab
  const [activeTab, setActiveTab] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [focusIndices, setFocusIndices] = useState<Record<number, number>>({})

  const handleTabNav = useCallback(
    (direction: 'left' | 'right') => {
      setActiveTab(prev => {
        if (direction === 'left') return prev <= 0 ? totalTabs - 1 : prev - 1
        return prev >= totalTabs - 1 ? 0 : prev + 1
      })
    },
    [totalTabs],
  )

  const isReviewTab = activeTab === questions.length

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.tab) {
      handleTabNav('right')
      return
    }
    // Arrow left/right navigate tabs (except on text input tabs)
    if (isReviewTab || questions[activeTab]?.type !== 'text-input') {
      if (key.leftArrow) {
        handleTabNav('left')
        return
      }
      if (key.rightArrow) {
        handleTabNav('right')
        return
      }
    }
    // Submit on review tab
    if (isReviewTab && key.return) {
      onSubmit(formatAnswers(questions, answers))
    }
  })

  const renderTabHeaders = () => {
    const labels = [...questions.map(q => q.label), 'Review']
    return (
      <Box gap={1}>
        {labels.map((label, i) => (
          <Text
            key={label}
            bold={activeTab === i}
            underline={activeTab === i}
            dimColor={activeTab !== i}
          >
            {label}
          </Text>
        ))}
      </Box>
    )
  }

  const renderContent = () => {
    if (isReviewTab) {
      return <ReviewTab questions={questions} answers={answers} />
    }

    const question = questions[activeTab]!
    const focusIndex = focusIndices[activeTab] ?? 0
    const setFocusIndex = (idx: number) =>
      setFocusIndices(prev => ({ ...prev, [activeTab]: idx }))

    switch (question.type) {
      case 'single-select':
        return (
          <SingleSelectTab
            question={question}
            value={answers[activeTab] as string | undefined}
            onChange={val => setAnswers(prev => ({ ...prev, [activeTab]: val }))}
            focusIndex={focusIndex}
            onFocusChange={setFocusIndex}
          />
        )
      case 'multi-select':
        return (
          <MultiSelectTab
            question={question}
            value={(answers[activeTab] as string[] | undefined) ?? []}
            onChange={val => setAnswers(prev => ({ ...prev, [activeTab]: val }))}
            focusIndex={focusIndex}
            onFocusChange={setFocusIndex}
          />
        )
      case 'text-input':
        return (
          <TextInputTab
            question={question}
            value={(answers[activeTab] as string | undefined) ?? ''}
            onChange={val => setAnswers(prev => ({ ...prev, [activeTab]: val }))}
          />
        )
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Steering Questions
        </Text>
        <Text dimColor> (Tab/arrows to switch, Esc to cancel)</Text>
      </Box>
      {renderTabHeaders()}
      <Box marginTop={1}>{renderContent()}</Box>
    </Box>
  )
}
