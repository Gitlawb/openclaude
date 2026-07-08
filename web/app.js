const WS_URL = `ws://${location.host}`
let ws = null
let sessionId = ''
let isGenerating = false
let currentAssistantEl = null
let thinkingIndicatorEl = null
let pendingToolCalls = []  // Buffered tool_use_display events, rendered when tool_result arrives
let pendingPrompts = new Map()
let currentModel = ''  // Model name from settings
let currentToolContainer = null  // .tool-calls-container for live tool calls
let currentToolList = null       // .tool-calls-list inside the container

// API error retry
const MAX_RETRIES = 3
const RETRY_DELAY = 2000
let lastChatMessage = null
let retryCount = 0

const chatContainer = document.getElementById('chatContainer')
const messageInput = document.getElementById('messageInput')
const sendBtn = document.getElementById('sendBtn')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')

// Theme management
function getTheme() {
  return localStorage.getItem('openclaude-theme') || 'light'
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('openclaude-theme', theme)
  const btn = document.getElementById('themeToggle')
}

function toggleTheme() {
  const current = getTheme()
  const next = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
}

// Auto-approve toggle
function toggleAutoApprove(enabled) {
  localStorage.setItem('autoApprove', enabled ? '1' : '0')
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'set_permission_mode',
      mode: enabled ? 'auto_approve' : 'ask',
    }))
  }
}

// Toggle tool calls expansion
function toggleToolCalls(button) {
  const container = button.closest('.tool-calls-container')
  if (container) {
    container.classList.toggle('expanded')
    button.classList.toggle('expanded')
  }
}

// Format tool call display with colored diff lines
function formatDiffLine(line, cssClass) {
  // line = "- 5: content" or "- content" or "+ 5: content" or "+ content"
  const prefix = line.slice(0, 2)  // "- " or "+ "
  const rest = line.slice(2)
  // Parse line number: "5: actual content" or just "actual content"
  const match = rest.match(/^(\d+):\s(.*)$/)
  if (match) {
    const lineNum = match[1]
    const text = match[2]
    return `<span class="${cssClass}"><span class="diff-prefix">${escapeHtml(prefix)}</span><span class="diff-line-num">${lineNum}</span>${escapeHtml(text)}</span>`
  }
  return `<span class="${cssClass}"><span class="diff-prefix">${escapeHtml(prefix)}</span>${escapeHtml(rest)}</span>`
}

function formatToolCallDisplay(display) {
  const displayLines = display.split('\n')
  const firstLine = displayLines[0]
  const restLines = displayLines.slice(1)

  let html = `<span class="tool-header">&#9679; ${escapeHtml(firstLine)}</span>`

  for (const line of restLines) {
    if (line.startsWith('- ')) {
      html += formatDiffLine(line, 'diff-line-minus')
    } else if (line.startsWith('+ ')) {
      html += formatDiffLine(line, 'diff-line-plus')
    } else {
      html += `<span class="diff-line-neutral">${escapeHtml(line)}</span>`
    }
  }

  return html
}

// Merge consecutive single-line tool calls with the same tool name
function mergeToolCalls(toolCalls) {
  const groups = []
  for (const tc of toolCalls) {
    const isSingleLine = !tc.display.includes('\n')
    const last = groups[groups.length - 1]
    if (last && last.toolName === tc.toolName && isSingleLine && last.merged) {
      last.items.push(tc.display)
    } else {
      groups.push({
        toolName: tc.toolName,
        items: [tc.display],
        merged: isSingleLine
      })
    }
  }
  return groups
}

