import { expect, test } from 'bun:test'
import { parseFrontmatter } from './frontmatterParser.ts'

// The opening `---` was anchored but the closing one was not, and `[\s\S]*?` is
// lazy, so parsing stopped at the first `---` appearing anywhere -- including
// inside a value. Every .md frontmatter consumer is affected: agents, skills,
// slash commands, output styles and memory files all go through here.

test('does not end the block at a --- inside a quoted value', () => {
  const { frontmatter, content } = parseFrontmatter(
    '---\nname: r\ndescription: "Reviews code --- thoroughly"\n---\n\nBody.\n',
  )

  // Previously the block ended at the `---` inside the quotes: the description
  // was truncated, and the rest of the frontmatter plus the real delimiter
  // leaked into the body that is sent to the model.
  expect(frontmatter.description).toBe('Reviews code --- thoroughly')
  expect(frontmatter.name).toBe('r')
  expect(content).toBe('\nBody.\n')
  expect(content).not.toContain('---')
})

test('does not end the block at a --- line inside a block scalar', () => {
  const { frontmatter, content } = parseFrontmatter(
    '---\ndescription: |\n  step one\n  ---\n  step two\n---\nBody\n',
  )

  expect(frontmatter.description).toBe('step one\n---\nstep two\n')
  expect(content).toBe('Body\n')
})

test('does not leak the frontmatter tail into the body', () => {
  // Whether the YAML layer can make sense of an unquoted value containing
  // `---` is its own question; what must not happen is the delimiter being
  // found mid-value, which spilled the remaining frontmatter lines and a stray
  // `---` into the body.
  const { content } = parseFrontmatter(
    '---\nname: a\nsummary: uses --- as a separator\n---\nBody\n',
  )

  expect(content).toBe('Body\n')
})

test('parses the ordinary shapes exactly as before', () => {
  const simple = parseFrontmatter('---\nname: a\n---\nBody\n')
  expect(simple.frontmatter).toEqual({ name: 'a' })
  expect(simple.content).toBe('Body\n')

  const empty = parseFrontmatter('---\n---\nBody\n')
  expect(empty.frontmatter).toEqual({})
  expect(empty.content).toBe('Body\n')

  // Trailing spaces are allowed on either delimiter.
  const padded = parseFrontmatter('---   \nname: a\n---   \nBody\n')
  expect(padded.frontmatter).toEqual({ name: 'a' })
  expect(padded.content).toBe('Body\n')

  // Frontmatter that ends at EOF with no trailing newline.
  const atEof = parseFrontmatter('---\nname: a\n---')
  expect(atEof.frontmatter).toEqual({ name: 'a' })
  expect(atEof.content).toBe('')
})

test('leaves a file without frontmatter untouched', () => {
  const markdown = 'Just a body.\n\nWith a --- rule in it.\n'
  const { frontmatter, content } = parseFrontmatter(markdown)

  expect(frontmatter).toEqual({})
  expect(content).toBe(markdown)
})

test('does not treat a body horizontal rule as frontmatter', () => {
  // The document does not open with a delimiter, so nothing is consumed even
  // though `---` lines appear later.
  const markdown = '# Title\n\n---\n\nSection\n\n---\n'
  expect(parseFrontmatter(markdown).content).toBe(markdown)
})
