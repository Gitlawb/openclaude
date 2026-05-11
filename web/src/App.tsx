import { useEffect, useState } from 'react'
import './styles.css'
import { features, installCommand, navLinks } from './content'

type Theme = 'light' | 'dark'

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const attr = document.documentElement.dataset.theme
  if (attr === 'light' || attr === 'dark') return attr
  return 'light'
}

function App() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      localStorage.setItem('openclaude-theme', theme)
    } catch {
      /* storage unavailable */
    }
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return (
    <div className="site-shell">
      <header className="site-header">
        <nav className="nav" aria-label="primary">
          <a className="brand" href="/" aria-label="openclaude home">
            <img src="/openclaude.png" alt="" />
            <span>openclaude</span>
            <span className="ver">v0.7</span>
          </a>
          <div className="nav-right">
            <div className="nav-links">
              {navLinks.map(l => (
                <a key={l.href} href={l.href}>{l.label}</a>
              ))}
            </div>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </nav>
        <div className="nav-rule" aria-hidden="true" />
      </header>

      <main className="shell-main">
        <Hero />

        <section id="features" className="features" aria-labelledby="features-heading">
          <div className="section-head">
            <p className="eyebrow">// features</p>
            <h2 id="features-heading">built for agents that ship code.</h2>
          </div>
          <ul className="feature-list">
            {features.map(f => (
              <li key={f.title} className="feature-row">
                <h3>{f.title}</h3>
                <p>— {f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="install" className="install-block" aria-labelledby="install-heading">
          <div className="section-head">
            <p className="eyebrow">// install</p>
            <h2 id="install-heading">one line. then write a task.</h2>
          </div>
          <div className="install-grid">
            <CopyableCommand command={installCommand} />
            <ol className="install-steps">
              <li>
                <span className="step-num">01</span>
                <div>
                  <strong>install</strong>
                  <p>requires node ≥ 20.</p>
                </div>
              </li>
              <li>
                <span className="step-num">02</span>
                <div>
                  <strong>start</strong>
                  <p>run <code>openclaude</code> in any repo.</p>
                </div>
              </li>
              <li>
                <span className="step-num">03</span>
                <div>
                  <strong>pick a provider</strong>
                  <p>type <code>/provider</code> to wire openai, ollama, gemini, or a gateway.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-line">
          <span className="brand">
            <img src="/openclaude.png" alt="" />
            <span>openclaude</span>
            <span className="ver">v0.7.0</span>
          </span>
          <span className="sep">|</span>
          <a href="https://gitlawb.com">gitlawb ↗</a>
          <span className="sep">|</span>
          <a href="https://github.com/Gitlawb/openclaude/blob/main/LICENSE">license</a>
          <span className="sep">·</span>
          <span>{new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  )
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero-eyebrow">
        <span className="dot" aria-hidden="true" />
        open source · gitlawb-aligned · model-neutral
      </div>

      <h1 id="hero-heading" className="hero-title">
        runs anywhere.<br />
        uses anything.
      </h1>

      <p className="hero-sub">
        not a chatbot wrapper or another ide plugin. an open coding agent that runs in your
        terminal, talks to any model, and keeps every change reviewable.
      </p>

      <div className="hero-cta">
        <CopyableCommand command={installCommand} variant="hero" />
        <a className="button button-ghost" href="https://github.com/Gitlawb/openclaude">
          view on github →
        </a>
      </div>

      <p className="hero-foot">
        works with openai, gemini, codex, ollama, lm studio, litellm, and 200+ models.
      </p>
    </section>
  )
}

function CopyableCommand({
  command,
  variant,
}: {
  command: string
  variant?: 'hero'
}) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className={['copy-cmd', variant === 'hero' ? 'copy-cmd-hero' : ''].filter(Boolean).join(' ')}
      aria-label={`copy install command: ${command}`}
    >
      <span className="copy-prefix">$</span>
      <span className="copy-text">{command}</span>
      <span className="copy-icon" aria-hidden="true">
        {copied ? '✓ copied' : 'copy'}
      </span>
    </button>
  )
}

export default App