// Render a tool call with optional output and error state.
// Handles merging with previous same-named tool call (single-line only).
// Renders inside a .tool-calls-container with a toggle button (same pattern as history).
function renderToolCallLive(toolName, display, output = '', isError = false) {
  const list = getOrCreateToolList()
  const isSingleLine = !display.includes('\n')
  // Check for merge with last rendered tool call within this container
  const allDisplays = list.querySelectorAll('.tool-use-display')
  const lastDisplay = allDisplays[allDisplays.length - 1]

  if (lastDisplay && lastDisplay.dataset.toolName === toolName && isSingleLine) {
    if (lastDisplay.classList.contains('tool-merge-group')) {
      // Already a group — add item
      const header = lastDisplay.querySelector('.tool-header')
      const items = lastDisplay.querySelectorAll('.tool-merge-item')
      header.innerHTML = `&#9679; ${escapeHtml(toolName)} \u00d7${items.length + 1}`
      const item = document.createElement('span')
      item.className = 'tool-merge-item'
      item.textContent = display
      lastDisplay.appendChild(item)
    } else {
      // Convert single to merge group
      const headerText = lastDisplay.querySelector('.tool-header')?.textContent?.replace('\u25cf ', '') || toolName
      lastDisplay.classList.add('tool-merge-group')
      lastDisplay.innerHTML = [
        `<span class="tool-header">&#9679; ${escapeHtml(toolName)} \u00d72</span>`,
        `<span class="tool-merge-item">${escapeHtml(headerText)}</span>`,
        `<span class="tool-merge-item">${escapeHtml(display)}</span>`
      ].join('')
    }
    updateToolContainerCount()
    scrollToBottom()
    return
  }

  // New element
  const el = document.createElement('div')
  el.className = 'tool-use-display'
  if (isError) el.classList.add('tool-error')
  el.dataset.toolName = toolName

  let html = formatToolCallDisplay(display)

  if (output) {
    const statusClass = isError ? 'tool-result-error' : 'tool-result-neutral'
    html += `<div class="tool-result-output ${statusClass}">${escapeHtml(output)}</div>`
  }

  el.innerHTML = html
  list.appendChild(el)
  updateToolContainerCount()
  scrollToBottom()
}

function getOrCreateToolList() {
  if (currentToolList) return currentToolList

  // Create container
  currentToolContainer = document.createElement('div')
  currentToolContainer.className = 'tool-calls-container expanded'

  const toggleBtn = document.createElement('div')
  toggleBtn.className = 'tool-calls-toggle expanded'
  toggleBtn.onclick = () => toggleToolCalls(toggleBtn)
  toggleBtn.innerHTML = `
    <span class="icon">&#128295;</span>
    <span class="toggle-label">0 tool calls</span>
    <span class="count">0</span>
  `
  currentToolContainer.appendChild(toggleBtn)

  currentToolList = document.createElement('div')
  currentToolList.className = 'tool-calls-list'
  currentToolContainer.appendChild(currentToolList)

  chatContainer.appendChild(currentToolContainer)
  return currentToolList
}

function updateToolContainerCount() {
  if (!currentToolList) return
  const count = currentToolList.querySelectorAll('.tool-use-display').length
  const labelEl = currentToolContainer.querySelector('.toggle-label')
  const countEl = currentToolContainer.querySelector('.count')
  if (labelEl) labelEl.textContent = `${count} tool call${count !== 1 ? 's' : ''}`
  if (countEl) countEl.textContent = count
}

// Render a tool calls list from merged groups
function renderToolCallsList(toolCalls) {
  const groups = mergeToolCalls(toolCalls)
  const list = document.createElement('div')
  list.className = 'tool-calls-list'

  for (const group of groups) {
    if (!group.merged || group.items.length === 1) {
      // Single item — render as before
      const tcEl = document.createElement('div')
      tcEl.className = 'tool-use-display'
      tcEl.innerHTML = formatToolCallDisplay(group.items[0])
      list.appendChild(tcEl)
    } else {
      // Merged group — show header + individual items
      const mergeEl = document.createElement('div')
      mergeEl.className = 'tool-use-display tool-merge-group'
      let html = `<span class="tool-header">&#9679; ${escapeHtml(group.toolName)} ×${group.items.length}</span>`
      for (const item of group.items) {
        html += `<span class="tool-merge-item">${escapeHtml(item)}</span>`
      }
      mergeEl.innerHTML = html
      list.appendChild(mergeEl)
    }
  }

  return list
}

// Restore auto-approve state
const savedAutoApprove = localStorage.getItem('autoApprove') === '1'
document.getElementById('autoApproveToggle').checked = savedAutoApprove

// Initialize theme
setTheme(getTheme())

