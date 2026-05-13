const ESC = '\x1b['

export const ANSI_RESET = `${ESC}0m`
export const ANSI_DIM = `${ESC}2m`

export function ansiRgb(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`
}
