declare module 'asciichart' {
  export type PlotConfig = {
    height?: number;
    colors?: Array<number | string>;
    format?: (value: number) => string;
  };

  export function plot(
    series: number[] | number[][],
    config?: PlotConfig,
  ): string;
}