// Connect WebSocket
function connect() {
  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    statusDot.classList.remove('disconnected')
    statusText.textContent = 'Connected'
    sendBtn.disabled = false
    // Sync auto-approve state to server
    if (localStorage.getItem('autoApprove') === '1') {
      ws.send(JSON.stringify({ type: 'set_permission_mode', mode: 'auto_approve' }))
    }
    // Load config to populate currentModel
    ws.send(JSON.stringify({ type: 'get_config' }))
    // Restore the last session from localStorage
    autoRestoreLastSession()
  }

  ws.onclose = () => {
    statusDot.classList.add('disconnected')
    statusText.textContent = 'Disconnected'
    sendBtn.disabled = true
    setTimeout(connect, 3000)
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      console.log('[ws] Received:', msg.type, msg)
      handleMessage(msg)
    } catch (e) {
      console.error('[ws] Error parsing message:', e, event.data)
    }
  }
}

function handleMessage(msg) {
  console.log('[handleMessage] Processing:', msg.type)
  try {
  switch (msg.type) {
    case 'thinking_start':
      // Reset tool call container for this new assistant response
      currentToolContainer = null
      currentToolList = null
      // Finalize current text bubble — next text_chunk starts a new message
      currentAssistantEl = null
      // Create thinking indicator
      if (thinkingIndicatorEl) thinkingIndicatorEl.remove()
      thinkingIndicatorEl = document.createElement('div')
      thinkingIndicatorEl.className = 'thinking-indicator'
      thinkingIndicatorEl.textContent = 'Thinking\u2026'
      chatContainer.appendChild(thinkingIndicatorEl)
      scrollToBottom()
      break

    case 'thinking_chunk':
      if (thinkingIndicatorEl && msg.estimatedTokens) {
        const k = (msg.estimatedTokens / 1000).toFixed(2)
        thinkingIndicatorEl.textContent = `Thinking\u2026 (${k}k)`
      }
      break

    case 'thinking_end':
      if (thinkingIndicatorEl) {
        thinkingIndicatorEl.remove()
        thinkingIndicatorEl = null
      }
      break

    case 'text_chunk':
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage('', 'assistant')
      }
      currentAssistantEl.dataset.rawText = (currentAssistantEl.dataset.rawText || '') + msg.text
      // 流式渲染 markdown，每块逐步追加，兼顾逐字效果和 markdown/diff 高亮
      currentAssistantEl.innerHTML = renderMarkdown(currentAssistantEl.dataset.rawText)
      scrollToBottom()
      break

    case 'tool_start':
      // Tool start is handled by tool_use_display - skip
      break

    case 'tool_use_display':
      // Finalize current text bubble — next text_chunk starts a new message
      currentAssistantEl = null
      // Buffer — render on tool_result so we have output/isError for coloring
      pendingToolCalls.push({ toolName: msg.toolName, display: msg.display })
      break

    case 'tool_result':
      // Render now that we have output and error status
      if (pendingToolCalls.length > 0) {
        const tc = pendingToolCalls.shift()
        // Skip Read tool display — file contents are noisy and unnecessary in chat
        if (tc.toolName !== 'Read') {
          renderToolCallLive(tc.toolName, tc.display, msg.output || '', msg.isError || false)
        }
      }
      break

    case 'action_required':
      showPermissionDialog(msg)
      break

    case 'done':
      sessionId = msg.sessionId || sessionId
      // Save session ID for auto-restore on page reload
      if (sessionId) {
        localStorage.setItem('lastSessionId', sessionId)
        if (currentProject) {
          localStorage.setItem('lastProjectDir', currentProject)
        }
        // Also save in the same format switchSession() uses
        const projectDir = currentProject
          ? currentProject.replace(/[/\\:]/g, '-')
          : 'unknown'
        localStorage.setItem('lastSession', JSON.stringify({
          projectId: projectDir,
          sessionId,
          cwd: currentProject || '',
        }))
      }
      // Flush any remaining buffered tool calls (no output — never got results)
      while (pendingToolCalls.length > 0) {
        const tc = pendingToolCalls.shift()
        renderToolCallLive(tc.toolName, tc.display)
      }
      // Reset container for next response
      currentToolContainer = null
      currentToolList = null
      // Final render with markdown now that streaming is complete
      if (currentAssistantEl && currentAssistantEl.dataset.rawText) {
        currentAssistantEl.innerHTML = renderMarkdown(currentAssistantEl.dataset.rawText)
      }

      // Remove empty assistant message bubble
      if (currentAssistantEl && !currentAssistantEl.textContent.trim()) {
        currentAssistantEl.remove()
      }
      isGenerating = false
      currentAssistantEl = null
      sendBtn.disabled = false
      messageInput.focus()
      removeTypingIndicator()
      if (thinkingIndicatorEl) {
        thinkingIndicatorEl.remove()
        thinkingIndicatorEl = null
      }
      break

    case 'cancelled':
      // Flush any remaining buffered tool calls
      while (pendingToolCalls.length > 0) {
        const tc = pendingToolCalls.shift()
        if (tc.toolName !== 'Read') {
          renderToolCallLive(tc.toolName, tc.display)
        }
      }
      if (currentAssistantEl && !currentAssistantEl.textContent.trim()) {
        currentAssistantEl.remove()
      }
      if (thinkingIndicatorEl) {
        thinkingIndicatorEl.remove()
        thinkingIndicatorEl = null
      }
      isGenerating = false
      currentAssistantEl = null
      pendingToolCalls = []
      currentToolContainer = null
      currentToolList = null
      sendBtn.disabled = false
      removeTypingIndicator()
      addMessage('Generation cancelled.', 'assistant')
      break

    case 'permission_mode_changed':
      // Server confirmed mode change
      break

    case 'error':
      if (isGenerating && retryCount < MAX_RETRIES) {
        retryCount++
        console.log(`[retry] Attempt ${retryCount}/${MAX_RETRIES} after error: ${msg.message}`)
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.OPEN && lastChatMessage) {
            ws.send(JSON.stringify(lastChatMessage))
          }
        }, RETRY_DELAY)
        return  // Don't show error yet
      }
      addMessage(`Error: ${msg.message}`, 'error')
      isGenerating = false
      sendBtn.disabled = false
      removeTypingIndicator()
      break

    case 'config':
      loadConfig(msg)
      break

    case 'config_validating':
      showConfigStatus('validating', 'Validating connection...')
      document.querySelector('.btn-save').disabled = true
      break

    case 'config_saved':
      showConfigStatus('success', 'Settings saved! Reconnecting...')
      document.querySelector('.btn-save').disabled = false
      // Reconnect to apply new settings
      setTimeout(() => {
        if (ws) ws.close()
        connect()
      }, 1000)
      break

    case 'config_error':
      showConfigStatus('error', msg.message || 'Validation failed')
      document.querySelector('.btn-save').disabled = false
      break
  }
  } catch (e) {
    console.error('[handleMessage] Error:', e, msg)
  }
}

