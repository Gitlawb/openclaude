(function() {
  var $ = function(s) { return document.getElementById(s) };
  var messagesEl = $('messages');
  var inputEl = $('user-input');
  var sendBtn = $('send-btn');
  var cancelBtn = $('cancel-btn');
  var typingEl = $('typing');
  var connDot = $('conn-dot');
  var connLabel = $('conn-label');
  var tokenInfo = $('token-info');
  var tokenDisplay = $('token-display');
  var welcomeEl = $('welcome');
  var topbarTitle = $('topbar-title');
  var sessionListEl = $('session-list');
  var providerBadge = $('provider-badge');
  var cwdInput = $('cwd-input');
  var modelSelect = $('model-select');
  var attachBtn = $('attach-btn');
  var fileInput = $('file-input');
  var imgPreview = $('img-preview');
  var currentCwd = '';
  var savedSessions = [];
  var pendingImages = [];
  var noProvider = false;
  var logoSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';

  marked.setOptions({
    highlight: function(code, lang) {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    },
    breaks: true, gfm: true
  });

  var ws = null, streaming = false, currentBubble = null, currentText = '';
  var totalIn = 0, totalOut = 0;
  var toolCards = new Map(), sessions = [], activeSession = null;
  var STORAGE_KEY = 'openclaude_sessions';
  /** Session ids removed from the sidebar; History comes from the server and would reappear without this. */
  var HIDDEN_IDS_KEY = 'openclaude_hidden_session_ids';

  function loadHiddenSessionIds() {
    try {
      var raw = localStorage.getItem(HIDDEN_IDS_KEY);
      if (!raw) return new Set();
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.map(function(x) { return String(x) }));
    } catch (e) {
      return new Set();
    }
  }

  var hiddenSessionIds = loadHiddenSessionIds();

  function persistHiddenSessionIds() {
    try {
      localStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify(Array.from(hiddenSessionIds)));
    } catch (e) {}
  }

  function saveSessions() {
    try {
      var data = sessions.map(function(s) {
        return { id: s.id, title: s.title, messages: s.messages, ts: s.ts, model: s.model || '' };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {}
  }

  function loadSessionsFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      sessions = data.filter(function(s) { return s && s.id && Array.isArray(s.messages) });
      if (sessions.length > 0) {
        activeSession = sessions[0];
      }
    } catch(e) {}
  }

  function newSession() {
    var s = { id: crypto.randomUUID(), title: 'New conversation', messages: [], ts: Date.now(), model: modelSelect.value || '' };
    sessions.unshift(s);
    activeSession = s;
    saveSessions();
    renderSessions();
    return s;
  }

  function renderSessions() {
    sessionListEl.innerHTML = '';
    sessions.forEach(function(s) {
      var el = document.createElement('div');
      el.className = 'session-item' + (activeSession && s.id === activeSession.id ? ' active' : '');
      el.textContent = s.title;
      el.addEventListener('click', function() { switchSession(s.id) });
      sessionListEl.appendChild(el);
    });
  }

  function switchSession(id) {
    var s = sessions.find(function(x) { return x.id === id });
    if (!s || streaming) return;
    activeSession = s;
    topbarTitle.textContent = s.title;
    modelSelect.value = s.model || '';
    messagesEl.innerHTML = '';
    if (s.messages.length === 0) {
      messagesEl.appendChild(welcomeEl); welcomeEl.style.display = 'flex';
    } else {
      welcomeEl.style.display = 'none';
      s.messages.forEach(function(m) { addMessageEl(m.role, m.content, true) });
    }
    renderSessions();
  }

  $('new-chat-btn').addEventListener('click', function() {
    if (streaming) return;
    activeSession = newSession();
    topbarTitle.textContent = 'New conversation';
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl); welcomeEl.style.display = 'flex';
    renderSessions();
  });

  document.querySelectorAll('.suggest-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      inputEl.value = btn.getAttribute('data-prompt');
      sendMessage();
    });
  });

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);
    ws.onopen = function() { connDot.classList.add('ok'); connLabel.textContent = 'Connected' };
    ws.onclose = function(ev) {
      connDot.classList.remove('ok');
      streaming = false; updateUI();
      if (ev.code === 4401) {
        connLabel.textContent = 'Unauthorized';
        return;
      }
      connLabel.textContent = 'Reconnecting...';
      setTimeout(connect, 2000);
    };
    ws.onerror = function() { ws.close() };
    ws.onmessage = function(ev) { try { handleMsg(JSON.parse(ev.data)) } catch(e) { console.error(e) } };
  }

  function handleMsg(msg) {
    switch(msg.type) {
      case 'config':
        if (msg.cwd) { currentCwd = msg.cwd; cwdInput.value = msg.cwd }
        if (msg.provider && msg.provider !== 'unknown') {
          providerBadge.textContent = msg.model || msg.provider;
          providerBadge.style.display = 'inline-flex';
        }
        if (msg.noProvider) {
          noProvider = true;
          $('input-area').classList.add('input-disabled');
          var w = $('welcome');
          if (w) {
            var sug = w.querySelector('.suggestions');
            if (sug) sug.innerHTML = '<div class="no-provider-msg"><h3>No API Key Configured</h3><p>Run <code>openclaude</code> in your terminal to set up a provider, or add an API key to your <code>.env</code> file.</p></div>';
          }
        }
        break;
      case 'text_chunk':
        if (!currentBubble) { currentBubble = addMessageEl('assistant', ''); currentText = '' }
        currentText += msg.text;
        renderMd(currentBubble, currentText);
        scrollEnd();
        break;
      case 'tool_start': mkToolCard(msg.toolUseId, msg.toolName, msg.args); scrollEnd(); break;
      case 'tool_result': finishToolCard(msg.toolUseId, msg.output, msg.isError); scrollEnd(); break;
      case 'action_required': showPerm(msg.promptId, msg.question, msg.toolName); break;
      case 'done':
        if (currentText) {
          activeSession.messages.push({ role:'assistant', content:currentText });
          if (activeSession.messages.length === 2) {
            activeSession.title = activeSession.messages[0].content.slice(0, 48);
            topbarTitle.textContent = activeSession.title;
            renderSessions();
          }
        }
        if (currentBubble && msg.model) {
          var modelTag = document.createElement('div');
          modelTag.style.cssText = 'margin-top:10px;font-size:11px;color:var(--text-muted);font-family:JetBrains Mono,monospace;display:flex;align-items:center;gap:5px';
          modelTag.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ' + esc(msg.model);
          currentBubble.appendChild(modelTag);
        }
        streaming = false; currentBubble = null; currentText = '';
        totalIn += msg.promptTokens || 0; totalOut += msg.completionTokens || 0;
        saveSessions();
        updTokens(); updateUI();
        break;
      case 'error':
        streaming = false; currentBubble = null; currentText = '';
        var errEl = addMessageEl('assistant', '');
        errEl.innerHTML = '<div style="color:var(--red);padding:12px 16px;background:var(--red-dim);border-radius:var(--radius-md);border:1px solid rgba(248,113,113,0.15);font-size:13px;line-height:1.5"><strong>Error:</strong> ' + esc(msg.message) + '</div>';
        updateUI();
        break;
    }
  }

  function addMessageEl(role, content, replay) {
    if (welcomeEl.style.display !== 'none' && !replay) welcomeEl.style.display = 'none';
    var row = document.createElement('div'); row.className = 'msg-row';
    var inner = document.createElement('div'); inner.className = 'msg-inner';
    var av = document.createElement('div');
    av.className = 'msg-avatar ' + (role === 'user' ? 'user-av' : 'bot-av');
    if (role === 'user') av.textContent = 'U';
    else av.innerHTML = logoSvg;
    var body = document.createElement('div'); body.className = 'msg-body';
    var meta = document.createElement('div'); meta.className = 'msg-meta';
    meta.textContent = role === 'user' ? 'You' : 'OpenClaude';
    var bubble = document.createElement('div');
    bubble.className = 'msg-content' + (role === 'user' ? ' user-text' : '');
    if (role === 'user') bubble.textContent = content;
    else if (replay) renderMd(bubble, content);
    body.appendChild(meta); body.appendChild(bubble);
    inner.appendChild(av); inner.appendChild(body);
    row.appendChild(inner); messagesEl.appendChild(row);
    scrollEnd();
    return bubble;
  }

  function renderMd(el, text) {
    try {
      el.innerHTML = DOMPurify.sanitize(marked.parse(text));
      el.querySelectorAll('pre').forEach(function(pre) {
        if (pre.querySelector('.code-header')) return;
        var codeEl = pre.querySelector('code');
        var lang = '';
        if (codeEl) {
          var cls = codeEl.className || '';
          var m = cls.match(/language-(\w+)/);
          if (m) lang = m[1];
          hljs.highlightElement(codeEl);
        }
        var hdr = document.createElement('div'); hdr.className = 'code-header';
        var langSpan = document.createElement('span'); langSpan.textContent = lang || 'code';
        var cpBtn = document.createElement('button'); cpBtn.className = 'copy-btn';
        cpBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
        cpBtn.addEventListener('click', function() {
          navigator.clipboard.writeText(codeEl ? codeEl.textContent : pre.textContent);
          cpBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
          cpBtn.classList.add('copied');
          setTimeout(function() {
            cpBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
            cpBtn.classList.remove('copied');
          }, 2000);
        });
        hdr.appendChild(langSpan); hdr.appendChild(cpBtn);
        pre.insertBefore(hdr, pre.firstChild);
      });
    } catch(e) { el.textContent = text }
  }

  function mkToolCard(id, name, args) {
    var card = document.createElement('div'); card.className = 'tool-card';
    var hdr = document.createElement('div'); hdr.className = 'tool-header';
    var chev = document.createElement('div'); chev.className = 'tool-chevron';
    chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
    var iconW = document.createElement('div'); iconW.className = 'tool-icon-wrap';
    iconW.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
    var nm = document.createElement('span'); nm.className = 'tool-name'; nm.textContent = name;
    var badge = document.createElement('span'); badge.className = 'tool-badge running'; badge.textContent = 'running';
    hdr.appendChild(chev); hdr.appendChild(iconW); hdr.appendChild(nm); hdr.appendChild(badge);
    var body = document.createElement('div'); body.className = 'tool-body';
    var pre = document.createElement('pre');
    try { pre.textContent = JSON.stringify(JSON.parse(args), null, 2) } catch(e) { pre.textContent = args }
    body.appendChild(pre);
    hdr.addEventListener('click', function() { chev.classList.toggle('open'); body.classList.toggle('open') });
    card.appendChild(hdr); card.appendChild(body);
    var row = document.createElement('div'); row.className = 'msg-row';
    var inner = document.createElement('div'); inner.className = 'msg-inner';
    var sp = document.createElement('div'); sp.style.cssText = 'width:32px;flex-shrink:0';
    var wrap = document.createElement('div'); wrap.style.cssText = 'flex:1;min-width:0';
    wrap.appendChild(card); inner.appendChild(sp); inner.appendChild(wrap);
    row.appendChild(inner); messagesEl.appendChild(row);
    toolCards.set(id, { badge:badge, body:body });
  }

  function finishToolCard(id, output, isErr) {
    var e = toolCards.get(id); if (!e) return;
    e.badge.className = 'tool-badge ' + (isErr ? 'error' : 'done');
    e.badge.textContent = isErr ? 'error' : 'done';
    if (output) {
      var sep = document.createElement('div'); sep.className = 'tool-output-sep';
      e.body.appendChild(sep);
      var pre = document.createElement('pre');
      pre.textContent = output.length > 2000 ? output.slice(0, 2000) + '\n... (truncated)' : output;
      e.body.appendChild(pre);
    }
  }

  function showPerm(pid, question, toolName) {
    var ov = document.createElement('div'); ov.className = 'perm-overlay';
    var card = document.createElement('div'); card.className = 'perm-card';

    var icon = document.createElement('div'); icon.className = 'perm-icon'; icon.textContent = '\u26A0\uFE0F';
    var h3 = document.createElement('h3'); h3.textContent = 'Permission Required';
    var p = document.createElement('p'); p.textContent = question;
    var actions = document.createElement('div'); actions.className = 'perm-actions';

    var denyBtn = document.createElement('button'); denyBtn.className = 'btn-deny'; denyBtn.textContent = 'Deny';
    var onceBtn = document.createElement('button'); onceBtn.className = 'btn-allow'; onceBtn.textContent = 'Allow once';
    onceBtn.style.cssText = 'background:var(--blue);color:#fff';
    var sessBtn = document.createElement('button'); sessBtn.className = 'btn-allow'; sessBtn.textContent = 'Allow for session';

    actions.appendChild(denyBtn); actions.appendChild(onceBtn); actions.appendChild(sessBtn);
    card.appendChild(icon); card.appendChild(h3); card.appendChild(p); card.appendChild(actions);
    ov.appendChild(card); document.body.appendChild(ov);

    sessBtn.onclick = function() { wsReply(pid,'session'); ov.remove() };
    onceBtn.onclick = function() { wsReply(pid,'yes'); ov.remove() };
    denyBtn.onclick = function() { wsReply(pid,'no'); ov.remove() };
    ov.onclick = function(e) { if (e.target === ov) { wsReply(pid,'no'); ov.remove() } };
  }

  function wsReply(pid, text) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'input', promptId:pid, reply:text })) }

  function sendMessage() {
    var text = inputEl.value.trim();
    if ((!text && pendingImages.length === 0) || streaming || noProvider) return;
    if (!text) text = 'Describe this image.';
    var bubble = addMessageEl('user', text);
    if (pendingImages.length > 0) {
      pendingImages.forEach(function(img) {
        var imgEl = document.createElement('img');
        imgEl.src = 'data:' + img.mediaType + ';base64,' + img.data;
        imgEl.className = 'user-image';
        bubble.appendChild(imgEl);
      });
    }
    activeSession.messages.push({ role:'user', content:text });
    inputEl.value = ''; inputEl.style.height = 'auto';
    streaming = true; toolCards.clear(); updateUI();
    var reqCwd = cwdInput.value.trim() || currentCwd;
    var reqModel = modelSelect.value || undefined;
    var payload = { type:'request', message:text, sessionId:activeSession.id, cwd:reqCwd };
    if (reqModel) payload.model = reqModel;
    if (pendingImages.length > 0) payload.images = pendingImages;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
    pendingImages = [];
    imgPreview.innerHTML = '';
    imgPreview.style.display = 'none';
  }

  function cancelReq() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'cancel' }));
    streaming = false; currentBubble = null; currentText = ''; updateUI();
  }

  function updateUI() {
    sendBtn.style.display = streaming ? 'none' : 'flex';
    cancelBtn.style.display = streaming ? 'flex' : 'none';
    sendBtn.disabled = streaming;
    typingEl.classList.toggle('on', streaming);
    if (!streaming) inputEl.focus();
  }

  function updTokens() {
    tokenInfo.textContent = totalIn.toLocaleString() + ' in / ' + totalOut.toLocaleString() + ' out';
    tokenDisplay.textContent = (totalIn + totalOut).toLocaleString() + ' tokens';
  }

  function scrollEnd() { messagesEl.scrollTop = messagesEl.scrollHeight }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML }

  inputEl.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } });
  inputEl.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 200) + 'px' });
  sendBtn.addEventListener('click', sendMessage);
  cancelBtn.addEventListener('click', cancelReq);
  modelSelect.addEventListener('change', function() {
    if (activeSession) activeSession.model = modelSelect.value;
  });

  function loadModels() {
    fetch('/api/models').then(function(r) { return r.json() }).then(function(models) {
      if (!Array.isArray(models)) return;
      var current = modelSelect.value;
      modelSelect.innerHTML = '<option value="">Default model</option>';
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.value || '';
        opt.textContent = m.label || m.value;
        if (m.description) opt.title = m.description;
        modelSelect.appendChild(opt);
      });
      if (current) modelSelect.value = current;
    }).catch(function() {});
  }

  function loadSavedSessions() {
    fetch('/api/sessions').then(function(r) { return r.json() }).then(function(list) {
      if (!Array.isArray(list)) return;
      savedSessions = list.filter(function(s) {
        return s && s.id && !hiddenSessionIds.has(String(s.id));
      });
      renderSessions();
    }).catch(function() {});
  }

  function loadSavedSession(index, savedEntry) {
    if (streaming) return;
    var existing = sessions.find(function(s) { return s.id === savedEntry.id });
    if (existing) { switchSession(existing.id); return }
    fetch('/api/sessions/' + encodeURIComponent(savedEntry.id)).then(function(r) { return r.json() }).then(function(data) {
      if (!data || !data.messages) return;
      var s = { id: data.id || savedEntry.id, title: savedEntry.title || data.title || 'Untitled', messages: data.messages, ts: Date.now(), savedIndex: index };
      sessions.push(s);
      activeSession = s;
      topbarTitle.textContent = s.title;
      messagesEl.innerHTML = '';
      welcomeEl.style.display = 'none';
      s.messages.forEach(function(m) { addMessageEl(m.role, m.content, true) });
      renderSessions();
      scrollEnd();
    }).catch(function(e) { console.error('Failed to load session', e) });
  }

  function deleteSession(id) {
    hiddenSessionIds.add(String(id));
    persistHiddenSessionIds();
    sessions = sessions.filter(function(s) { return s.id !== id });
    savedSessions = savedSessions.filter(function(s) { return s.id !== id });
    if (activeSession && activeSession.id === id) {
      if (sessions.length > 0) {
        switchSession(sessions[0].id);
      } else {
        activeSession = newSession();
        topbarTitle.textContent = 'New conversation';
        messagesEl.innerHTML = '';
        messagesEl.appendChild(welcomeEl); welcomeEl.style.display = 'flex';
      }
    }
    saveSessions();
    renderSessions();
  }

  function renameSession(id, newTitle) {
    var s = sessions.find(function(x) { return x.id === id });
    if (s) { s.title = newTitle }
    var sv = savedSessions.find(function(x) { return x.id === id });
    if (sv) { sv.title = newTitle }
    if (activeSession && activeSession.id === id) { topbarTitle.textContent = newTitle }
    saveSessions();
    renderSessions();
  }

  function buildSessionEl(s, clickFn) {
    var el = document.createElement('div');
    el.className = 'session-item' + (activeSession && s.id === activeSession.id ? ' active' : '');

    var titleSpan = document.createElement('span');
    titleSpan.className = 'session-title';
    var t = s.title || 'Untitled';
    titleSpan.textContent = t.length > 40 ? t.slice(0, 40) + '...' : t;
    titleSpan.addEventListener('click', clickFn);

    var actions = document.createElement('div');
    actions.className = 'session-actions';

    var editBtn = document.createElement('button');
    editBtn.className = 'session-act-btn';
    editBtn.title = 'Rename';
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      titleSpan.style.display = 'none'; actions.style.display = 'none';
      var inp = document.createElement('input');
      inp.className = 'rename-input';
      inp.value = s.title || '';
      el.insertBefore(inp, actions);
      inp.focus(); inp.select();
      function finish() { renameSession(s.id, inp.value.trim() || s.title) }
      inp.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') finish(); if (ev.key === 'Escape') renderSessions() });
      inp.addEventListener('blur', finish);
    });

    var delBtn = document.createElement('button');
    delBtn.className = 'session-act-btn del';
    delBtn.title = 'Delete';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    delBtn.addEventListener('click', function(e) { e.stopPropagation(); deleteSession(s.id) });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    el.appendChild(titleSpan);
    el.appendChild(actions);
    return el;
  }

  renderSessions = function() {
    sessionListEl.innerHTML = '';
    sessions.forEach(function(s) {
      sessionListEl.appendChild(buildSessionEl(s, function() { switchSession(s.id) }));
    });
    if (savedSessions.length > 0) {
      var hasVisible = false;
      savedSessions.forEach(function(sv) {
        if (sessions.find(function(m) { return m.id === sv.id })) return;
        if (!hasVisible) {
          var div = document.createElement('div');
          div.className = 'saved-divider';
          div.textContent = 'History';
          sessionListEl.appendChild(div);
          hasVisible = true;
        }
        var idx = savedSessions.indexOf(sv);
        sessionListEl.appendChild(buildSessionEl(
          { id: sv.id, title: sv.title || 'Untitled' },
          function() { loadSavedSession(idx, sv) }
        ));
      });
    }
  };

  function addImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    var reader = new FileReader();
    reader.onload = function() {
      var result = reader.result;
      var base64 = result.split(',')[1];
      var mediaType = file.type || 'image/png';
      pendingImages.push({ data: base64, mediaType: mediaType });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreviews() {
    imgPreview.innerHTML = '';
    if (pendingImages.length === 0) { imgPreview.style.display = 'none'; return }
    imgPreview.style.display = 'flex';
    pendingImages.forEach(function(img, i) {
      var thumb = document.createElement('div');
      thumb.className = 'img-thumb';
      var imgEl = document.createElement('img');
      imgEl.src = 'data:' + img.mediaType + ';base64,' + img.data;
      var removeBtn = document.createElement('button');
      removeBtn.className = 'img-thumb-remove';
      removeBtn.textContent = 'x';
      removeBtn.addEventListener('click', function() {
        pendingImages.splice(i, 1);
        renderImagePreviews();
      });
      thumb.appendChild(imgEl);
      thumb.appendChild(removeBtn);
      imgPreview.appendChild(thumb);
    });
  }

  attachBtn.addEventListener('click', function() { fileInput.click() });
  fileInput.addEventListener('change', function() {
    Array.from(fileInput.files || []).forEach(addImageFromFile);
    fileInput.value = '';
  });

  inputEl.addEventListener('paste', function(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        addImageFromFile(items[i].getAsFile());
        return;
      }
    }
  });

  var inputBox = inputEl.closest('.input-box');
  inputBox.addEventListener('dragover', function(e) { e.preventDefault(); inputBox.style.borderColor = 'var(--accent)' });
  inputBox.addEventListener('dragleave', function() { inputBox.style.borderColor = '' });
  inputBox.addEventListener('drop', function(e) {
    e.preventDefault(); inputBox.style.borderColor = '';
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files) Array.from(files).forEach(addImageFromFile);
  });

  loadSessionsFromStorage();
  if (sessions.length === 0) {
    newSession();
  } else {
    activeSession = sessions[0];
    topbarTitle.textContent = activeSession.title;
    if (activeSession.model) modelSelect.value = activeSession.model;
    if (activeSession.messages.length > 0) {
      welcomeEl.style.display = 'none';
      activeSession.messages.forEach(function(m) { addMessageEl(m.role, m.content, true) });
    }
  }
  renderSessions();
  loadModels();
  loadSavedSessions();
  connect();
})();
