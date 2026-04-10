import 'react'

type InkIntrinsicProps = Record<string, unknown>

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': InkIntrinsicProps
      'ink-link': InkIntrinsicProps
      'ink-raw-ansi': InkIntrinsicProps
      'ink-root': InkIntrinsicProps
      'ink-text': InkIntrinsicProps
      'ink-virtual-text': InkIntrinsicProps
    }
  }
}

export {}