function showPermissionDialog(prompt) {
  const dialog = document.createElement('div')
  dialog.className = 'permission-dialog'
  dialog.id = `prompt-${prompt.promptId}`
  dialog.innerHTML = `
    <p>${escapeHtml(prompt.question)}</p>
    <div class="permission-actions">
      <button class="btn-approve" onclick="respondPermission('${prompt.promptId}', 'yes')">Approve</button>
      <button class="btn-deny" onclick="respondPermission('${prompt.promptId}', 'no')">Deny</button>
    </div>
  `
  chatContainer.appendChild(dialog)
  scrollToBottom()
}

function respondPermission(promptId, reply) {
  const dialog = document.getElementById(`prompt-${promptId}`)
  if (dialog) {
    dialog.remove()
  }

  ws.send(JSON.stringify({
    type: 'input',
    promptId,
    reply,
  }))
}

function renderMarkdown(text) {
  // Escape HTML first, then apply markdown
  // We need to be careful: escapeHtml converts & < > " but not * `
  // so markdown syntax still works after escaping
  let html = escapeHtml(text)

  // Code blocks ```...```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  // Inline code `...`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
  // Bold **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic *...*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // Newlines (but not inside pre blocks)
  html = html.replace(/\n/g, '<br>')
  return html
}

function addMessage(text, className) {
  const el = document.createElement('div')
  el.className = `message ${className}`
  el.dataset.rawText = text
  // Only render markdown for assistant messages
  if (className === 'assistant') {
    el.innerHTML = renderMarkdown(text)
  } else {
    el.textContent = text
  }
  chatContainer.appendChild(el)
  scrollToBottom()
  return el
}

let typingTimerInterval = null

