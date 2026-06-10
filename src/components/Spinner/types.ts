export type SpinnerMode =
  | 'requesting'
  | 'responding'
  | 'thinking'
  | 'tool-use'
  | 'tool-input'
  | string & {}

export interface RGBColor {
  r: number
  g: number
  b: number
}
