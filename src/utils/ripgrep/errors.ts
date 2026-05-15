export class RipgrepUnavailableError extends Error {
  code?: string | number

  constructor(
    message: string,
    public readonly config: { mode: string; command: string },
    code?: string | number,
  ) {
    super(message)
    this.name = 'RipgrepUnavailableError'
    this.code = code
  }
}