function addTypingIndicator() {
  const el = document.createElement('div')
  el.className = 'thinking-indicator'
  el.id = 'typingIndicator'
  el.textContent = 'Cooking\u2026'
  chatContainer.appendChild(el)
  scrollToBottom()

  const startTime = Date.now()
  typingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    el.textContent = `Cooking\u2026 (${m}m ${s}s)`
  }, 1000)
}

function removeTypingIndicator() {
  if (typingTimerInterval) {
    clearInterval(typingTimerInterval)
    typingTimerInterval = null
  }
  const el = document.getElementById('typingIndicator')
  if (el) el.remove()
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Settings functions
function openSettings() {
  document.getElementById('settingsModal').classList.add('active')
  // Request current config from server
  ws.send(JSON.stringify({ type: 'get_config' }))
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active')
  document.getElementById('configStatus').className = 'config-status'
  document.getElementById('configStatus').textContent = ''
}

function loadConfig(config) {
  document.getElementById('providerSelect').value = 'openai'
  document.getElementById('baseUrlInput').value = config.baseUrl || ''
  const modelSelect = document.getElementById('modelSelect')
  if (config.model && [...modelSelect.options].some(o => o.value === config.model)) {
    modelSelect.value = config.model
  } else if (config.model) {
    // Add a custom option if the saved model isn't in the list
    const opt = document.createElement('option')
    opt.value = config.model
    opt.textContent = config.model
    modelSelect.appendChild(opt)
    modelSelect.value = config.model
  } else {
    modelSelect.value = 'gpt-4o'
  }
  document.getElementById('apiKeyInput').value = config.hasApiKey ? '••••••••' : ''
  document.getElementById('apiKeyInput').placeholder = config.hasApiKey ? '••••••••' : 'sk-...'
  currentModel = config.model || ''
}

function saveSettings() {
  const config = {
    type: 'save_config',
    profile: 'openai',
    baseUrl: document.getElementById('baseUrlInput').value,
    model: document.getElementById('modelSelect').value,
    apiKey: document.getElementById('apiKeyInput').value,
  }
  ws.send(JSON.stringify(config))
}

function showConfigStatus(type, message) {
  const statusEl = document.getElementById('configStatus')
  if (type === 'validating') {
    statusEl.className = 'config-status validating'
    statusEl.style.display = 'block'
    statusEl.style.background = 'rgba(59, 130, 246, 0.15)'
    statusEl.style.borderColor = 'var(--accent)'
    statusEl.style.color = 'var(--accent)'
  } else if (type === 'success') {
    statusEl.className = 'config-status success'
    setTimeout(() => {
      closeSettings()
    }, 1500)
  } else {
    statusEl.className = 'config-status error'
  }
  statusEl.textContent = message
}

async function sendMessage() {
  const message = messageInput.value.trim()
  if (!message || isGenerating) return

  // If continuing an existing session, load and display full history
  // so the user sees the complete conversation context.
  if (sessionId) {
    const projectDir = currentProject
      ? currentProject.replace(/[/\\:]/g, '-')
      : 'unknown'
    try {
      const resp = await fetch(`/api/session-messages?project=${encodeURIComponent(projectDir)}&session=${encodeURIComponent(sessionId)}`)
      const data = await resp.json()
      if (data.messages && data.messages.length > 0) {
        chatContainer.innerHTML = ''
        renderSessionMessages(data.messages)
      }
    } catch {
      // Failed to load history — proceed with empty chat
    }
  }

  addMessage(message, 'user')
  messageInput.value = ''
  messageInput.style.height = 'auto'

  isGenerating = true
  sendBtn.disabled = true
  addTypingIndicator()

  const chatMsg = {
    type: 'chat',
    message,
    sessionId,
    cwd: currentProject || undefined,
    model: currentModel || undefined,
  }
  console.log('[sendMessage] Sending:', chatMsg)
  lastChatMessage = chatMsg
  retryCount = 0
  ws.send(JSON.stringify(chatMsg))
}

// Event listeners
sendBtn.addEventListener('click', sendMessage)

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto'
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px'
})

// Close modal when clicking outside
document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsModal')) {
    closeSettings()
  }
})

// Close modal when clicking outside

// Project list management
let currentProject = null

