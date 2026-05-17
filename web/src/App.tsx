import { useEffect, useState, useRef } from 'react'
import './styles.css'

type Message = {
  role: 'user' | 'assistant'
  text: string
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'thinking'>('idle')
  const [activeModel, setActiveModel] = useState('...')
  const [version, setVersion] = useState('')
  const [connected, setConnected] = useState(false)
  const ws = useRef<WebSocket | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or thinking status
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, status])

  useEffect(() => {
    console.log('🚀 Connecting to OpenClaude...')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}`)
    
    socket.onopen = () => {
      console.log('✅ WebSocket Connected')
      setConnected(true)
    }

    socket.onmessage = (event) => {
      console.log('📨 Received message:', event.data)
      const msg = JSON.parse(event.data)
      if (msg.type === 'init') {
        setActiveModel(msg.model)
        setVersion(msg.version)
        socket.send(JSON.stringify({ type: 'ready' }))
        console.log('✨ Model initialized:', msg.model)
      } else if (msg.type === 'stream_event') {
        const delta = msg.event?.delta?.text
        if (delta) {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, text: last.text + delta }]
            }
            return [...prev, { role: 'assistant', text: delta }]
          })
        }
      } else if (msg.type === 'done') {
        setStatus('idle')
      }
    }

    ws.current = socket
    return () => socket.close()
  }, [])

  const sendMessage = () => {
    if (!input.trim() || !ws.current) return
    
    const newMsg: Message = { role: 'user', text: input }
    setMessages(prev => [...prev, newMsg])
    ws.current.send(JSON.stringify({ type: 'chat', message: input, model: activeModel }))
    
    setInput('')
    setStatus('thinking')
  }

  return (
    <div className="web-console">
      <aside className="sidebar">
        <div className="sidebar-header">
           <span className="logo-dot"></span>
           <h1>OpenClaude</h1>
        </div>
        <nav className="sessions">
           <div className="session-item active">Current Session</div>
        </nav>
        <div className="sidebar-footer">
          <div className="status-badge">
             <span className={`pulse ${connected ? 'connected' : 'disconnected'}`}></span>
             {connected ? 'CONNECTED' : 'OFFLINE'}
          </div>
          <div className="status-badge" style={{ marginTop: '10px' }}>
             <span className={`pulse ${status}`}></span>
             {status.toUpperCase()}
          </div>
        </div>
      </aside>

      <main className="chat-area">
        <header className="chat-header">
           <h2>Agent CLI</h2>
           <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
             {!connected && <span className="model-tag" style={{ background: '#ff4444', color: 'white' }}>DISCONNECTED</span>}
             <span className="model-tag">{activeModel.toUpperCase()}</span>
           </div>
        </header>

        <div className="message-list" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="welcome-screen">
              <pre className="ascii-logo">
{`████████╗ ████████╗ ████████╗ ██╗  ██╗
██╔════██║ ██╔════██║ ██╔═════╝ ████╗ ██║
██║   ██║ ████████║ ██████╗   ██████║
██║   ██║ ██╔═════╝ ██╔═══╝   ██╔████║
████████║ ██║       ████████╗ ██║ ╚███║
╚═══════╝ ╚═╝       ╚═══════╝ ╚═╝  ╚══╝

████████╗ ██╗      ████████╗ ██╗   ██╗ ████████╗  ████████╗
██╔═════╝ ██║      ██╔════██║ ██║   ██║ ██╔════██╗ ██╔═════╝
██║       ██║      ████████║ ██║   ██║ ██║   ██║ ██████╗  
██║       ██║      ██╔════██║ ██║   ██║ ██║   ██║ ██╔═══╝  
████████╗ ████████╗██║   ██║ ╚██████╔╝ ██████╔╝ ████████╗
╚═══════╝ ╚═══════╝╚═╝   ╚═╝  ╚═════╝  ╚═════╝  ╚═══════╝`}
              </pre>
              <div className="slogan">
                <span>✦</span> Any model. Every tool. Zero limits. <span>✦</span>
              </div>
              <div className="version-info">
                openclaude <span className="version-tag">v{version}</span>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`message-row ${m.role}`}>
              <div className="message-bubble">
                <pre>{m.text}</pre>
              </div>
            </div>
          ))}
        </div>

        <footer className="input-area">
          <div className="input-container">
            <textarea 
              placeholder="Message OpenClaude..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
            />
            <button className="send-btn" onClick={sendMessage} disabled={status === 'thinking'}>
              {status === 'thinking' ? '...' : '↑'}
            </button>
          </div>
        </footer>
      </main>
    </div>
  )
}

export default App
