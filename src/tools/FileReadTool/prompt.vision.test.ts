import { describe, expect, test } from 'bun:test'

import { renderPromptTemplate } from './prompt.js'

describe('renderPromptTemplate — vision sentence (issue #1421)', () => {
  test('includes the image-reading sentence when the active model supports vision (default Claude)', () => {
    const rendered = renderPromptTemplate(
      '- Results are returned using cat -n format, with line numbers starting at 1',
      '',
      '',
    )

    expect(rendered).toContain('This tool allows Claude Code to read images')
  })

  test('always includes the Jupyter notebook sentence and the directory-listing hint', () => {
    const rendered = renderPromptTemplate(
      '- Results are returned using cat -n format, with line numbers starting at 1',
      '',
      '',
    )

    expect(rendered).toContain('Jupyter notebooks')
    expect(rendered).toContain('not directories')
  })
})