async function loadProjects() {
  try {
    const response = await fetch('/api/projects')
    const projects = await response.json()

    const projectList = document.getElementById('projectList')
    projectList.innerHTML = ''

    projects.forEach(project => {
      const group = document.createElement('div')
      group.className = 'project-group'
      group.dataset.projectId = project.id

      const header = document.createElement('div')
      header.className = 'project-header'
      header.innerHTML = `
        <span class="project-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
        <span class="project-count">${project.sessionCount}</span>
      `

      const sessionList = document.createElement('div')
      sessionList.className = 'session-list'
      sessionList.id = `sessions-${project.id}`

      group.appendChild(header)
      group.appendChild(sessionList)
      projectList.appendChild(group)

      // Always load sessions
      loadSessions(project.id)
    })
  } catch (err) {
    console.error('Failed to load projects:', err)
  }
}

async function loadSessions(projectId) {
  try {
    const response = await fetch(`/api/sessions?project=${encodeURIComponent(projectId)}`)
    const sessions = await response.json()

    const sessionList = document.getElementById(`sessions-${projectId}`)
    sessionList.innerHTML = ''

    sessions.forEach(session => {
      const item = document.createElement('div')
      item.className = `session-item ${sessionId === session.sessionId ? 'active' : ''}`
      item.dataset.sessionId = session.sessionId
      item.dataset.cwd = session.cwd || ''
      item.onclick = () => switchSession(projectId, session.sessionId, session.cwd || '')

      const title = session.customTitle || session.summary || session.firstPrompt || 'Untitled'
      const time = new Date(session.lastModified).toLocaleString()

      item.innerHTML = `
        <div class="session-title">${escapeHtml(title.substring(0, 50))}</div>
        <div class="session-time">${time}</div>
      `

      sessionList.appendChild(item)
    })
  } catch (err) {
    console.error('Failed to load sessions:', err)
  }
}

function renderSessionMessages(messages) {
  if (!messages || messages.length === 0) {
    addMessage('No messages in this session. Start typing to continue...', 'assistant')
    return
  }

  // First pass: merge consecutive tool-calls-only assistant messages
  const mergedMessages = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      mergedMessages.push(msg)
    } else if (msg.role === 'assistant') {
      const last = mergedMessages[mergedMessages.length - 1]
      if (last && last.role === 'assistant' && !last.content?.trim() && last.toolCalls?.length > 0
          && !msg.content?.trim() && msg.toolCalls?.length > 0) {
        last.toolCalls.push(...msg.toolCalls)
      } else {
        mergedMessages.push(msg)
      }
    }
  }

  mergedMessages.forEach(msg => {
    if (msg.role === 'user') {
      addMessage(msg.content, 'user')
    } else if (msg.role === 'assistant') {
      let el = null
      if (msg.content && msg.content.trim()) {
        el = addMessage(msg.content, 'assistant')
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Filter out Read tool calls from history display
        const filteredCalls = msg.toolCalls.filter(tc => tc.toolName !== 'Read')
        if (filteredCalls.length === 0) return

        const toolCallsContainer = document.createElement('div')
        toolCallsContainer.className = 'tool-calls-container'

        const mergedGroups = mergeToolCalls(filteredCalls)
        const toggleBtn = document.createElement('div')
        toggleBtn.className = 'tool-calls-toggle'
        toggleBtn.onclick = () => toggleToolCalls(toggleBtn)
        const label = mergedGroups.length < filteredCalls.length
          ? `${mergedGroups.length} tool calls (merged from ${filteredCalls.length})`
          : `${filteredCalls.length} tool calls`
        toggleBtn.innerHTML = `
          <span class="icon">&#128295;</span>
          <span>${label}</span>
          <span class="count">${mergedGroups.length}</span>
        `
        toolCallsContainer.appendChild(toggleBtn)

        const toolCallsList = renderToolCallsList(filteredCalls)
        toolCallsContainer.appendChild(toolCallsList)

        if (el) {
          el.after(toolCallsContainer)
        } else {
          chatContainer.appendChild(toolCallsContainer)
        }
      }
    }
  })
}

