const WS_URL = `ws://${location.host}`
let ws = null
let sessionId = ''
let isGenerating = false
let currentAssistantEl = null
let currentToolCalls = []  // Collect tool calls for current message
let pendingPrompts = new Map()

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
  btn.textContent = theme === 'dark' ? '🌙' : '☀️'
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
  }

  ws.onclose = () => {
    statusDot.classList.add('disconnected')
    statusText.textContent = 'Disconnected'
    sendBtn.disabled = true
    setTimeout(connect, 3000)
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    handleMessage(msg)
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'thinking_start':
    case 'thinking_chunk':
    case 'thinking_end':
      // Thinking chain display removed - silently ignore
      break

    case 'text_chunk':
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage('', 'assistant')
      }
      currentAssistantEl.dataset.rawText = (currentAssistantEl.dataset.rawText || '') + msg.text
      currentAssistantEl.innerHTML = renderMarkdown(currentAssistantEl.dataset.rawText)
      scrollToBottom()
      break

    case 'tool_start':
      // Tool start is handled by tool_use_display - skip
      break

    case 'tool_result':
      // Tool results are not shown in the UI - skip
      break

    case 'tool_use_display':
      // Collect tool calls for current message
      currentToolCalls.push({
        toolName: msg.toolName,
        toolUseId: msg.toolUseId,
        display: msg.display,
      })
      break

    case 'action_required':
      showPermissionDialog(msg)
      break

    case 'done':
      sessionId = msg.sessionId || sessionId
      // Attach collected tool calls to the message
      if (currentToolCalls.length > 0) {
        const toolCallsContainer = document.createElement('div')
        toolCallsContainer.className = 'tool-calls-container'

        // Create toggle button
        const mergedGroups = mergeToolCalls(currentToolCalls)
        const toggleBtn = document.createElement('div')
        toggleBtn.className = 'tool-calls-toggle'
        toggleBtn.onclick = () => toggleToolCalls(toggleBtn)
        const label = mergedGroups.length < currentToolCalls.length
          ? `${mergedGroups.length} tool calls (merged from ${currentToolCalls.length})`
          : `${currentToolCalls.length} tool calls`
        toggleBtn.innerHTML = `
          <span class="icon">&#128295;</span>
          <span>${label}</span>
          <span class="count">${mergedGroups.length}</span>
        `
        toolCallsContainer.appendChild(toggleBtn)

        // Create tool calls list with merged groups
        const toolCallsList = renderToolCallsList(currentToolCalls)
        toolCallsContainer.appendChild(toolCallsList)

        // Insert tool calls after the message, or append to chat
        if (currentAssistantEl) {
          currentAssistantEl.after(toolCallsContainer)
        } else {
          chatContainer.appendChild(toolCallsContainer)
        }
      }
      currentToolCalls = []

      // Remove empty assistant message bubble
      if (currentAssistantEl && !currentAssistantEl.textContent.trim()) {
        currentAssistantEl.remove()
      }
      isGenerating = false
      currentAssistantEl = null
      sendBtn.disabled = false
      messageInput.focus()
      removeTypingIndicator()
      break

    case 'cancelled':
      if (currentAssistantEl && !currentAssistantEl.textContent.trim()) {
        currentAssistantEl.remove()
      }
      isGenerating = false
      currentAssistantEl = null
      currentToolCalls = []
      sendBtn.disabled = false
      removeTypingIndicator()
      addMessage('Generation cancelled.', 'assistant')
      break

    case 'permission_mode_changed':
      // Server confirmed mode change
      break

    case 'error':
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

function addTypingIndicator() {
  const el = document.createElement('div')
  el.className = 'typing'
  el.id = 'typingIndicator'
  el.innerHTML = '<span></span><span></span><span></span>'
  chatContainer.appendChild(el)
  scrollToBottom()
}

function removeTypingIndicator() {
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
  document.getElementById('providerSelect').value = config.profile || 'openai'
  document.getElementById('baseUrlInput').value = config.baseUrl || ''
  document.getElementById('modelInput').value = config.model || ''
  document.getElementById('apiKeyInput').value = config.hasApiKey ? '••••••••' : ''
  document.getElementById('apiKeyInput').placeholder = config.hasApiKey ? '••••••••' : 'sk-...'
}

