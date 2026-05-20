import { appendFile, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import type { AgentGatewayConfig } from './config.js'
import { getAgentGatewayStateDir, updateAgentGatewayConfig } from './config.js'
import { createCronJob, deleteCronJob, getCronJob, getCronJobsPath, listCronJobs, pauseCronJob, resumeCronJob, runCronJobNow } from './cron.js'
import { runOpenClaudeAgent, redactAgentText, type AgentRunResult } from './agentRunner.js'
import { detectTranscriptionTool, transcribeAudio } from './transcription.js'
import { buildMemoryContextSection, loadScratchpadBlocks, loadIdentity, loadPatterns, appendChatLog, loadDialogueBlocks } from './memory.js'
import { loadRecentReflections, buildReflectionContextSection } from './reflection.js'
import { getAgentGatewayRuntime, restartAgentGateway, stopAgentGateway } from './index.js'
import { toggleEvolution, getEvolutionStatus, runEvolutionCycle, loadEvolutionState } from './evolution.js'
import type { EvolutionResult, EvolutionType } from './evolution.js'
import { buildSelfEditPrompt, selfRead, selfWrite, selfEdit, selfList, gitStatus, gitDiff, gitCommit, gitLog, gitReset } from './selfEdit.js'
import { runInfiniteTask } from './infiniteTask.js'

export type TelegramFileRef = {
  file_id: string
  file_unique_id?: string
  file_name?: string
  mime_type?: string
  file_size?: number
  duration?: number
  width?: number
  height?: number
}

export type TelegramPhotoSize = {
  file_id: string
  file_unique_id?: string
  file_size?: number
  width: number
  height: number
}

export type TelegramMessage = {
  message_id: number
  text?: string
  caption?: string
  chat?: { id: number | string; type?: string; title?: string }
  from?: { id: number | string; username?: string; first_name?: string }
  photo?: TelegramPhotoSize[]
  document?: TelegramFileRef
  video?: TelegramFileRef
  audio?: TelegramFileRef
  voice?: TelegramFileRef
  video_note?: TelegramFileRef
  animation?: TelegramFileRef
  sticker?: TelegramFileRef
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

type TelegramCallbackQuery = {
  id: string
  from?: { id: string; username?: string; first_name?: string }
  message?: TelegramMessage
  chat_instance?: string
  data?: string
}

type TelegramApiResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

type ActiveTelegramTask = {
  controller: AbortController
  messageId: number
  progress?: TelegramTaskProgress
}

export type TelegramGetFileResult = {
  file_id: string
  file_unique_id?: string
  file_size?: number
  file_path?: string
}

export type TelegramAttachment = {
  type: string
  fileId: string
  fileName?: string
  mimeType?: string
  size?: number
  width?: number
  height?: number
  duration?: number
  localPath?: string
  transcript?: string
  transcriptPath?: string
  downloadError?: string
  transcriptionError?: string
}

export type TelegramSendDirective = {
  path: string
  caption?: string
  kind?: 'image' | 'document' | 'auto'
}

export type IncomingAttachmentCandidate = {
  type: string
  file: TelegramFileRef
  width?: number
  height?: number
  duration?: number
}

export type TelegramStoredFile = {
  chatId: string
  messageId: number
  type: string
  fileId: string
  fileName?: string
  mimeType?: string
  size?: number
  localPath: string
  createdAt: string
}

export class TelegramAgentBridge {
  private readonly config: AgentGatewayConfig
  private stopped = false
  private offset = 0
  /** Active AbortControllers per chatId — for /stop */
  private activeTasks = new Map<string, ActiveTelegramTask>()
  /** Last prompt per chatId — for /retry */
  private lastPrompts = new Map<string, { prompt: string; messageId: number }>()

  constructor(config: AgentGatewayConfig) {
    this.config = config
  }

  start(): void {
    if (!this.config.telegram.enabled || !this.config.telegram.botToken) return
    void this.pollLoop()
  }

  stop(): void {
    this.stopped = true
  }

  async sendHomeMessage(text: string): Promise<void> {
    const chatId = this.config.telegram.homeChatId
    if (!chatId) return
    await this.sendMessage(chatId, text)
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const chunks = splitTelegramText(text)
    for (const chunk of chunks) {
      await this.callTelegram('sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      })
    }
  }

  private async sendChatAction(
    chatId: string,
    action: 'typing' | 'upload_photo' | 'upload_document' = 'typing',
  ): Promise<void> {
    await this.callTelegram('sendChatAction', {
      chat_id: chatId,
      action,
    })
  }

  private startTypingLoop(
    chatId: string,
    signal?: AbortSignal,
  ): () => void {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped || signal?.aborted) return
      try {
        await this.sendChatAction(chatId, 'typing')
      } catch {
        // Chat actions are best-effort; the actual response still matters.
      }
      if (!stopped && !signal?.aborted) {
        timer = setTimeout(tick, 4_000)
      }
    }

    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }

  private async createTaskProgress(
    chatId: string,
    phase: string,
    signal?: AbortSignal,
  ): Promise<TelegramTaskProgress> {
    const response = await this.callTelegram<any>('sendMessage', {
      chat_id: chatId,
      text: formatTelegramProgressText({
        status: 'running',
        phase,
        startedAt: Date.now(),
        events: [],
      }),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Stop', callback_data: `stop:${chatId}` },
        ]],
      },
    })
    const messageId = response?.message_id ?? response?.result?.message_id ?? 0
    const stopTyping = this.startTypingLoop(chatId, signal)
    return new TelegramTaskProgress({
      messageId,
      phase,
      stopTyping,
      edit: async text => {
        if (!messageId) return
        await this.callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text,
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[
              { text: 'Stop', callback_data: `stop:${chatId}` },
            ]],
          },
        })
      },
    })
  }

  private async runAgentWithProgress(
    chatId: string,
    prompt: string,
    phase = 'Running agent',
    options?: { suppressObservers?: boolean },
  ): Promise<Awaited<ReturnType<typeof runOpenClaudeAgent>>> {
    if (this.activeTasks.has(chatId)) {
      throw new Error('A task is already running. Use /stop first.')
    }

    const controller = new AbortController()
    const progress = await this.createTaskProgress(chatId, phase, controller.signal)
    this.activeTasks.set(chatId, {
      controller,
      messageId: progress.messageId,
      progress,
    })

    let result: Awaited<ReturnType<typeof runOpenClaudeAgent>> | undefined
    try {
      progress.setPhase(phase)
      result = await runOpenClaudeAgent({
        prompt,
        config: this.config,
        signal: controller.signal,
        suppressObservers: options?.suppressObservers,
        streamEvents: true,
        onProgress: event => progress.addEvent(event),
        onStdout: chunk => progress.observeStdout(chunk),
      })
    } finally {
      this.activeTasks.delete(chatId)
    }

    if (!result) {
      progress.dispose()
      throw new Error('Agent run did not return a result.')
    }

    if (controller.signal.aborted) {
      progress.dispose()
    } else if (result.exitCode === 0) {
      await progress.finish('completed', 'Done. Sending response.')
    } else {
      await progress.finish('failed', formatAgentFailurePhase(result))
    }

    return result
  }

  async sendFile(
    chatId: string,
    filePath: string,
    caption?: string,
    kind: TelegramSendDirective['kind'] = 'auto',
  ): Promise<void> {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${filePath}`)
    }
    if (fileStat.size > this.config.telegram.maxUploadBytes) {
      throw new Error(
        `file is larger than maxUploadBytes (${fileStat.size} > ${this.config.telegram.maxUploadBytes})`,
      )
    }

    const isImage = kind === 'image' || (kind !== 'document' && isTelegramPhotoFile(filePath))
    await this.sendMultipart(
      isImage ? 'sendPhoto' : 'sendDocument',
      chatId,
      isImage ? 'photo' : 'document',
      filePath,
      caption,
    )
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.getUpdates()
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1)
          if (update.message) {
            await this.handleUpdate(update)
          }
          if (update.callback_query) {
            await this.handleCallbackQuery(update.callback_query)
          }
        }
      } catch {
        await sleep(5_000)
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const token = this.config.telegram.botToken
    if (!token) return []

    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`)
    url.searchParams.set('timeout', '30')
    url.searchParams.set('allowed_updates', JSON.stringify(['message', 'callback_query']))
    if (this.offset) url.searchParams.set('offset', String(this.offset))

    const response = await fetch(url)
    const data = await response.json() as TelegramApiResponse<TelegramUpdate[]>
    if (!data.ok) {
      throw new Error(data.description || 'Telegram getUpdates failed')
    }
    return data.result || []
  }

  private async acknowledgeTelegramUpdates(): Promise<void> {
    const token = this.config.telegram.botToken
    if (!token || !this.offset) return

    try {
      const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`)
      url.searchParams.set('timeout', '0')
      url.searchParams.set('offset', String(this.offset))
      await fetch(url)
    } catch {
      // Best effort. Restart/stop should not fail because Telegram ack failed.
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message
    const text = getTelegramMessageText(message)
    const chatId = message?.chat?.id === undefined ? '' : String(message.chat.id)
    if (!message || !chatId) return
    if (!this.isMessageAllowed(message, chatId)) return
    const commandText = normalizeTelegramCommand(text)

    if (text === '/start' || text === '/help') {
      await this.sendMessage(
        chatId,
        [
          'OpenClaude agent bridge is online.',
          '',
          'Send text, screenshots, images, documents, voice, video, or other Telegram files. Files are saved locally and passed to the agent as paths.',
          'Voice messages, audio files, and audio documents are automatically transcribed and sent to the agent.',
          '',
          'Commands:',
          '/chatid - show this chat id',
          '/schedule every 1h | prompt - create a cron job that replies here',
          '/cron [list|reload|chatid|path|examples] - manage cron jobs',
          '/jobs - list jobs created for this chat',
          '/runjob <id> - trigger a job now',
          '/pausejob <id> - pause a scheduled job',
          '/resumejob <id> - resume a paused job',
          '/deletejob <id> - delete a job permanently',
          '/files - list recent files downloaded from this chat',
          '/transcribe - check if voice transcription is available',
          '/provider - show active provider/model/API endpoint',
          '/provider models - load models from the active OpenAI-compatible endpoint',
          '/provider set <provider> <model> [base_url] [api_key] - switch provider for next runs',
          '/model <model> - switch model for next runs',
          '/baseurl <url> - switch OpenAI-compatible base URL for next runs',
          '/apikey <key> - switch provider API key for next runs',
          '/errors [n] - show recent Telegram/gateway errors',
          '/status - show gateway, workers, cron, budget, and Ouroboros status',
          '/panic - abort active tasks and stop the gateway runtime',
          '/restart - soft-restart the gateway runtime',
          '/bg - show background consciousness status',
          '/bg start - start background consciousness loop',
          '/bg stop - stop background consciousness loop',
          '/consciousness - show background consciousness status',
          '/consciousness start - resume consciousness loop',
          '/consciousness stop - pause consciousness loop',
          '/evolution - show evolution status',
          '/evolution on - enable self-improvement cycles',
          '/evolution off - disable evolution',
          '/evolve - start autonomous evolution mode',
          '/evolve stop - stop autonomous evolution mode',
          '/evolve now - run one evolution cycle now',
          '/review - run a deep architecture review cycle',
          '/identity - show current identity',
          '/scratchpad - show working memory',
          '/bible - show Constitution (BIBLE.md)',
          '/architecture - show architecture doc',
          '/git status - show git status',
          '/git log - show recent commits',
          '/git diff [path] - show uncommitted changes',
          '/git commit <msg> - stage and commit all changes',
          '/stop - stop the current running task',
          '/retry - retry the last task with the same prompt',
          '/infinite <goal> - run an opt-in persistent task loop',
          '/undo - revert the last git commit (hard reset)',
          '',
          'Agent output can include [[image:C:\\path\\out.png]] or [[document:C:\\path\\file.pdf]] to upload generated files.',
        ].join('\n'),
      )
      return
    }

    if (text === '/chatid') {
      await this.sendMessage(chatId, `Chat ID: ${chatId}`)
      return
    }

    if (text === '/transcribe') {
      await this.handleTranscribeStatusCommand(chatId)
      return
    }

    if (commandText === '/status') {
      await this.handleStatusCommand(chatId)
      return
    }

    if (text === '/provider' || text.startsWith('/provider ')) {
      await this.handleProviderCommand(chatId, text.slice('/provider'.length).trim())
      return
    }

    if (text.startsWith('/model ')) {
      await this.handleModelCommand(chatId, text.slice('/model '.length))
      return
    }

    if (text.startsWith('/baseurl ')) {
      await this.handleBaseUrlCommand(chatId, text.slice('/baseurl '.length))
      return
    }

    if (text.startsWith('/apikey ')) {
      await this.handleApiKeyCommand(chatId, text.slice('/apikey '.length))
      return
    }

    if (text === '/errors' || text.startsWith('/errors ')) {
      await this.handleErrorsCommand(chatId, text.slice('/errors'.length).trim())
      return
    }

    if (commandText === '/panic') {
      await this.handlePanicCommand(chatId)
      return
    }

    if (commandText === '/restart') {
      await this.handleRestartCommand(chatId)
      return
    }

    if (commandText === '/review') {
      await this.handleReviewCommand(chatId)
      return
    }

    if (commandText === '/bg' || commandText.startsWith('/bg ')) {
      await this.handleBgCommand(chatId, commandText.slice('/bg'.length).trim())
      return
    }

    if (commandText === '/evolve' || commandText.startsWith('/evolve ')) {
      await this.handleEvolveCommand(chatId, commandText.slice('/evolve'.length).trim())
      return
    }

    if (text === '/cron' || text.startsWith('/cron ')) {
      await this.handleCronCommand(chatId, text.slice('/cron'.length).trim())
      return
    }

    if (text.startsWith('/schedule ')) {
      await this.handleScheduleCommand(chatId, text.slice('/schedule '.length))
      return
    }

    if (text === '/jobs') {
      await this.handleJobsCommand(chatId)
      return
    }

    if (text === '/files') {
      await this.handleFilesCommand(chatId)
      return
    }

    if (text.startsWith('/runjob ')) {
      await this.handleRunJobCommand(chatId, text.slice('/runjob '.length))
      return
    }

    if (text.startsWith('/deletejob ')) {
      await this.handleDeleteJobCommand(chatId, text.slice('/deletejob '.length))
      return
    }

    if (text.startsWith('/pausejob ')) {
      await this.handlePauseJobCommand(chatId, text.slice('/pausejob '.length))
      return
    }

    if (text.startsWith('/resumejob ')) {
      await this.handleResumeJobCommand(chatId, text.slice('/resumejob '.length))
      return
    }

    if (text === '/consciousness') {
      await this.handleConsciousnessCommand(chatId)
      return
    }

    if (text === '/consciousness start') {
      await this.handleConsciousnessControlCommand(chatId, 'start')
      return
    }

    if (text === '/consciousness stop') {
      await this.handleConsciousnessControlCommand(chatId, 'stop')
      return
    }

    if (text === '/evolution') {
      await this.handleEvolutionCommand(chatId)
      return
    }

    if (text === '/evolution on') {
      await this.handleEvolutionToggleCommand(chatId, true)
      return
    }

    if (text === '/evolution off') {
      await this.handleEvolutionToggleCommand(chatId, false)
      return
    }

    if (text === '/evolve') {
      await this.handleEvolveNowCommand(chatId)
      return
    }

    if (text === '/identity') {
      await this.handleIdentityCommand(chatId)
      return
    }

    if (text === '/scratchpad') {
      await this.handleScratchpadCommand(chatId)
      return
    }

    if (text === '/bible') {
      await this.handleBibleCommand(chatId)
      return
    }

    if (text === '/architecture') {
      await this.handleArchitectureCommand(chatId)
      return
    }

    if (text === '/git status') {
      await this.handleGitStatusCommand(chatId)
      return
    }

    if (text === '/git log') {
      await this.handleGitLogCommand(chatId)
      return
    }

    if (text.startsWith('/git diff')) {
      await this.handleGitDiffCommand(chatId, text.slice('/git diff'.length).trim())
      return
    }

    if (text.startsWith('/git commit ')) {
      await this.handleGitCommitCommand(chatId, text.slice('/git commit '.length))
      return
    }

    if (text === '/stop') {
      await this.handleStopCommand(chatId)
      return
    }

    if (text === '/retry') {
      await this.handleRetryCommand(chatId)
      return
    }

    if (text.startsWith('/infinite ')) {
      await this.handleInfiniteTaskCommand(chatId, text.slice('/infinite '.length))
      return
    }

    if (text === '/undo') {
      await this.handleUndoCommand(chatId)
      return
    }

    const audioCandidate = getAudioTranscriptionCandidate(message)
    if (audioCandidate && this.config.telegram.transcribeAudio) {
      await this.handleAudioMessage(chatId, message, text, audioCandidate)
      return
    }

    if (this.activeTasks.has(chatId)) {
      await this.sendMessage(chatId, 'A task is already running. Use /stop first.')
      return
    }

    const attachments = await this.collectAttachments(message, chatId)
    if (!text && attachments.length === 0) return

    // Log the incoming message to chat log (for dialogue consolidation)
    await appendChatLog({
      direction: 'in',
      text: text || '(attachments only)',
      chatId,
      messageId: message.message_id,
      username: message.from?.username,
    })

    // Send "thinking" message with Stop button
    const thinkingMsg = await this.callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'OpenClaude is thinking...',
      reply_markup: {
        inline_keyboard: [[
          { text: '⏹ Stop', callback_data: `stop:${chatId}` },
        ]],
      },
    })
    const thinkingMessageId = (thinkingMsg as any)?.message_id ?? (thinkingMsg as any)?.result?.message_id ?? 0

    const controller = new AbortController()
    const progress = new TelegramTaskProgress({
      messageId: thinkingMessageId,
      phase: 'Running Telegram request',
      stopTyping: this.startTypingLoop(chatId, controller.signal),
      edit: async progressText => {
        if (!thinkingMessageId) return
        await this.callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: thinkingMessageId,
          text: progressText,
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[
              { text: 'Stop', callback_data: `stop:${chatId}` },
            ]],
          },
        })
      },
    })
    progress.setPhase('Running Telegram request')
    this.activeTasks.set(chatId, { controller, messageId: thinkingMessageId, progress })

    const prompt = await buildTelegramAgentPromptWithMemory({
      chatId,
      messageId: message.message_id,
      from: message.from,
      text,
      attachments,
    })

    // Save for /retry
    this.lastPrompts.set(chatId, { prompt, messageId: message.message_id })

    let result: Awaited<ReturnType<typeof runOpenClaudeAgent>>
    try {
      result = await runOpenClaudeAgent({
        prompt,
        config: this.config,
        signal: controller.signal,
        streamEvents: true,
        onProgress: event => progress.addEvent(event),
        onStdout: chunk => progress.observeStdout(chunk),
      })
    } finally {
      this.activeTasks.delete(chatId)
    }

    if (controller.signal.aborted) {
      progress.dispose()
      return
    }

    if (result.exitCode === 0) {
      await progress.finish('completed', 'Done. Sending response.')
    } else {
      await progress.finish('failed', formatAgentFailurePhase(result))
    }

    // Log the agent response to chat log
    await appendChatLog(buildAgentChatLogOutput(result, chatId))

    if (result.exitCode !== 0) {
      await recordTelegramError(chatId, 'agent-run', result)
      await this.sendMessage(chatId, formatAgentFailureForTelegram(result))
      return
    }

    await this.deliverAgentText(chatId, result.text, '(No response generated)')
  }

  private async handleAudioMessage(
    chatId: string,
    message: TelegramMessage,
    caption: string,
    candidate: IncomingAttachmentCandidate,
  ): Promise<void> {
    try {
      await this.sendMessage(chatId, `Transcribing ${candidate.type}...`)

      const audioPath = await this.downloadTelegramFile(
        candidate,
        chatId,
        message.message_id,
      )

      const attachment: TelegramAttachment = {
        type: candidate.type,
        fileId: candidate.file.file_id,
        fileName: candidate.file.file_name || basename(audioPath),
        mimeType: candidate.file.mime_type,
        size: candidate.file.file_size,
        width: candidate.width,
        height: candidate.height,
        duration: candidate.duration ?? candidate.file.duration,
        localPath: audioPath,
      }
      await recordTelegramAttachment(chatId, message.message_id, attachment)

      const transcription = await transcribeAudio(audioPath, {
        provider: this.config.telegram.transcriptionProvider,
        whisperModel: this.config.telegram.transcriptionWhisperModel,
        openAIModel: this.config.telegram.transcriptionOpenAIModel,
        timeoutMs: this.config.telegram.transcriptionTimeoutMs,
      })
      const transcribedText = transcription.text
      attachment.transcript = transcribedText
      attachment.transcriptPath = transcription.outputPath

      if (!transcribedText) {
        await this.sendMessage(chatId, "I couldn't transcribe the audio.")
        return
      }

      if (this.config.telegram.replyWithTranscript) {
        await this.sendTranscript(chatId, transcribedText, message.message_id)
      }

      const agentText = [
        caption,
        `Transcribed ${candidate.type} message:`,
        transcribedText,
      ]
        .filter(Boolean)
        .join('\n')

      // Log the transcribed voice message to chat log
      await appendChatLog({
        direction: 'in',
        text: `[${candidate.type} transcribed] ${agentText.slice(0, 500)}`,
        chatId,
        messageId: message.message_id,
        username: message.from?.username,
      })

      // Run the agent with the transcribed text
      const prompt = await buildTelegramAgentPromptWithMemory({
        chatId,
        messageId: message.message_id,
        from: message.from,
        text: agentText,
        attachments: [attachment],
      })
      const result = await this.runAgentWithProgress(
        chatId,
        prompt,
        `Running agent from transcribed ${candidate.type}`,
      )

      // Log the agent response
      await appendChatLog(buildAgentChatLogOutput(result, chatId))

      if (result.exitCode !== 0) {
        await recordTelegramError(chatId, 'agent-run-audio', result)
        await this.sendMessage(chatId, formatAgentFailureForTelegram(result))
        return
      }

      await this.deliverAgentText(chatId, result.text, '(No response generated)')
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      await recordTelegramError(chatId, 'audio-message', detail)
      const errorMessage = err && (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'Audio transcription unavailable. Install whisper: pip install openai-whisper (ffmpeg also required), or configure OpenAI transcription explicitly.'
        : `Error processing audio message: ${detail}`
      await this.sendMessage(chatId, errorMessage)
    }
  }

  private async handleTranscribeStatusCommand(chatId: string): Promise<void> {
    const tool = await detectTranscriptionTool(
      this.config.telegram.transcriptionProvider,
    )
    if (tool) {
      await this.sendMessage(
        chatId,
        [
          `Audio transcription is available (using ${tool}).`,
          `configured provider: ${this.config.telegram.transcriptionProvider}`,
          `whisper model: ${this.config.telegram.transcriptionWhisperModel}`,
          `timeout: ${this.config.telegram.transcriptionTimeoutMs}ms`,
          'Send voice messages, audio files, or audio documents and they will be transcribed before the agent runs.',
        ].join('\n'),
      )
    } else {
      await this.sendMessage(
        chatId,
        'Audio transcription is NOT available.\nInstall whisper: pip install openai-whisper (ffmpeg also required in PATH), install parakeet-mlx, or set transcriptionProvider=openai with OPENAI_API_KEY.',
      )
    }
  }

  private async handleProviderCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const body = commandBody.trim()
    if (!body || ['show', 'status'].includes(body.toLowerCase())) {
      const profile = await loadProviderProfile()
      await this.sendMessage(chatId, formatProviderProfile(profile))
      return
    }

    if (body.toLowerCase() === 'models') {
      const profile = await loadProviderProfile()
      const result = await loadProviderModels(profile)
      await this.sendMessage(chatId, result)
      return
    }

    if (body.toLowerCase().startsWith('set ')) {
      const parsed = parseProviderSetCommand(body.slice(4))
      if (!parsed) {
        await this.sendMessage(
          chatId,
          'Usage: /provider set <provider> <model> [base_url] [api_key]',
        )
        return
      }
      const previous = await loadProviderProfile()
      const profile = normalizeProviderProfile({
        provider: parsed.provider,
        model: parsed.model,
        baseUrl: parsed.baseUrl || previous.baseUrl,
        apiKey: parsed.apiKey || previous.apiKey,
      })
      await saveProviderProfile(profile)
      await this.sendMessage(
        chatId,
        [
          'Provider updated for next agent runs.',
          '',
          formatProviderProfile(profile),
          '',
          'Use /restart if you need to restart the long-lived gateway runtime; normal child agent runs pick this up from .env.',
        ].join('\n'),
      )
      return
    }

    await this.sendMessage(
      chatId,
      [
        'Provider commands:',
        '/provider - show current provider',
        '/provider models - load models from current OpenAI-compatible endpoint',
        '/provider set <provider> <model> [base_url] [api_key]',
        '/model <model>',
        '/baseurl <url>',
        '/apikey <key>',
      ].join('\n'),
    )
  }

  private async handleModelCommand(chatId: string, commandBody: string): Promise<void> {
    const model = commandBody.trim()
    if (!model) {
      await this.sendMessage(chatId, 'Usage: /model <model>')
      return
    }
    const profile = await loadProviderProfile()
    const next = normalizeProviderProfile({ ...profile, model })
    await saveProviderProfile(next)
    await this.sendMessage(chatId, `Model updated for next agent runs: ${next.model}`)
  }

  private async handleBaseUrlCommand(chatId: string, commandBody: string): Promise<void> {
    const baseUrl = commandBody.trim().replace(/\/+$/, '')
    if (!baseUrl) {
      await this.sendMessage(chatId, 'Usage: /baseurl <url>')
      return
    }
    const profile = await loadProviderProfile()
    const next = normalizeProviderProfile({ ...profile, baseUrl })
    await saveProviderProfile(next)
    await this.sendMessage(chatId, `Base URL updated for next agent runs: ${next.baseUrl}`)
  }

  private async handleApiKeyCommand(chatId: string, commandBody: string): Promise<void> {
    const apiKey = commandBody.trim()
    if (!apiKey) {
      await this.sendMessage(chatId, 'Usage: /apikey <key>')
      return
    }
    const profile = await loadProviderProfile()
    const next = normalizeProviderProfile({ ...profile, apiKey })
    await saveProviderProfile(next)
    await this.sendMessage(chatId, `API key updated for next agent runs: ${maskSecretForTelegram(next.apiKey)}`)
  }

  private async handleErrorsCommand(chatId: string, commandBody: string): Promise<void> {
    const limit = Math.min(20, Math.max(1, Number(commandBody.trim() || 5)))
    const errors = await loadTelegramErrorLog(chatId, limit)
    if (errors.length === 0) {
      await this.sendMessage(chatId, 'No recorded errors for this chat.')
      return
    }
    await this.sendMessage(
      chatId,
      errors.map(formatTelegramErrorLogEntry).join('\n\n'),
    )
  }

  private async sendTranscript(
    chatId: string,
    text: string,
    replyToMessageId: number,
  ): Promise<void> {
    const header = 'Transcript:'
    const fullText = `${header}\n${text}`
    const chunks = splitTelegramText(fullText)
    for (let i = 0; i < chunks.length; i++) {
      await this.callTelegram('sendMessage', {
        chat_id: chatId,
        text: chunks[i]!,
        disable_web_page_preview: true,
        ...(i === 0 && replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      })
    }
  }

  private async handleCronCommand(chatId: string, commandBody: string): Promise<void> {
    const [rawSubcommand] = commandBody.split(/\s+/, 1)
    const subcommand = (rawSubcommand || 'list').toLowerCase()

    if (subcommand === 'list') {
      await this.handleJobsCommand(chatId)
      return
    }

    if (subcommand === 'reload') {
      const ticked = await getAgentGatewayRuntime()?.cron?.tick()
      await this.sendMessage(
        chatId,
        ticked === undefined
          ? 'Cron scheduler is not running.'
          : `Cron scheduler reloaded. Due jobs run now: ${ticked}.`,
      )
      return
    }

    if (subcommand === 'chatid') {
      await this.sendMessage(chatId, `Chat ID: ${chatId}`)
      return
    }

    if (subcommand === 'path') {
      await this.sendMessage(chatId, `Cron jobs file:\n${getCronJobsPath()}`)
      return
    }

    if (subcommand === 'examples') {
      await this.sendMessage(
        chatId,
        [
          'Cron examples:',
          '/schedule every 30m | check project status',
          '/schedule */15 * * * * | summarize git status',
          '/schedule */10 * * * * * | quick heartbeat every 10 seconds',
          '/schedule 2030-01-02T03:04:05Z | one-shot task',
        ].join('\n'),
      )
      return
    }

    await this.sendMessage(chatId, 'Usage: /cron [list|reload|chatid|path|examples]')
  }

  private async handleScheduleCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const separator = commandBody.indexOf('|')
    if (separator === -1) {
      await this.sendMessage(
        chatId,
        'Usage: /schedule every 1h | prompt for the agent',
      )
      return
    }

    const schedule = commandBody.slice(0, separator).trim()
    const prompt = commandBody.slice(separator + 1).trim()
    if (!schedule || !prompt) {
      await this.sendMessage(
        chatId,
        'Usage: /schedule every 1h | prompt for the agent',
      )
      return
    }

    try {
      const job = await createCronJob({
        name: prompt.slice(0, 50),
        prompt,
        schedule,
        deliver: 'origin',
        origin: { platform: 'telegram', chatId },
      })
      await this.sendMessage(
        chatId,
        `Scheduled job ${job.id}: ${job.scheduleDisplay}`,
      )
    } catch (error) {
      await this.sendMessage(chatId, `Could not schedule job: ${String(error)}`)
    }
  }

  private async handleJobsCommand(chatId: string): Promise<void> {
    const jobs = (await listCronJobs(true)).filter(
      job => job.origin?.platform === 'telegram' && job.origin.chatId === chatId,
    )
    if (jobs.length === 0) {
      await this.sendMessage(chatId, 'No jobs for this chat.')
      return
    }

    await this.sendMessage(
      chatId,
      jobs
        .map(job =>
          [
            `${job.id} - ${job.name}`,
            `state: ${job.state}`,
            `schedule: ${job.scheduleDisplay}`,
            `next: ${job.nextRunAt ?? 'none'}`,
          ].join('\n'),
        )
        .join('\n\n'),
    )
  }

  private async handleFilesCommand(chatId: string): Promise<void> {
    const files = await listTelegramStoredFiles(chatId, 10)
    if (files.length === 0) {
      await this.sendMessage(chatId, 'No downloaded files for this chat.')
      return
    }

    await this.sendMessage(
      chatId,
      files
        .map(file =>
          [
            `${file.createdAt} - ${file.type}`,
            file.fileName ? `name: ${file.fileName}` : undefined,
            file.mimeType ? `mime: ${file.mimeType}` : undefined,
            file.size ? `size: ${file.size} bytes` : undefined,
            `path: ${file.localPath}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n\n'),
    )
  }

  private async handleRunJobCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const jobId = commandBody.trim()
    if (!jobId) {
      await this.sendMessage(chatId, 'Usage: /runjob <job-id>')
      return
    }

    const existing = await getCronJob(jobId)
    if (
      !existing ||
      existing.origin?.platform !== 'telegram' ||
      existing.origin.chatId !== chatId
    ) {
      await this.sendMessage(chatId, 'Job not found for this chat.')
      return
    }

    await this.sendMessage(chatId, `Running job ${existing.id} now...`)
    const job = await runCronJobNow(jobId, this.config, async content => {
      await this.deliverAgentText(
        chatId,
        `Cronjob Response: ${existing.name}\n-----------\n\n${content}`,
      )
    })
    if (!job) {
      await this.sendMessage(chatId, 'Job disappeared before it could run.')
      return
    }

    if (job.lastStatus === 'error') {
      await this.sendMessage(chatId, `Job ${job.id} failed: ${job.lastError || 'unknown error'}`)
      return
    }

    await this.sendMessage(
      chatId,
      job.lastOutputFile
        ? `Job ${job.id} finished. Output saved: ${job.lastOutputFile}`
        : `Job ${job.id} finished.`,
    )
  }

  private async handleDeleteJobCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const jobId = commandBody.trim()
    if (!jobId) {
      await this.sendMessage(chatId, 'Usage: /deletejob <job-id>')
      return
    }

    const existing = await getCronJob(jobId)
    if (
      !existing ||
      existing.origin?.platform !== 'telegram' ||
      existing.origin.chatId !== chatId
    ) {
      await this.sendMessage(chatId, 'Job not found for this chat.')
      return
    }

    const deleted = await deleteCronJob(jobId)
    if (deleted) {
      await this.sendMessage(chatId, `Job ${jobId} deleted.`)
    } else {
      await this.sendMessage(chatId, `Failed to delete job ${jobId}.`)
    }
  }

  private async handlePauseJobCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const jobId = commandBody.trim()
    if (!jobId) {
      await this.sendMessage(chatId, 'Usage: /pausejob <job-id>')
      return
    }

    const existing = await getCronJob(jobId)
    if (
      !existing ||
      existing.origin?.platform !== 'telegram' ||
      existing.origin.chatId !== chatId
    ) {
      await this.sendMessage(chatId, 'Job not found for this chat.')
      return
    }

    const job = await pauseCronJob(jobId)
    if (job) {
      await this.sendMessage(chatId, `Job ${jobId} paused.`)
    } else {
      await this.sendMessage(chatId, `Failed to pause job ${jobId}.`)
    }
  }

  private async handleResumeJobCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const jobId = commandBody.trim()
    if (!jobId) {
      await this.sendMessage(chatId, 'Usage: /resumejob <job-id>')
      return
    }

    const existing = await getCronJob(jobId)
    if (
      !existing ||
      existing.origin?.platform !== 'telegram' ||
      existing.origin.chatId !== chatId
    ) {
      await this.sendMessage(chatId, 'Job not found for this chat.')
      return
    }

    const job = await resumeCronJob(jobId)
    if (job) {
      await this.sendMessage(chatId, `Job ${jobId} resumed.`)
    } else {
      await this.sendMessage(chatId, `Failed to resume job ${jobId}.`)
    }
  }

  private async handleStatusCommand(chatId: string): Promise<void> {
    const runtime = getAgentGatewayRuntime()
    const jobs = await listCronJobs(true)
    const chatJobs = jobs.filter(
      job => job.origin?.platform === 'telegram' && job.origin.chatId === chatId,
    )
    const evolution = await loadEvolutionState()
    const consciousness = runtime?.consciousness
    const uptimeMs = runtime ? Date.now() - runtime.startedAt : 0

    const lines = [
      'OpenClaude gateway status',
      '',
      `Runtime: ${runtime ? `running for ${formatDuration(uptimeMs)}` : 'stopped'}`,
      `API: ${runtime?.api ? 'running' : this.config.api.enabled ? 'configured' : 'off'}`,
      `Telegram: ${runtime?.telegram ? 'running' : this.config.telegram.enabled ? 'configured' : 'off'}`,
      `Cron: ${runtime?.cron ? 'running' : this.config.cron.enabled ? 'configured' : 'off'}`,
      `Active Telegram tasks: ${this.activeTasks.size}`,
      `Cron jobs for this chat: ${chatJobs.length} (${chatJobs.filter(job => job.enabled).length} enabled)`,
      '',
      `Ouroboros: ${this.config.ouroboros.enabled ? 'enabled' : 'off'}`,
      `Background consciousness: ${consciousness ? 'running' : this.config.ouroboros.consciousnessEnabled ? 'configured' : 'off'}`,
      consciousness ? `Next wakeup: ${consciousness.getNextWakeupSec()}s` : undefined,
      consciousness ? `Budget spent: $${consciousness.getBudgetSpent().toFixed(4)}` : undefined,
      `Evolution mode: ${evolution.enabled ? 'ON' : 'OFF'}`,
      `Evolution cycles: ${evolution.totalCyclesCompleted}`,
      evolution.lastCycleAt ? `Last evolution: ${evolution.lastCycleAt.slice(0, 16)} (${evolution.lastCycleType})` : 'Last evolution: never',
    ].filter(Boolean) as string[]

    await this.sendMessage(chatId, lines.join('\n'))
  }

  private async handlePanicCommand(chatId: string): Promise<void> {
    for (const task of this.activeTasks.values()) {
      task.progress?.dispose()
      task.controller.abort()
    }
    this.activeTasks.clear()
    await this.sendMessage(chatId, 'PANIC: active tasks aborted. Stopping gateway runtime.')
    await this.acknowledgeTelegramUpdates()
    await stopAgentGateway()
  }

  private async handleRestartCommand(chatId: string): Promise<void> {
    for (const task of this.activeTasks.values()) {
      task.progress?.dispose()
      task.controller.abort()
    }
    this.activeTasks.clear()
    await this.sendMessage(chatId, 'Restarting gateway runtime.')
    await this.acknowledgeTelegramUpdates()
    await restartAgentGateway()
    await this.sendMessage(chatId, 'Gateway runtime restarted.')
  }

  private async handleBgCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const action = commandBody.trim().toLowerCase() || 'status'
    if (['start', 'on', '1'].includes(action)) {
      await updateAgentGatewayConfig(current => ({
        ...current,
        ouroboros: {
          ...current.ouroboros,
          enabled: true,
          consciousnessEnabled: true,
        },
      }))
      await this.sendMessage(chatId, 'Background consciousness: starting.')
      await this.acknowledgeTelegramUpdates()
      const runtime = await restartAgentGateway()
      runtime?.consciousness?.resume()
      await this.sendMessage(chatId, 'Background consciousness: running.')
      return
    }

    if (['stop', 'off', '0'].includes(action)) {
      getAgentGatewayRuntime()?.consciousness?.pause()
      await updateAgentGatewayConfig(current => ({
        ...current,
        ouroboros: {
          ...current.ouroboros,
          consciousnessEnabled: false,
        },
      }))
      await this.sendMessage(chatId, 'Background consciousness: stopping.')
      await this.acknowledgeTelegramUpdates()
      await restartAgentGateway()
      await this.sendMessage(chatId, 'Background consciousness: stopped.')
      return
    }

    await this.handleConsciousnessCommand(chatId)
  }

  private async handleEvolveCommand(
    chatId: string,
    commandBody: string,
  ): Promise<void> {
    const action = commandBody.trim().toLowerCase() || 'on'

    if (['stop', 'off', '0'].includes(action)) {
      await this.handleEvolutionToggleCommand(chatId, false)
      return
    }

    if (['now', 'run', 'once'].includes(action)) {
      await this.handleEvolveNowCommand(chatId)
      return
    }

    if (['status', 'state'].includes(action)) {
      await this.handleEvolutionCommand(chatId)
      return
    }

    await this.handleEvolutionToggleCommand(chatId, true)
  }

  private async handleReviewCommand(chatId: string): Promise<void> {
    await this.runEvolutionCommandCycle(chatId, 'architecture_review', 'Running deep architecture review')
  }

  private async runEvolutionCommandCycle(
    chatId: string,
    type: EvolutionType | undefined,
    phase: string,
  ): Promise<void> {
    const state = await loadEvolutionState()
    if (!state.enabled) {
      await toggleEvolution(true)
    }

    if (this.activeTasks.has(chatId)) {
      await this.sendMessage(chatId, 'A task is already running. Use /stop first.')
      return
    }

    const controller = new AbortController()
    const progress = await this.createTaskProgress(chatId, phase, controller.signal)
    this.activeTasks.set(chatId, { controller, messageId: progress.messageId, progress })
    try {
      const result = await runEvolutionCycle(this.config, type, {
        signal: controller.signal,
        onProgress: event => progress.addEvent(event),
        onStdout: chunk => progress.observeStdout(chunk),
      })
      this.activeTasks.delete(chatId)
      if (controller.signal.aborted) {
        progress.dispose()
        return
      }
      if (!result) {
        await progress.finish('failed', 'Evolution cycle returned no result.')
        await this.sendMessage(chatId, 'Evolution cycle returned no results.')
        return
      }

      progress.addEvent(`evolution: ${result.type}`)
      await progress.finish('completed', 'Evolution cycle finished.')
      await this.sendEvolutionResult(chatId, result)
    } catch (error) {
      this.activeTasks.delete(chatId)
      await progress.finish('failed', 'Evolution cycle failed.')
      await recordTelegramError(chatId, 'evolution-cycle', error)
      await this.sendMessage(chatId, error instanceof Error ? error.message : String(error))
    } finally {
      this.activeTasks.delete(chatId)
    }
  }

  private async sendEvolutionResult(
    chatId: string,
    result: EvolutionResult,
  ): Promise<void> {
    const lines = [
      `Evolution: ${result.type}`,
      `Summary: ${result.summary}`,
    ]
    if (result.insights.length > 0) {
      lines.push('')
      lines.push('Insights:')
      for (const insight of result.insights.slice(0, 5)) {
        lines.push(`- ${insight.slice(0, 200)}`)
      }
    }
    if (result.changes.length > 0) {
      lines.push('')
      lines.push('Changes:')
      for (const change of result.changes.slice(0, 5)) {
        lines.push(`- ${change.slice(0, 200)}`)
      }
    }

    await this.sendMessage(chatId, lines.join('\n'))
  }

  private async handleConsciousnessCommand(chatId: string): Promise<void> {
    const runtime = getAgentGatewayRuntime()
    const consciousness = runtime?.consciousness
    const configured =
      Boolean(runtime?.config.ouroboros.enabled) &&
      Boolean(runtime?.config.ouroboros.consciousnessEnabled)

    const lines: string[] = []

    if (consciousness) {
      lines.push('Background consciousness is running.')
      lines.push(`Next wakeup: ${consciousness.getNextWakeupSec()}s`)
      lines.push(`Budget spent: $${consciousness.getBudgetSpent().toFixed(4)}`)
    } else {
      lines.push(
        configured
          ? 'Background consciousness is configured but not running.'
          : 'Background consciousness is disabled. Enable it in /agent-gateway.',
      )
    }

    // Show memory stats
    const blocks = await loadScratchpadBlocks()
    const identity = await loadIdentity()
    const patterns = await loadPatterns()
    const reflections = await loadRecentReflections(3)

    lines.push('')
    lines.push(`Scratchpad: ${blocks.length} blocks`)
    lines.push(`Identity: ${identity.length} chars`)
    lines.push(`Pattern register: ${patterns.length} chars`)
    lines.push(`Recent reflections: ${reflections.length}`)

    await this.sendMessage(chatId, lines.join('\n'))
  }

  private async handleConsciousnessControlCommand(
    chatId: string,
    action: 'start' | 'stop',
  ): Promise<void> {
    const runtime = getAgentGatewayRuntime()
    const consciousness = runtime?.consciousness

    if (action === 'start') {
      if (consciousness) {
        consciousness.resume()
        await this.sendMessage(chatId, 'Background consciousness resumed.')
      } else {
        await this.sendMessage(chatId, 'Cannot start consciousness - enable Ouroboros consciousness in /agent-gateway and restart the gateway.')
      }
    } else {
      if (consciousness) {
        consciousness.pause()
        await this.sendMessage(chatId, 'Background consciousness paused.')
      } else {
        await this.sendMessage(chatId, 'Consciousness is not running.')
      }
    }
  }

  private async handleEvolutionCommand(chatId: string): Promise<void> {
    const status = await getEvolutionStatus()
    await this.sendMessage(
      chatId,
      `${status}\n\nCommands:\n/evolution on - enable self-improvement cycles\n/evolution off - disable evolution\n/evolve - start autonomous evolution mode\n/evolve stop - stop evolution mode\n/evolve now - run one evolution cycle now\n/review - run a deep review cycle`,
    )
  }

  private async handleEvolutionToggleCommand(
    chatId: string,
    enabled: boolean,
  ): Promise<void> {
    const state = await toggleEvolution(enabled)
    await this.sendMessage(
      chatId,
      `Evolution mode: ${enabled ? 'ON' : 'OFF'}\nTotal cycles completed: ${state.totalCyclesCompleted}`,
    )
  }

  private async handleEvolveNowCommand(chatId: string): Promise<void> {
    const state = await loadEvolutionState()
    if (!state.enabled) {
      await this.sendMessage(chatId, 'Evolution mode is OFF. Enable with /evolution on first.')
      return
    }

    await this.runEvolutionCommandCycle(chatId, undefined, 'Running evolution cycle')
  }

  private async handleIdentityCommand(chatId: string): Promise<void> {
    const identity = await loadIdentity()
    const dialogueBlocks = await loadDialogueBlocks()
    const state = await loadEvolutionState()

    const lines = [
      '## Identity',
      '',
      identity.slice(0, 3000),
      '',
      `Dialogue blocks: ${dialogueBlocks.length}`,
      `Evolution cycles: ${state.totalCyclesCompleted}`,
    ]

    await this.sendMessage(chatId, lines.join('\n'))
  }

  private async handleScratchpadCommand(chatId: string): Promise<void> {
    const blocks = await loadScratchpadBlocks()

    if (blocks.length === 0) {
      await this.sendMessage(chatId, 'Scratchpad is empty.')
      return
    }

    const lines = [`## Scratchpad (${blocks.length} blocks)\n`]
    for (const block of [...blocks].reverse()) {
      const ts = block.ts.slice(0, 16)
      lines.push(`### [${ts} — ${block.source}]`)
      lines.push(block.content.slice(0, 1500))
      lines.push('---')
    }

    await this.sendMessage(chatId, lines.join('\n'))
  }

  private async handleBibleCommand(chatId: string): Promise<void> {
    const { loadBible } = await import('./memory.js')
    const bible = await loadBible()
    if (!bible) {
      await this.sendMessage(chatId, 'BIBLE.md not found.')
      return
    }
    // Send in chunks (Telegram 4096 char limit)
    const chunks = splitTelegramText(bible.slice(0, 10000))
    for (const chunk of chunks) {
      await this.sendMessage(chatId, chunk)
    }
  }

  private async handleArchitectureCommand(chatId: string): Promise<void> {
    const { loadArchitecture } = await import('./memory.js')
    const arch = await loadArchitecture()
    if (!arch) {
      await this.sendMessage(chatId, 'ARCHITECTURE.md not found.')
      return
    }
    const chunks = splitTelegramText(arch.slice(0, 10000))
    for (const chunk of chunks) {
      await this.sendMessage(chatId, chunk)
    }
  }

  private async handleGitStatusCommand(chatId: string): Promise<void> {
    try {
      const status = await gitStatus()
      await this.sendMessage(chatId, status || 'Working tree clean.')
    } catch (err) {
      await this.sendMessage(chatId, `Git error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleGitLogCommand(chatId: string): Promise<void> {
    try {
      const log = await gitLog(15)
      await this.sendMessage(chatId, log || 'No commits yet.')
    } catch (err) {
      await this.sendMessage(chatId, `Git error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleGitDiffCommand(chatId: string, path: string): Promise<void> {
    try {
      const diff = await gitDiff(path || undefined)
      if (!diff) {
        await this.sendMessage(chatId, 'No uncommitted changes.')
        return
      }
      const chunks = splitTelegramText(diff.slice(0, 4000))
      for (const chunk of chunks) {
        await this.sendMessage(chatId, chunk)
      }
    } catch (err) {
      await this.sendMessage(chatId, `Git error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleGitCommitCommand(chatId: string, message: string): Promise<void> {
    if (!message.trim()) {
      await this.sendMessage(chatId, 'Usage: /git commit <message>')
      return
    }
    try {
      const result = await gitCommit(message.trim())
      if (result.success) {
        await this.sendMessage(chatId, `Committed: ${message.trim()}`)
      } else {
        await this.sendMessage(chatId, `Commit failed: ${result.error}`)
      }
    } catch (err) {
      await this.sendMessage(chatId, `Git error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // -----------------------------------------------------------------------
  // Stop / Retry / Undo
  // -----------------------------------------------------------------------

  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    // Answer the callback query first to remove the loading state
    await this.callTelegram('answerCallbackQuery', {
      callback_query_id: query.id,
    })

    const data = query.data || ''

    // stop:<chatId>
    if (data.startsWith('stop:')) {
      const chatId = data.slice(5)
      await this.stopTask(chatId)
    }
  }

  private async handleStopCommand(chatId: string): Promise<void> {
    await this.stopTask(chatId)
  }

  private async stopTask(chatId: string): Promise<void> {
    const task = this.activeTasks.get(chatId)
    if (!task) {
      await this.sendMessage(chatId, 'No active task to stop.')
      return
    }

    task.controller.abort()
    task.progress?.dispose()
    this.activeTasks.delete(chatId)

    // Edit the "thinking" message to show it was stopped
    try {
      await this.callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: task.messageId,
        text: '⏹ Task stopped by user.',
      })
    } catch {
      // Message may have already been replaced
    }

    await this.sendMessage(chatId, 'Task stopped. Send a new message to start fresh.')
  }

  private async handleRetryCommand(chatId: string): Promise<void> {
    const last = this.lastPrompts.get(chatId)
    if (!last) {
      await this.sendMessage(chatId, 'Nothing to retry — no previous task found.')
      return
    }

    // Check if a task is already running
    if (this.activeTasks.has(chatId)) {
      await this.sendMessage(chatId, 'A task is already running. Use /stop first.')
      return
    }

    const result = await this.runAgentWithProgress(
      chatId,
      last.prompt,
      'Retrying last task',
    )

    if (result.exitCode !== 0) {
      await recordTelegramError(chatId, 'agent-run-retry', result)
      await this.sendMessage(chatId, formatAgentFailureForTelegram(result))
      return
    }

    await this.deliverAgentText(chatId, result.text, '(No response generated)')
  }

  private async handleInfiniteTaskCommand(
    chatId: string,
    goal: string,
  ): Promise<void> {
    const trimmedGoal = goal.trim()
    if (!trimmedGoal) {
      await this.sendMessage(chatId, 'Usage: /infinite <goal>')
      return
    }
    if (!this.config.ouroboros.enabled || !this.config.ouroboros.infiniteTasksEnabled) {
      await this.sendMessage(chatId, 'Infinite task mode is disabled. Enable it in /agent-gateway first.')
      return
    }
    if (this.activeTasks.has(chatId)) {
      await this.sendMessage(chatId, 'A task is already running. Use /stop first.')
      return
    }

    const taskId = `task_${randomUUID().replace(/-/g, '')}`
    const controller = new AbortController()
    const progress = await this.createTaskProgress(
      chatId,
      `Running infinite task ${taskId}`,
      controller.signal,
    )
    this.activeTasks.set(chatId, { controller, messageId: progress.messageId, progress })
    const consciousness = getAgentGatewayRuntime()?.consciousness
    consciousness?.pause()
    consciousness?.injectObservation(`Infinite task started: ${trimmedGoal.slice(0, 300)}`)
    progress.addEvent(`infinite task: ${taskId}`)

    try {
      const state = await runInfiniteTask(taskId, trimmedGoal, this.config, {
        signal: controller.signal,
        maxIterations: 20,
        onCancelled: () => controller.signal.aborted,
        onAgentProgress: event => {
          const active = this.activeTasks.get(chatId)?.progress
          active?.addEvent(event)
        },
        onProgress: async progress => {
          const last = progress.history.at(-1)
          const active = this.activeTasks.get(chatId)?.progress
          active?.setPhase(`Infinite task iteration ${progress.iterations}/${progress.maxIterations}`)
          if (last?.lesson) {
            active?.addEvent(`lesson: ${last.lesson.slice(0, 120)}`)
          }
          active?.addEvent(`next strategy: ${progress.currentStrategy.slice(0, 120)}`)
        },
      })

      const last = state.history.at(-1)
      const lines = [
        `Infinite task ${state.status}: ${taskId}`,
        `Iterations: ${state.iterations}/${state.maxIterations}`,
        state.completedAt ? `Completed at: ${state.completedAt}` : '',
        '',
        last?.text
          ? last.text.slice(0, 3000)
          : state.currentStrategy,
      ].filter(Boolean)
      if (state.status === 'completed') {
        await progress.finish('completed', 'Infinite task finished.')
      } else if (state.status === 'cancelled') {
        progress.dispose()
      } else {
        await progress.finish('failed', 'Infinite task stopped before completion.')
      }
      await this.deliverAgentText(chatId, lines.join('\n'), 'Infinite task finished.')
    } finally {
      consciousness?.injectObservation(`Infinite task stopped: ${trimmedGoal.slice(0, 300)}`)
      consciousness?.resume()
      progress.dispose()
      this.activeTasks.delete(chatId)
    }
  }

  private async handleUndoCommand(chatId: string): Promise<void> {
    // /undo = revert the last git commit
    try {
      const { gitReset } = await import('./selfEdit.js')
      const result = await gitReset(true)
      if (result.success) {
        await this.sendMessage(chatId, 'Last commit reverted (hard reset).')
      } else {
        await this.sendMessage(chatId, `Undo failed: ${result.error}`)
      }
    } catch (err) {
      await this.sendMessage(chatId, `Undo error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async deliverAgentText(
    chatId: string,
    text: string,
    fallback?: string,
  ): Promise<void> {
    const parsed = extractTelegramSendDirectives(text)
    if (parsed.text.trim()) {
      await this.sendMessage(chatId, parsed.text)
    }

    for (const directive of parsed.directives) {
      try {
        await this.sendFile(
          chatId,
          directive.path,
          directive.caption,
          directive.kind,
        )
      } catch (error) {
        await this.sendMessage(
          chatId,
          `Could not send ${directive.path}: ${String(error)}`,
        )
      }
    }

    if (!parsed.text.trim() && parsed.directives.length === 0 && fallback) {
      await this.sendMessage(chatId, fallback)
    }
  }

  private async collectAttachments(
    message: TelegramMessage,
    chatId: string,
  ): Promise<TelegramAttachment[]> {
    const candidates = getAttachmentCandidates(message)
    const attachments: TelegramAttachment[] = []

    for (const candidate of candidates) {
      const attachment: TelegramAttachment = {
        type: candidate.type,
        fileId: candidate.file.file_id,
        fileName: candidate.file.file_name,
        mimeType: candidate.file.mime_type,
        size: candidate.file.file_size,
        width: candidate.width,
        height: candidate.height,
        duration: candidate.duration ?? candidate.file.duration,
      }

      if (this.config.telegram.downloadFiles) {
        try {
          attachment.localPath = await this.downloadTelegramFile(
            candidate,
            chatId,
            message.message_id,
          )
          await recordTelegramAttachment(chatId, message.message_id, attachment)
        } catch (error) {
          attachment.downloadError = String(error)
        }
      }

      attachments.push(attachment)
    }

    return attachments
  }

  private async downloadTelegramFile(
    candidate: IncomingAttachmentCandidate,
    chatId: string,
    messageId: number,
  ): Promise<string> {
    const maxBytes = this.config.telegram.maxDownloadBytes
    if (candidate.file.file_size && candidate.file.file_size > maxBytes) {
      throw new Error(
        `file is larger than maxDownloadBytes (${candidate.file.file_size} > ${maxBytes})`,
      )
    }

    const fileInfo = await this.getTelegramFile(candidate.file.file_id)
    if (!fileInfo.file_path) {
      throw new Error('Telegram did not return file_path')
    }
    if (fileInfo.file_size && fileInfo.file_size > maxBytes) {
      throw new Error(
        `file is larger than maxDownloadBytes (${fileInfo.file_size} > ${maxBytes})`,
      )
    }

    const token = this.config.telegram.botToken
    if (!token) throw new Error('Telegram bot token is not configured')

    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`,
    )
    if (!response.ok) {
      throw new Error(`download failed with HTTP ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `file is larger than maxDownloadBytes (${buffer.byteLength} > ${maxBytes})`,
      )
    }

    const fileName = buildTelegramDownloadFileName(candidate, fileInfo)
    const dir = join(
      getAgentGatewayStateDir(),
      'telegram-files',
      safeTelegramFileName(chatId),
      String(messageId),
    )
    await mkdir(dir, { recursive: true })
    const localPath = join(dir, fileName)
    await writeFile(localPath, buffer)
    return localPath
  }

  private async getTelegramFile(fileId: string): Promise<TelegramGetFileResult> {
    const data = await this.callTelegram<TelegramGetFileResult>('getFile', {
      file_id: fileId,
    })
    return data
  }

  private async sendMultipart(
    method: 'sendDocument' | 'sendPhoto',
    chatId: string,
    fieldName: 'document' | 'photo',
    filePath: string,
    caption?: string,
  ): Promise<void> {
    const token = this.config.telegram.botToken
    if (!token) return

    const body = new FormData()
    body.append('chat_id', chatId)
    if (caption) body.append('caption', caption.slice(0, 1024))
    const fileBytes = await readFile(filePath)
    body.append(
      fieldName,
      new Blob([fileBytes]),
      basename(filePath),
    )

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body,
    })
    const data = await response.json() as TelegramApiResponse<unknown>
    if (!response.ok || !data.ok) {
      throw new Error(data.description || `Telegram ${method} failed`)
    }
  }

  private async callTelegram<T = unknown>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const token = this.config.telegram.botToken
    if (!token) throw new Error('Telegram bot token is not configured')

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json() as TelegramApiResponse<T>
    if (!response.ok || !data.ok) {
      throw new Error(data.description || `Telegram ${method} failed`)
    }
    return data.result as T
  }

  private isMessageAllowed(message: TelegramMessage, chatId: string): boolean {
    const allowedChats = new Set([
      ...this.config.telegram.allowedChatIds,
      ...(this.config.telegram.homeChatId ? [this.config.telegram.homeChatId] : []),
    ])
    const allowedUsers = new Set(this.config.telegram.allowedUserIds)

    if (allowedChats.size === 0 && allowedUsers.size === 0) {
      return true
    }

    if (allowedChats.has(chatId)) {
      return true
    }

    const userId = message.from?.id === undefined ? '' : String(message.from.id)
    return Boolean(userId && allowedUsers.has(userId))
  }
}

type TelegramProgressStatus = 'running' | 'completed' | 'failed' | 'stopped'

function formatAgentFailurePhase(result: AgentRunResult): string {
  if (result.timedOut) {
    return `Timed out after ${formatDuration(result.durationMs || 0)}. Diagnostic sent below.`
  }
  return 'Agent run failed. Diagnostic sent below.'
}

function formatAgentFailureForTelegram(result: AgentRunResult): string {
  const lines = ['Agent run failed.']

  if (result.timedOut) {
    lines.push(`Timed out after ${formatDuration(result.durationMs || 0)}.`)
  } else {
    lines.push(`Exit code: ${result.exitCode}`)
  }

  if (result.failureKind) {
    lines.push(`Failure kind: ${result.failureKind}`)
  }

  if (result.diagnostic) {
    lines.push('', 'Diagnostic:', result.diagnostic.slice(0, 1500))
  }

  const activity = result.activity?.slice(-10) || []
  if (activity.length > 0 && !result.diagnostic?.includes('Recent activity:')) {
    lines.push('', 'Last activity:')
    for (const event of activity) {
      lines.push(`- ${event}`)
    }
  }

  const stderr = result.stderr.trim()
  if (stderr) {
    lines.push('', 'Error:', stderr.slice(0, 2500))
  } else {
    lines.push('', 'Error: no stderr was captured.')
  }

  return lines.join('\n').slice(0, 3900)
}

function buildAgentChatLogOutput(
  result: AgentRunResult,
  chatId: string,
): Record<string, unknown> {
  const activity = result.activity?.slice(-20) || []
  const failureSummary = result.exitCode === 0
    ? ''
    : [
        result.timedOut ? `Timed out after ${formatDuration(result.durationMs || 0)}.` : `Exit code: ${result.exitCode}.`,
        result.stderr ? `Error: ${result.stderr.slice(0, 1200)}` : 'Error: no stderr was captured.',
        activity.length ? `Last activity: ${activity.join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')

  return {
    direction: 'out',
    text: (result.exitCode === 0 ? result.text : result.text || failureSummary).slice(0, 2000),
    chatId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    failureKind: result.failureKind,
    diagnostic: result.diagnostic?.slice(0, 2000),
    stderr: result.stderr.slice(0, 2000),
    activity,
  }
}

type AgentProviderProfile = {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

type ProviderInfo = {
  value: string
  flag: 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'github'
  baseUrl?: string
  apiKey?: string
}

const TELEGRAM_PROVIDER_PRESETS: ProviderInfo[] = [
  { value: 'openai-compatible', flag: 'openai' },
  { value: 'abacus', flag: 'openai', baseUrl: 'https://routellm.abacus.ai/v1' },
  { value: 'onlysq', flag: 'openai', baseUrl: 'https://api.onlysq.ru/ai/openai' },
  { value: 'openai', flag: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { value: 'openrouter', flag: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { value: 'deepseek', flag: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { value: 'groq', flag: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { value: 'ollama', flag: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama' },
  { value: 'lmstudio', flag: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-studio' },
  { value: 'anthropic', flag: 'anthropic' },
  { value: 'gemini', flag: 'gemini' },
  { value: 'mistral', flag: 'mistral' },
  { value: 'github', flag: 'github' },
]

function getTelegramProviderInfo(provider: string): ProviderInfo {
  return TELEGRAM_PROVIDER_PRESETS.find(item => item.value === provider) || TELEGRAM_PROVIDER_PRESETS[0]!
}

async function loadProviderProfile(): Promise<AgentProviderProfile> {
  const env = {
    ...process.env,
    ...(await readProjectEnvFile()),
  }
  let provider = env.OPENCLAUDE_PROVIDER || ''
  if (!provider) {
    if (env.CLAUDE_CODE_USE_GEMINI) provider = 'gemini'
    else if (env.CLAUDE_CODE_USE_MISTRAL) provider = 'mistral'
    else if (env.CLAUDE_CODE_USE_GITHUB) provider = 'github'
    else if (env.ANTHROPIC_API_KEY) provider = 'anthropic'
    else provider = 'openai-compatible'
  }
  const info = getTelegramProviderInfo(provider)
  const isOpenAI = info.flag === 'openai'
  return normalizeProviderProfile({
    provider,
    baseUrl:
      env.OPENCLAUDE_BASE_URL ||
      (isOpenAI ? env.OPENAI_BASE_URL : env[`${info.flag.toUpperCase()}_BASE_URL`]) ||
      info.baseUrl ||
      '',
    model:
      env.OPENCLAUDE_MODEL ||
      (isOpenAI ? env.OPENAI_MODEL : env[`${info.flag.toUpperCase()}_MODEL`]) ||
      '',
    apiKey:
      env.OPENCLAUDE_API_KEY ||
      (isOpenAI ? env.OPENAI_API_KEY : env[`${info.flag.toUpperCase()}_API_KEY`]) ||
      info.apiKey ||
      '',
  })
}

function normalizeProviderProfile(input: Partial<AgentProviderProfile>): AgentProviderProfile {
  const provider = String(input.provider || 'openai-compatible').trim().toLowerCase()
  const info = getTelegramProviderInfo(provider)
  return {
    provider,
    baseUrl: String(input.baseUrl || info.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(input.model || '').trim(),
    apiKey: String(input.apiKey || info.apiKey || '').trim(),
  }
}

async function saveProviderProfile(profile: AgentProviderProfile): Promise<void> {
  const updates = providerProfileEnv(profile)
  await updateProjectEnvFile(updates)
  for (const [key, value] of Object.entries(updates)) {
    if (value === '') delete process.env[key]
    else process.env[key] = value
  }
}

function providerProfileEnv(profile: AgentProviderProfile): Record<string, string> {
  const info = getTelegramProviderInfo(profile.provider)
  const updates: Record<string, string> = {
    OPENCLAUDE_RESPECT_PROVIDER_ENV: '1',
    OPENCLAUDE_PROVIDER: profile.provider,
    OPENCLAUDE_BASE_URL: profile.baseUrl,
    OPENCLAUDE_MODEL: profile.model,
    OPENCLAUDE_API_KEY: profile.apiKey,
    CLAUDE_CODE_USE_OPENAI: '',
    CLAUDE_CODE_USE_GEMINI: '',
    CLAUDE_CODE_USE_MISTRAL: '',
    CLAUDE_CODE_USE_GITHUB: '',
    OPENAI_BASE_URL: '',
    OPENAI_MODEL: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_MODEL: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_BASE_URL: '',
    GEMINI_MODEL: '',
    GEMINI_API_KEY: '',
    MISTRAL_BASE_URL: '',
    MISTRAL_MODEL: '',
    MISTRAL_API_KEY: '',
  }
  if (info.flag === 'openai') {
    updates.CLAUDE_CODE_USE_OPENAI = '1'
    updates.OPENAI_BASE_URL = profile.baseUrl
    updates.OPENAI_MODEL = profile.model
    updates.OPENAI_API_KEY = profile.apiKey
  } else if (info.flag === 'anthropic') {
    updates.ANTHROPIC_BASE_URL = profile.baseUrl
    updates.ANTHROPIC_MODEL = profile.model
    updates.ANTHROPIC_API_KEY = profile.apiKey
  } else if (info.flag === 'gemini') {
    updates.CLAUDE_CODE_USE_GEMINI = '1'
    updates.GEMINI_BASE_URL = profile.baseUrl
    updates.GEMINI_MODEL = profile.model
    updates.GEMINI_API_KEY = profile.apiKey
  } else if (info.flag === 'mistral') {
    updates.CLAUDE_CODE_USE_MISTRAL = '1'
    updates.MISTRAL_BASE_URL = profile.baseUrl
    updates.MISTRAL_MODEL = profile.model
    updates.MISTRAL_API_KEY = profile.apiKey
  } else if (info.flag === 'github') {
    updates.CLAUDE_CODE_USE_GITHUB = '1'
    updates.OPENAI_MODEL = profile.model
  }
  return updates
}

function parseProviderSetCommand(input: string): Partial<AgentProviderProfile> | null {
  const parts = splitCommandLike(input)
  if (parts.length < 2) return null
  return {
    provider: parts[0],
    model: parts[1],
    baseUrl: parts[2],
    apiKey: parts[3],
  }
}

function splitCommandLike(value: string): string[] {
  const parts: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g
  for (const match of value.matchAll(pattern)) {
    parts.push(match[1] ?? match[2] ?? match[0])
  }
  return parts
}

function formatProviderProfile(profile: AgentProviderProfile): string {
  return [
    'Active provider profile',
    `Provider: ${profile.provider}`,
    `Model: ${profile.model || 'not set'}`,
    `Base URL: ${profile.baseUrl || 'not set'}`,
    `API key: ${maskSecretForTelegram(profile.apiKey)}`,
  ].join('\n')
}

async function loadProviderModels(profile: AgentProviderProfile): Promise<string> {
  const info = getTelegramProviderInfo(profile.provider)
  if (info.flag !== 'openai') {
    return 'Model loading is implemented for OpenAI-compatible providers. Enter model manually with /model <model>.'
  }
  const errors: string[] = []
  for (const url of providerModelUrls(profile.baseUrl)) {
    try {
      const response = await fetch(url, {
        headers: profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {},
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`${response.status}: ${text || response.statusText}`)
      const data = JSON.parse(text) as { data?: Array<{ id?: string }> }
      const models = Array.isArray(data.data)
        ? data.data.map(item => item.id).filter(Boolean).sort()
        : []
      if (models.length === 0) throw new Error('provider returned no models')
      return [
        `Models from ${url}:`,
        ...models.slice(0, 80).map(model => `- ${model}`),
        models.length > 80 ? `...and ${models.length - 80} more` : '',
      ].filter(Boolean).join('\n')
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return `Could not load models.\n${errors.join('\n')}`
}

function providerModelUrls(baseUrl: string): string[] {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) return []
  return trimmed.endsWith('/v1')
    ? [`${trimmed}/models`, `${trimmed.replace(/\/v1$/, '')}/models`]
    : [`${trimmed}/v1/models`, `${trimmed}/models`]
}

async function readProjectEnvFile(): Promise<Record<string, string>> {
  try {
    return parseProjectEnv(await readFile(projectEnvPath(), 'utf8'))
  } catch {
    return {}
  }
}

async function updateProjectEnvFile(updates: Record<string, string>): Promise<void> {
  const file = projectEnvPath()
  let raw = ''
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    raw = ''
  }
  const lines = raw ? raw.split(/\r?\n/u) : []
  const seen = new Set<string>()
  const next = lines.map(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u)
    if (!match) return line
    const key = match[1]!
    if (!(key in updates)) return line
    seen.add(key)
    return `${key}=${quoteProjectEnv(updates[key])}`
  })
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${quoteProjectEnv(value)}`)
  }
  await writeFile(file, `${next.join('\n').replace(/\n+$/u, '')}\n`, 'utf8')
}

function projectEnvPath(): string {
  return join(process.cwd(), '.env')
}

function parseProjectEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function quoteProjectEnv(value: string | undefined): string {
  const text = String(value ?? '')
  if (!text) return ''
  if (/[\s#"'`$]/u.test(text)) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return text
}

function maskSecretForTelegram(value: string | undefined): string {
  if (!value) return 'not set'
  if (value.length <= 8) return 'set'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

type TelegramErrorLogEntry = {
  ts: string
  chatId: string
  source: string
  failureKind?: string
  exitCode?: number
  timedOut?: boolean
  message: string
  activity?: string[]
}

async function recordTelegramError(
  chatId: string,
  source: string,
  error: unknown,
): Promise<void> {
  try {
    const result = error as Partial<AgentRunResult>
    const entry: TelegramErrorLogEntry = {
      ts: new Date().toISOString(),
      chatId,
      source,
      failureKind: result.failureKind,
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : undefined,
      timedOut: typeof result.timedOut === 'boolean' ? result.timedOut : undefined,
      message: summarizeTelegramError(error),
      activity: Array.isArray(result.activity) ? result.activity.slice(-10) : undefined,
    }
    const dir = join(getAgentGatewayStateDir(), 'logs')
    await mkdir(dir, { recursive: true })
    await appendFile(
      join(dir, 'telegram-errors.jsonl'),
      `${JSON.stringify(entry)}\n`,
      'utf8',
    )
  } catch {
    // Error logging must never mask the original Telegram failure.
  }
}

async function loadTelegramErrorLog(
  chatId: string,
  limit: number,
): Promise<TelegramErrorLogEntry[]> {
  try {
    const raw = await readFile(
      join(getAgentGatewayStateDir(), 'logs', 'telegram-errors.jsonl'),
      'utf8',
    )
    return raw
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(line => JSON.parse(line) as TelegramErrorLogEntry)
      .filter(entry => entry.chatId === chatId)
      .slice(-limit)
      .reverse()
  } catch {
    return []
  }
}

function summarizeTelegramError(error: unknown): string {
  const result = error as Partial<AgentRunResult>
  const parts = [
    result.diagnostic,
    result.stderr,
    result.text,
    error instanceof Error ? error.stack || error.message : undefined,
    typeof error === 'string' ? error : undefined,
  ].filter(Boolean)
  const text = redactAgentText(parts.join('\n') || String(error || 'unknown error'))
  return text.replace(/\s+/g, ' ').trim().slice(0, 2000)
}

function formatTelegramErrorLogEntry(entry: TelegramErrorLogEntry): string {
  const lines = [
    `${entry.ts} - ${entry.source}`,
    entry.failureKind ? `kind: ${entry.failureKind}` : undefined,
    typeof entry.exitCode === 'number' ? `exit: ${entry.exitCode}` : undefined,
    entry.timedOut ? 'timed out: yes' : undefined,
    entry.message,
  ].filter(Boolean) as string[]
  if (entry.activity?.length) {
    lines.push('activity:')
    for (const event of entry.activity.slice(-5)) {
      lines.push(`- ${event}`)
    }
  }
  return lines.join('\n').slice(0, 1800)
}

type TelegramProgressEvent = {
  label: string
  count: number
}

type TelegramProgressSnapshot = {
  status: TelegramProgressStatus
  phase: string
  startedAt: number
  events: TelegramProgressEvent[]
}

class TelegramTaskProgress {
  readonly messageId: number
  private readonly startedAt = Date.now()
  private readonly events: TelegramProgressEvent[] = []
  private readonly edit: (text: string) => Promise<void>
  private readonly stopTyping: () => void
  private phase: string
  private status: TelegramProgressStatus = 'running'
  private disposed = false
  private lastEditAt = 0
  private editTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeatTimer: ReturnType<typeof setInterval>

  constructor(input: {
    messageId: number
    phase: string
    edit: (text: string) => Promise<void>
    stopTyping: () => void
  }) {
    this.messageId = input.messageId
    this.phase = input.phase
    this.edit = input.edit
    this.stopTyping = input.stopTyping
    this.heartbeatTimer = setInterval(() => this.scheduleEdit(), 15_000)
  }

  setPhase(phase: string): void {
    if (!phase || this.disposed) return
    this.phase = phase
    this.scheduleEdit()
  }

  observeStdout(chunk: string): void {
    const events = summarizeAgentProgressChunk(chunk)
    for (const event of events) {
      this.addEvent(event)
    }
  }

  addEvent(label: string): void {
    if (this.disposed) return
    const normalized = truncateProgressLabel(label)
    if (!normalized) return
    const existing = this.events.find(event => event.label === normalized)
    if (existing) {
      existing.count += 1
    } else {
      this.events.push({ label: normalized, count: 1 })
      while (this.events.length > 18) {
        this.events.shift()
      }
    }
    this.scheduleEdit()
  }

  async finish(status: Exclude<TelegramProgressStatus, 'running'>, phase: string): Promise<void> {
    if (this.disposed) return
    this.status = status
    this.phase = phase
    await this.flush()
    this.dispose()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopTyping()
    clearInterval(this.heartbeatTimer)
    if (this.editTimer) clearTimeout(this.editTimer)
  }

  private scheduleEdit(): void {
    if (this.disposed) return
    const waitMs = Math.max(0, 1_500 - (Date.now() - this.lastEditAt))
    if (waitMs === 0) {
      void this.flush().catch(() => {})
      return
    }
    if (!this.editTimer) {
      this.editTimer = setTimeout(() => {
        this.editTimer = undefined
        void this.flush().catch(() => {})
      }, waitMs)
    }
  }

  private async flush(): Promise<void> {
    if (this.disposed || !this.messageId) return
    this.lastEditAt = Date.now()
    try {
      await this.edit(formatTelegramProgressText({
        status: this.status,
        phase: this.phase,
        startedAt: this.startedAt,
        events: this.events,
      }))
    } catch {
      // Telegram rejects unchanged/rate-limited edits; progress is best-effort.
    }
  }
}

export function summarizeAgentProgressChunk(chunk: string): string[] {
  const seen = new Set<string>()
  const events: string[] = []
  const lines = chunk
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ')
    const tool = normalized.match(
      /\b(mcp_[A-Za-z0-9_.:-]+|PowerShell|FileSystem|Screenshot|App|Wait|Notification|Clipboard|search_files|read_file|write_file|execute_code|skill_view|shell_command|apply_patch|Bash|Read|Write|Edit|Glob|Grep|LS|TodoWrite)\b/,
    )?.[1]
    if (tool) {
      const quoted = normalized.match(/["'`]([^"'`]{1,140})["'`]/)?.[1]
      const label = quoted ? `${tool}: "${quoted}"` : normalized
      const truncated = truncateProgressLabel(label)
      if (!seen.has(truncated)) {
        seen.add(truncated)
        events.push(truncated)
      }
      continue
    }

    if (/^(running|reading|writing|searching|executing|created|updated|edited|calling)\b/i.test(normalized)) {
      const truncated = truncateProgressLabel(normalized)
      if (!seen.has(truncated)) {
        seen.add(truncated)
        events.push(truncated)
      }
    }
  }

  return events.slice(0, 8)
}

export function formatTelegramProgressText(snapshot: TelegramProgressSnapshot): string {
  const lines = [
    `OpenClaude task: ${snapshot.status}`,
    `Phase: ${snapshot.phase}`,
    `Elapsed: ${formatDuration(Date.now() - snapshot.startedAt)}`,
    '',
    'Activity:',
  ]

  if (snapshot.events.length === 0) {
    lines.push(
      snapshot.status === 'running'
        ? '- waiting for model/tool output'
        : '- no streamed model/tool activity captured',
    )
  } else {
    for (const event of snapshot.events.slice(-14)) {
      lines.push(`- ${event.label}${event.count > 1 ? ` (x${event.count})` : ''}`)
    }
  }

  return lines.join('\n').slice(0, 3900)
}

function normalizeTelegramCommand(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return trimmed
  const [command = '', ...rest] = trimmed.split(/\s+/)
  const normalizedCommand = command.replace(/@[A-Za-z0-9_]+$/, '').toLowerCase()
  return [normalizedCommand, ...rest].join(' ').trim()
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function truncateProgressLabel(label: string): string {
  const normalized = label.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 157)}...`
}

export function buildTelegramAgentPrompt(input: {
  chatId: string
  messageId: number
  from?: TelegramMessage['from']
  text: string
  attachments: TelegramAttachment[]
  memoryContext?: string
  reflectionContext?: string
}): string {
  const lines = [
    'Telegram request received by the OpenClaude agent bridge.',
    `Chat ID: ${input.chatId}`,
    `Message ID: ${input.messageId}`,
  ]

  if (input.from) {
    lines.push(
      `From: ${input.from.username ? `@${input.from.username}` : input.from.first_name || input.from.id}`,
    )
  }

  // Inject memory context (scratchpad, identity, patterns) if available
  if (input.memoryContext) {
    lines.push('', '## Your persistent memory (Ouroboros consciousness system)', input.memoryContext)
  }

  // Inject reflection context (recent task reflections) if available
  if (input.reflectionContext) {
    lines.push('', input.reflectionContext)
  }

  lines.push(
    '',
    'If you need Telegram to upload an output screenshot, image, or document back to the chat, include a standalone control line:',
    '[TELEGRAM_SEND_FILE path="C:\\path\\to\\file.png" caption="optional caption"]',
    'You can also use [[image:C:\\path\\to\\image.png]] or [[document:C:\\path\\to\\file.pdf]].',
    'The bridge will remove those control tokens from visible text and upload the local file.',
    '',
    'User message:',
    input.text || '(no text; user sent attachments)',
  )

  if (input.attachments.length > 0) {
    lines.push('', 'Telegram attachments saved for this request:')
    for (const attachment of input.attachments) {
      lines.push(formatAttachmentForPrompt(attachment))
    }
    lines.push(
      '',
      'Use the local_path values above when you need to inspect attached files.',
    )
  }

  return lines.join('\n')
}

/**
 * Async wrapper that builds the prompt with memory context injected.
 */
export async function buildTelegramAgentPromptWithMemory(input: {
  chatId: string
  messageId: number
  from?: TelegramMessage['from']
  text: string
  attachments: TelegramAttachment[]
}): Promise<string> {
  const [memoryContext, reflectionContext] = await Promise.all([
    buildMemoryContextSection().catch(() => ''),
    buildReflectionContextSection().catch(() => ''),
  ])

  return buildTelegramAgentPrompt({
    ...input,
    memoryContext: memoryContext || undefined,
    reflectionContext: reflectionContext || undefined,
  })
}

export function extractTelegramSendDirectives(text: string): {
  text: string
  directives: TelegramSendDirective[]
} {
  const directives: TelegramSendDirective[] = []
  const cleanedLines: string[] = []
  const controlPattern =
    /^\s*\[TELEGRAM_SEND_FILE\s+path=(?:"([^"]+)"|'([^']+)'|([^\]\s]+))(?:\s+caption=(?:"([^"]*)"|'([^']*)'))?(?:\s+(?:kind|as)=(?:"([^"]+)"|'([^']+)'|([^\]\s]+)))?\s*\]\s*$/i
  const tokenPattern = /\[\[(image|document|file):([^\]\r\n]+)\]\]/gi

  for (const line of text.split(/\r?\n/)) {
    const controlMatch = line.match(controlPattern)
    if (controlMatch) {
      directives.push(
        buildTelegramDirective(
          controlMatch[1] || controlMatch[2] || controlMatch[3] || '',
          controlMatch[4] || controlMatch[5] || undefined,
          controlMatch[6] || controlMatch[7] || controlMatch[8],
        ),
      )
      continue
    }

    const cleaned = line.replace(tokenPattern, (_full, rawKind, rawPath) => {
      directives.push(
        buildTelegramDirective(
          String(rawPath).trim(),
          undefined,
          rawKind === 'file' ? 'auto' : String(rawKind),
        ),
      )
      return ''
    })
    cleanedLines.push(cleaned)
  }

  return {
    text: cleanedLines.join('\n').trim(),
    directives: directives.filter(directive => directive.path),
  }
}

function buildTelegramDirective(
  path: string,
  caption?: string,
  rawKind?: string,
): TelegramSendDirective {
  const kind = normalizeTelegramDirectiveKind(rawKind)
  return {
    path,
    ...(caption ? { caption } : {}),
    ...(kind ? { kind } : {}),
  }
}

function normalizeTelegramDirectiveKind(
  value: string | undefined,
): TelegramSendDirective['kind'] | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'image' || normalized === 'photo') return 'image'
  if (normalized === 'document' || normalized === 'doc') return 'document'
  if (normalized === 'file' || normalized === 'auto') return 'auto'
  return undefined
}

export function getAttachmentCandidates(
  message: TelegramMessage,
): IncomingAttachmentCandidate[] {
  const candidates: IncomingAttachmentCandidate[] = []
  const photo = selectLargestPhoto(message.photo)
  if (photo) {
    candidates.push({
      type: 'photo',
      file: {
        file_id: photo.file_id,
        file_unique_id: photo.file_unique_id,
        file_size: photo.file_size,
        file_name: `photo-${photo.file_unique_id || photo.file_id}.jpg`,
      },
      width: photo.width,
      height: photo.height,
    })
  }

  for (const [type, file] of [
    ['document', message.document],
    ['video', message.video],
    ['audio', message.audio],
    ['voice', message.voice],
    ['video_note', message.video_note],
    ['animation', message.animation],
    ['sticker', message.sticker],
  ] as const) {
    if (file) {
      candidates.push({
        type,
        file,
        width: file.width,
        height: file.height,
        duration: file.duration,
      })
    }
  }

  return candidates
}

export function getAudioTranscriptionCandidate(
  message: TelegramMessage,
): IncomingAttachmentCandidate | undefined {
  if (message.voice) {
    return {
      type: 'voice',
      file: {
        ...message.voice,
        file_name:
          message.voice.file_name ||
          `voice-${message.voice.file_unique_id || message.voice.file_id}.ogg`,
        mime_type: message.voice.mime_type || 'audio/ogg',
      },
      duration: message.voice.duration,
    }
  }

  if (message.audio) {
    return {
      type: 'audio',
      file: message.audio,
      duration: message.audio.duration,
    }
  }

  if (message.document && isAudioMime(message.document.mime_type)) {
    return {
      type: 'audio_document',
      file: message.document,
      duration: message.document.duration,
    }
  }

  if (message.video_note) {
    return {
      type: 'video_note',
      file: message.video_note,
      width: message.video_note.width,
      height: message.video_note.height,
      duration: message.video_note.duration,
    }
  }

  return undefined
}

export function selectLargestPhoto(
  photos: TelegramPhotoSize[] | undefined,
): TelegramPhotoSize | undefined {
  if (!photos?.length) return undefined
  return [...photos].sort((a, b) => {
    const aPixels = a.width * a.height
    const bPixels = b.width * b.height
    if (aPixels !== bPixels) return bPixels - aPixels
    return (b.file_size ?? 0) - (a.file_size ?? 0)
  })[0]
}

export function safeTelegramFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'telegram-file'
}

export function buildTelegramDownloadFileName(
  candidate: IncomingAttachmentCandidate,
  fileInfo: TelegramGetFileResult,
): string {
  const telegramPathName = fileInfo.file_path ? basename(fileInfo.file_path) : ''
  const preferredName = candidate.file.file_name || telegramPathName
  if (preferredName && extname(preferredName)) {
    return safeTelegramFileName(preferredName)
  }

  const extension =
    extensionFromTelegramPath(fileInfo.file_path) ||
    extensionFromMime(candidate.file.mime_type) ||
    defaultExtensionForAttachmentType(candidate.type)
  const fileStem = `${candidate.type}-${candidate.file.file_unique_id || candidate.file.file_id}`
  return safeTelegramFileName(`${fileStem}${extension}`)
}

export async function listTelegramStoredFiles(
  chatId?: string,
  limit = 20,
): Promise<TelegramStoredFile[]> {
  const files = await loadTelegramStoredFiles()
  return files
    .filter(file => !chatId || file.chatId === chatId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

function getTelegramMessageText(message: TelegramMessage | undefined): string {
  return (message?.text || message?.caption || '').trim()
}

function telegramFilesIndexPath(): string {
  return join(getAgentGatewayStateDir(), 'telegram-files', 'index.json')
}

async function loadTelegramStoredFiles(): Promise<TelegramStoredFile[]> {
  try {
    const raw = await readFile(telegramFilesIndexPath(), 'utf8')
    const parsed = JSON.parse(raw) as { files?: TelegramStoredFile[] }
    return Array.isArray(parsed.files) ? parsed.files : []
  } catch {
    return []
  }
}

async function recordTelegramAttachment(
  chatId: string,
  messageId: number,
  attachment: TelegramAttachment,
): Promise<void> {
  if (!attachment.localPath) return
  const dir = join(getAgentGatewayStateDir(), 'telegram-files')
  await mkdir(dir, { recursive: true })

  const files = await loadTelegramStoredFiles()
  files.push({
    chatId,
    messageId,
    type: attachment.type,
    fileId: attachment.fileId,
    fileName: attachment.fileName || basename(attachment.localPath),
    mimeType: attachment.mimeType,
    size: attachment.size,
    localPath: attachment.localPath,
    createdAt: new Date().toISOString(),
  })

  const deduped = dedupeTelegramStoredFiles(files).slice(-500)
  await writeFile(
    telegramFilesIndexPath(),
    `${JSON.stringify({ files: deduped, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
}

function dedupeTelegramStoredFiles(
  files: TelegramStoredFile[],
): TelegramStoredFile[] {
  const byPath = new Map<string, TelegramStoredFile>()
  for (const file of files) byPath.set(file.localPath, file)
  return [...byPath.values()]
}

function formatAttachmentForPrompt(attachment: TelegramAttachment): string {
  const lines = [
    `- type: ${attachment.type}`,
    `  file_id: ${attachment.fileId}`,
  ]
  if (attachment.fileName) lines.push(`  file_name: ${attachment.fileName}`)
  if (attachment.mimeType) lines.push(`  mime_type: ${attachment.mimeType}`)
  if (attachment.size) lines.push(`  size_bytes: ${attachment.size}`)
  if (attachment.width && attachment.height) {
    lines.push(`  dimensions: ${attachment.width}x${attachment.height}`)
  }
  if (attachment.duration) lines.push(`  duration_seconds: ${attachment.duration}`)
  if (attachment.localPath) {
    lines.push(`  local_path: ${attachment.localPath}`)
    lines.push(`  prompt_reference: @${attachment.localPath}`)
  }
  if (attachment.transcriptPath) lines.push(`  transcript_path: ${attachment.transcriptPath}`)
  if (attachment.transcript) {
    lines.push('  transcript:')
    for (const line of attachment.transcript.split(/\r?\n/)) {
      lines.push(`    ${line}`)
    }
  }
  if (attachment.transcriptionError) {
    lines.push(`  transcription_error: ${attachment.transcriptionError}`)
  }
  if (attachment.downloadError) {
    lines.push(`  download_error: ${attachment.downloadError}`)
  }
  return lines.join('\n')
}

function splitTelegramText(text: string): string[] {
  const maxLength = 3900
  if (!text) return ['']
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength))
  }
  return chunks
}

function isTelegramPhotoFile(filePath: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(
    extname(filePath).toLowerCase(),
  )
}

function isAudioMime(mimeType: string | undefined): boolean {
  return Boolean(mimeType?.toLowerCase().startsWith('audio/'))
}

function extensionFromTelegramPath(filePath: string | undefined): string {
  if (!filePath) return ''
  return extname(filePath).toLowerCase()
}

function extensionFromMime(mimeType: string | undefined): string {
  switch (mimeType?.toLowerCase()) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'audio/ogg':
    case 'audio/opus':
      return '.ogg'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/mp4':
    case 'audio/x-m4a':
      return '.m4a'
    case 'video/mp4':
      return '.mp4'
    case 'application/pdf':
      return '.pdf'
    case 'text/plain':
      return '.txt'
    default:
      return ''
  }
}

function defaultExtensionForAttachmentType(type: string): string {
  switch (type) {
    case 'photo':
      return '.jpg'
    case 'voice':
      return '.ogg'
    case 'audio':
    case 'audio_document':
      return '.mp3'
    case 'video':
    case 'video_note':
      return '.mp4'
    case 'animation':
      return '.gif'
    case 'sticker':
      return '.webp'
    default:
      return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