async function switchSession(projectId, newSessionId, cwd) {
  closeSidebar()
  // Clear current chat
  chatContainer.innerHTML = ''
  sessionId = newSessionId
  currentProject = cwd || projectId

  // Remember last session
  localStorage.setItem('lastSession', JSON.stringify({ projectId, sessionId: newSessionId, cwd: cwd || '' }))

  // Update active state
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))
  document.querySelector(`.session-item[data-session-id="${newSessionId}"]`)?.classList.add('active')

  // Load session history
  try {
    const response = await fetch(`/api/session-messages?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(newSessionId)}`)
    const data = await response.json()
    renderSessionMessages(data.messages)
  } catch (err) {
    console.error('Failed to load session messages:', err)
    addMessage('Failed to load session history. Start typing to continue...', 'assistant')
  }

  scrollToBottom()
}

// Auto-restore last session on page load
function autoRestoreLastSession() {
  try {
    const saved = localStorage.getItem('lastSession')
    if (!saved) return

    const { projectId, sessionId: savedSessionId, cwd } = JSON.parse(saved)
    if (!savedSessionId) return

    // Don't restore if already in a session
    if (sessionId) return

    // Don't restore if chat is not empty (has more than just welcome message)
    const existingMessages = chatContainer.querySelectorAll('.message')
    if (existingMessages.length > 1) return

    sessionId = savedSessionId
    currentProject = cwd || projectId

    // Fetch and display session messages via HTTP
    fetch(`/api/session-messages?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(savedSessionId)}`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && data.messages.length > 0) {
          // Remove welcome message before restoring
          const welcome = chatContainer.querySelector('.message.assistant:only-child')
          if (welcome && welcome.textContent.includes('Welcome to OpenClaude')) {
            welcome.remove()
          }
          renderSessionMessages(data.messages)
        }
      })
      .catch(err => console.error('[autoRestore] Failed to load session:', err))
  } catch (err) {
    console.error('[autoRestore] Error:', err)
  }
}

// Project Selector
let selectedProjectPath = ''

async function openProjectSelector() {
  closeSidebar()
  document.getElementById('projectModal').classList.add('active')
  selectedProjectPath = ''
  document.getElementById('customPath').value = ''

  // Load recent projects
  await loadProjectOptions()
}

function closeProjectSelector() {
  document.getElementById('projectModal').classList.remove('active')
}

async function loadProjectOptions() {
  const container = document.getElementById('projectOptions')
  container.innerHTML = ''

  try {
    const response = await fetch('/api/projects')
    const projects = await response.json()

    projects.filter(p => p.sessionCount > 0).forEach(project => {
      const option = document.createElement('div')
      option.className = 'project-option'
      option.dataset.path = project.path
      option.onclick = () => selectProject(project.path, option)

      option.innerHTML = `
        <div class="project-option-name">${escapeHtml(project.path.split(/[/\\]/).pop() || project.path)}</div>
        <div class="project-option-path">${escapeHtml(project.path)}</div>
      `

      container.appendChild(option)
    })
  } catch (err) {
    console.error('Failed to load projects:', err)
  }
}

function selectProject(path, element) {
  // Remove selected class from all options
  document.querySelectorAll('.project-option').forEach(el => el.classList.remove('selected'))

  // Add selected class to clicked option
  element.classList.add('selected')
  selectedProjectPath = path

  // Update custom path input
  document.getElementById('customPath').value = path
}

function browseFolder() {
  const browser = document.getElementById('dirBrowser')
  const wasHidden = browser.style.display === 'none'
  if (wasHidden) {
    browser.style.display = 'block'
    loadDirectory('')
  }
}

function toggleDirBrowser() {
  const browser = document.getElementById('dirBrowser')
  browser.style.display = browser.style.display === 'none' ? 'block' : 'none'
}