function saveSettings() {
  const config = {
    type: 'save_config',
    profile: document.getElementById('providerSelect').value,
    baseUrl: document.getElementById('baseUrlInput').value,
    model: document.getElementById('modelInput').value,
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

function sendMessage() {
  const message = messageInput.value.trim()
  if (!message || isGenerating) return

  addMessage(message, 'user')
  messageInput.value = ''
  messageInput.style.height = 'auto'

  isGenerating = true
  sendBtn.disabled = true
  addTypingIndicator()

  ws.send(JSON.stringify({
    type: 'chat',
    message,
    sessionId,
    cwd: currentProject || undefined,
    model: undefined,
  }))
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

// Preset URLs when selecting provider
document.getElementById('providerSelect').addEventListener('change', (e) => {
  const baseUrlInput = document.getElementById('baseUrlInput')
  const modelInput = document.getElementById('modelInput')

  if (e.target.value === 'ollama') {
    if (!baseUrlInput.value || baseUrlInput.value === 'https://api.openai.com/v1') {
      baseUrlInput.value = 'http://localhost:11434/v1'
    }
    if (!modelInput.value || modelInput.value.startsWith('gpt')) {
      modelInput.value = 'llama3.2'
    }
  } else if (e.target.value === 'openai') {
    if (baseUrlInput.value === 'http://localhost:11434/v1') {
      baseUrlInput.value = 'https://api.openai.com/v1'
    }
    if (modelInput.value === 'llama3.2') {
      modelInput.value = 'gpt-4o'
    }
  }
})

// Project list management
let currentProject = null
let expandedProjects = new Set()

async function loadProjects() {
  try {
    const response = await fetch('/api/projects')
    const projects = await response.json()

    const projectList = document.getElementById('projectList')
    projectList.innerHTML = ''

    projects.forEach(project => {
      const group = document.createElement('div')
      // Auto-expand projects that have sessions
      if (project.sessionCount > 0) {
        expandedProjects.add(project.id)
      }
      group.className = `project-group ${expandedProjects.has(project.id) ? 'expanded' : ''}`
      group.dataset.projectId = project.id

      const header = document.createElement('div')
      header.className = 'project-header'
      header.onclick = () => toggleProject(project.id)
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

      // Load sessions if expanded
      if (expandedProjects.has(project.id)) {
        loadSessions(project.id)
      }
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

function toggleProject(projectId) {
  const group = document.querySelector(`.project-group[data-project-id="${projectId}"]`)
  if (expandedProjects.has(projectId)) {
    expandedProjects.delete(projectId)
    group.classList.remove('expanded')
  } else {
    expandedProjects.add(projectId)
    group.classList.add('expanded')
    loadSessions(projectId)
  }
}

async function switchSession(projectId, newSessionId, cwd) {
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

    if (data.messages && data.messages.length > 0) {
      // First pass: merge consecutive assistant messages with tool calls
      const mergedMessages = []
      for (const msg of data.messages) {
        if (msg.role === 'user') {
          mergedMessages.push(msg)
        } else if (msg.role === 'assistant') {
          const last = mergedMessages[mergedMessages.length - 1]
          // If last message is a tool-calls-only assistant with no text, and current is also tool-calls-only, merge
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
          // Only add message bubble if there's text content
          let el = null
          if (msg.content && msg.content.trim()) {
            el = addMessage(msg.content, 'assistant')
          }
          // Render tool calls if present
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            const toolCallsContainer = document.createElement('div')
            toolCallsContainer.className = 'tool-calls-container'

            // Create toggle button
            const mergedGroups = mergeToolCalls(msg.toolCalls)
            const toggleBtn = document.createElement('div')
            toggleBtn.className = 'tool-calls-toggle'
            toggleBtn.onclick = () => toggleToolCalls(toggleBtn)
            const label = mergedGroups.length < msg.toolCalls.length
              ? `${mergedGroups.length} tool calls (merged from ${msg.toolCalls.length})`
              : `${msg.toolCalls.length} tool calls`
            toggleBtn.innerHTML = `
              <span class="icon">&#128295;</span>
              <span>${label}</span>
              <span class="count">${mergedGroups.length}</span>
            `
            toolCallsContainer.appendChild(toggleBtn)

            // Create tool calls list with merged groups
            const toolCallsList = renderToolCallsList(msg.toolCalls)
            toolCallsContainer.appendChild(toolCallsList)

            // Insert tool calls after the message, or append to chat
            if (el) {
              el.after(toolCallsContainer)
            } else {
              chatContainer.appendChild(toolCallsContainer)
            }
          }
        }
      })
    } else {
      addMessage('No messages in this session. Start typing to continue...', 'assistant')
    }
  } catch (err) {
    console.error('Failed to load session messages:', err)
    addMessage('Failed to load session history. Start typing to continue...', 'assistant')
  }

  scrollToBottom()
}

// Project Selector
let selectedProjectPath = ''

async function openProjectSelector() {
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
  // For web browsers, we can't directly browse folders
  // Show a message to use the input field
  alert('Please enter the folder path directly in the input field.\n\nExample: /home/user/my-project or C:\\Users\\user\\my-project')
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

// Start
connect()
loadProjects().then(() => {
  // Restore last session
  try {
    const saved = JSON.parse(localStorage.getItem('lastSession') || 'null')
    if (saved && saved.sessionId) {
      switchSession(saved.projectId, saved.sessionId, saved.cwd)
    }
  } catch {}
})
messageInput.focus()
