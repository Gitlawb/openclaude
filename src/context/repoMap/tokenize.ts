import { getEncoding, type Tiktoken } from 'js-tiktoken'

let encoder: Tiktoken | null = null

function getEncoder() {
  if (!encoder) {
    encoder = getEncoding('cl100k_base')
  }
  return encoder
}

/** Count the number of tokens in a string using cl100k_base encoding. */
export function countTokens(text: string): number {
  return getEncoder().encode(text).length
}