async function loadDirectory(dirPath) {
  const list = document.getElementById('dirBrowserList')
  const pathEl = document.getElementById('dirBrowserPath')
  hideCreateFolderInput()
  list.innerHTML = '<div class="dir-loading">Loading...</div>'

  try {
    const response = await fetch(`/api/browse-directory?path=${encodeURIComponent(dirPath)}`)
    const data = await response.json()

    if (data.error) {
      list.innerHTML = `<div class="dir-error">${escapeHtml(data.error)}</div>`
      return
    }

    pathEl.textContent = data.currentPath

    list.innerHTML = ''

    // Parent directory (..)
    if (data.parentPath) {
      const parent = document.createElement('div')
      parent.className = 'dir-entry dir-up'
      parent.innerHTML = '<span class="dir-icon">📂</span> ..'
      parent.onclick = () => loadDirectory(data.parentPath)
      list.appendChild(parent)
    }

    data.entries.forEach(entry => {
      const el = document.createElement('div')
      el.className = 'dir-entry'
      if (!entry.accessible) el.classList.add('dir-inaccessible')
      el.innerHTML = `<span class="dir-icon">📁</span> ${escapeHtml(entry.name)}`
      el.onclick = () => {
        if (entry.accessible) {
          loadDirectory(entry.path)
        }
      }
      el.ondblclick = (e) => {
        e.stopPropagation()
        document.getElementById('customPath').value = entry.path
        toggleDirBrowser()
      }
      list.appendChild(el)
    })
  } catch (err) {
    list.innerHTML = `<div class="dir-error">Failed to load: ${escapeHtml(err.message)}</div>`
  }
}

function showCreateFolderInput() {
  document.getElementById('dirBrowserNewFolder').style.display = 'flex'
  document.getElementById('newFolderInput').value = ''
  document.getElementById('newFolderInput').focus()
}

function hideCreateFolderInput() {
  document.getElementById('dirBrowserNewFolder').style.display = 'none'
}

async function createFolder() {
  const input = document.getElementById('newFolderInput')
  const folderName = input.value.trim()
  if (!folderName) return

  const pathEl = document.getElementById('dirBrowserPath')
  const parentPath = pathEl.textContent
  const fullPath = parentPath + (parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '/') + folderName

  try {
    const response = await fetch('/api/create-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath }),
    })
    const data = await response.json()

    if (data.error) {
      alert(data.error)
      return
    }

    hideCreateFolderInput()
    loadDirectory(parentPath)
  } catch (err) {
    alert(`Failed to create folder: ${err.message}`)
  }
}

async function createNewChat() {
  const customPath = document.getElementById('customPath').value.trim()
  const projectPath = customPath || selectedProjectPath

  if (!projectPath) {
    alert('Please select a project or enter a folder path')
    return
  }

  // Close modal
  closeProjectSelector()

  // Set the project
  currentProject = projectPath
  sessionId = ''

  // Clear chat and show welcome message
  chatContainer.innerHTML = ''
  addMessage(`Project: ${projectPath}\n\nWhat would you like to work on?`, 'assistant')

  // Remove active state from all sessions
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'))

  // Reload projects to show the new one
  await loadProjects()

  messageInput.focus()
}

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  const isOpen = sidebar.classList.toggle('open')
  overlay.classList.toggle('active', isOpen)
  document.body.classList.toggle('sidebar-open', isOpen)
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  sidebar.classList.remove('open')
  overlay.classList.remove('active')
  document.body.classList.remove('sidebar-open')
}

// Auto-show sidebar when resizing above mobile breakpoint
let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (window.innerWidth > 768) {
      document.querySelector('.sidebar')?.classList.remove('open')
      document.getElementById('sidebarOverlay')?.classList.remove('active')
      document.body.classList.remove('sidebar-open')
    }
  }, 150)
})

// VisualViewport handler — keeps body height synced on both mobile and desktop.
// On mobile: position:fixed prevents iOS scrolling (no more blank space), but body
// must shrink when the keyboard opens so the header stays visible. No scrollTo needed.
// On desktop: adjusts for window chrome resize.
function syncBodyHeight() {
  if (!window.visualViewport) return
  document.body.style.height = window.visualViewport.height + 'px'
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    syncBodyHeight()
    if (window.innerWidth > 768) {
      window.scrollTo(0, 0)
    }
  })
}

// MutationObserver: re-sync after DOM attribute changes (e.g. theme toggle).
// Toggling data-theme triggers CSS variable re-evaluation + reflow, which can
// corrupt fixed element positioning on iOS — especially when the keyboard is
// already open. rAF lets the browser settle before re-applying the height.
const viewportObserver = new MutationObserver(() => {
  requestAnimationFrame(syncBodyHeight)
})
viewportObserver.observe(document.documentElement, { attributes: true })

// Start
connect()
loadProjects().then(() => {
  // Don't auto-restore last session — start fresh to avoid
  // dumping all previous messages into a new conversation.
  // Users can manually switch to a session from the sidebar.
})
messageInput.focus()
