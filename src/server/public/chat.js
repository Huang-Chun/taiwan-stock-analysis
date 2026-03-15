/**
 * Taiwan Stock Analysis - Floating Chat Panel
 * Include this script in any page to get a context-aware AI chat assistant.
 * Requires: marked.js (optional, for markdown rendering)
 */
(function () {
  'use strict';

  // ── Styles ───────────────────────────────────────────────────
  const css = `
    #chat-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 9000;
      width: 52px; height: 52px; border-radius: 50%;
      background: #58a6ff; color: #0d1117;
      border: none; cursor: pointer; font-size: 22px;
      box-shadow: 0 4px 16px rgba(88,166,255,0.4);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s, box-shadow .15s;
      user-select: none;
    }
    #chat-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(88,166,255,0.55); }
    #chat-fab.has-unread::after {
      content: ''; position: absolute; top: 4px; right: 4px;
      width: 10px; height: 10px; border-radius: 50%; background: #f85149;
    }

    #chat-panel {
      position: fixed; bottom: 88px; right: 24px; z-index: 9001;
      width: 400px; max-width: calc(100vw - 48px);
      height: 560px; max-height: calc(100vh - 120px);
      background: #161b22; border: 1px solid #30363d;
      border-radius: 14px; display: flex; flex-direction: column;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      transform: scale(0.9) translateY(20px);
      opacity: 0; pointer-events: none;
      transition: transform .2s ease, opacity .2s ease;
      font-family: 'Microsoft JhengHei', Arial, sans-serif;
    }
    #chat-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1; pointer-events: auto;
    }

    #chat-header {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 16px 12px; border-bottom: 1px solid #30363d;
      background: #21262d; border-radius: 14px 14px 0 0;
      flex-shrink: 0;
    }
    #chat-header .chat-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      background: linear-gradient(135deg,#58a6ff,#bc8cff);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0;
    }
    #chat-header .chat-title { font-size: 14px; font-weight: 600; color: #e6edf3; flex: 1; }
    #chat-header .chat-subtitle { font-size: 11px; color: #8b949e; }
    #chat-clear {
      background: none; border: none; color: #8b949e; cursor: pointer;
      font-size: 12px; padding: 4px 8px; border-radius: 6px;
      transition: background .15s, color .15s;
    }
    #chat-clear:hover { background: #30363d; color: #e6edf3; }
    #chat-close {
      background: none; border: none; color: #8b949e; cursor: pointer;
      font-size: 16px; padding: 4px 8px; border-radius: 6px;
      transition: background .15s, color .15s; line-height: 1;
    }
    #chat-close:hover { background: #30363d; color: #e6edf3; }

    #chat-messages {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 12px;
      scroll-behavior: smooth;
    }
    #chat-messages::-webkit-scrollbar { width: 4px; }
    #chat-messages::-webkit-scrollbar-track { background: transparent; }
    #chat-messages::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }

    .chat-msg { display: flex; gap: 8px; max-width: 100%; }
    .chat-msg.user { flex-direction: row-reverse; }
    .chat-msg-bubble {
      max-width: 85%; padding: 10px 13px; border-radius: 12px;
      font-size: 13px; line-height: 1.6; color: #e6edf3;
      word-break: break-word;
    }
    .chat-msg.user .chat-msg-bubble {
      background: #1f4068; border-radius: 12px 4px 12px 12px;
    }
    .chat-msg.assistant .chat-msg-bubble {
      background: #21262d; border: 1px solid #30363d;
      border-radius: 4px 12px 12px 12px;
    }
    .chat-msg-bubble p { margin: 0 0 6px; }
    .chat-msg-bubble p:last-child { margin: 0; }
    .chat-msg-bubble ul, .chat-msg-bubble ol { padding-left: 18px; margin: 4px 0; }
    .chat-msg-bubble li { margin: 2px 0; }
    .chat-msg-bubble strong { color: #f0a070; }
    .chat-msg-bubble h1,.chat-msg-bubble h2,.chat-msg-bubble h3 {
      font-size: 13px; font-weight: 700; color: #58a6ff; margin: 6px 0 3px;
    }
    .chat-msg-bubble code {
      background: #0d1117; border: 1px solid #30363d;
      padding: 1px 5px; border-radius: 4px; font-size: 12px; font-family: monospace;
    }
    .chat-msg-bubble pre { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 8px; overflow-x: auto; }
    .chat-msg-bubble pre code { background: none; border: none; padding: 0; }

    .chat-tool-indicator {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; background: #0d1117; border: 1px solid #30363d;
      border-radius: 8px; font-size: 11px; color: #8b949e;
      align-self: flex-start;
    }
    .chat-tool-indicator .spinner {
      width: 10px; height: 10px; border: 2px solid #30363d;
      border-top-color: #58a6ff; border-radius: 50%;
      animation: spin .6s linear infinite; flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .chat-typing {
      display: flex; align-items: center; gap: 8px;
      padding: 0 2px; align-self: flex-start;
    }
    .chat-typing .dot {
      width: 6px; height: 6px; border-radius: 50%; background: #58a6ff;
      animation: bounce .9s ease-in-out infinite;
    }
    .chat-typing .dot:nth-child(2) { animation-delay: .15s; }
    .chat-typing .dot:nth-child(3) { animation-delay: .3s; }
    @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

    .chat-empty {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 10px; color: #8b949e; text-align: center;
    }
    .chat-empty .empty-icon { font-size: 32px; opacity: .5; }
    .chat-empty .empty-text { font-size: 13px; line-height: 1.5; }
    .chat-suggestions { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 0 8px; }
    .chat-suggestion {
      background: #21262d; border: 1px solid #30363d; border-radius: 8px;
      padding: 8px 12px; font-size: 12px; color: #8b949e; cursor: pointer;
      text-align: left; transition: background .15s, color .15s, border-color .15s;
    }
    .chat-suggestion:hover { background: #30363d; color: #e6edf3; border-color: #58a6ff44; }

    #chat-input-area {
      padding: 10px 12px 12px; border-top: 1px solid #30363d;
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
    }
    #chat-input {
      flex: 1; background: #0d1117; border: 1px solid #30363d;
      color: #e6edf3; border-radius: 10px; padding: 9px 12px;
      font-size: 13px; font-family: inherit; resize: none;
      outline: none; line-height: 1.5; max-height: 100px; overflow-y: auto;
      transition: border-color .15s;
    }
    #chat-input:focus { border-color: #58a6ff; }
    #chat-input::placeholder { color: #484f58; }
    #chat-send {
      background: #58a6ff; color: #0d1117; border: none;
      border-radius: 10px; padding: 9px 14px; cursor: pointer;
      font-size: 16px; line-height: 1; flex-shrink: 0;
      transition: background .15s, transform .1s;
    }
    #chat-send:hover { background: #79b8ff; }
    #chat-send:active { transform: scale(0.95); }
    #chat-send:disabled { background: #30363d; color: #8b949e; cursor: not-allowed; transform: none; }
  `;

  // ── Inject styles ─────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Inject HTML ───────────────────────────────────────────────
  const container = document.createElement('div');
  container.innerHTML = `
    <button id="chat-fab" title="AI 分析師">💬</button>
    <div id="chat-panel">
      <div id="chat-header">
        <div class="chat-avatar">🤖</div>
        <div style="flex:1">
          <div class="chat-title">AI 分析師</div>
          <div class="chat-subtitle" id="chat-context-label">台股分析助理</div>
        </div>
        <button id="chat-clear" title="清除對話">清除</button>
        <button id="chat-close" title="關閉">✕</button>
      </div>
      <div id="chat-messages"></div>
      <div id="chat-input-area">
        <textarea id="chat-input" placeholder="問我任何台股問題… (Enter 送出)" rows="1"></textarea>
        <button id="chat-send">↑</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  // ── State ─────────────────────────────────────────────────────
  const fab = document.getElementById('chat-fab');
  const panel = document.getElementById('chat-panel');
  const msgContainer = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const closeBtn = document.getElementById('chat-close');
  const clearBtn = document.getElementById('chat-clear');
  const contextLabel = document.getElementById('chat-context-label');

  let history = [];   // [{ role: 'user'|'assistant', content: string }]
  let isOpen = false;
  let isStreaming = false;

  // ── Context detection ─────────────────────────────────────────
  function getContext() {
    const stockId = window.currentStockId || null;
    const stockNameEl = document.getElementById('stockName');
    const stockName = stockNameEl ? stockNameEl.textContent.trim() : null;
    const page = location.pathname.replace('/', '') || 'index';
    return { stockId, stockName, page };
  }

  function updateContextLabel() {
    const ctx = getContext();
    if (ctx.stockId) {
      contextLabel.textContent = `${ctx.stockName || ctx.stockId} (${ctx.stockId})`;
    } else {
      contextLabel.textContent = '台股分析助理';
    }
  }

  // ── Suggestions ───────────────────────────────────────────────
  function getSuggestions() {
    const ctx = getContext();
    if (ctx.stockId) {
      return [
        `分析 ${ctx.stockName || ctx.stockId} 目前的技術面與籌碼面`,
        `${ctx.stockId} 的法人近期動向如何？`,
        `${ctx.stockId} 值得買進嗎？`,
      ];
    }
    return [
      '目前有哪些股票 RSI 超賣？',
      '幫我找黃金交叉的股票',
      '台股市場目前的籌碼面概況',
    ];
  }

  // ── Empty state ───────────────────────────────────────────────
  function renderEmpty() {
    const suggestions = getSuggestions();
    msgContainer.innerHTML = `
      <div class="chat-empty">
        <div class="empty-icon">📊</div>
        <div class="empty-text">我可以幫你查詢股票資料、<br>分析技術指標、籌碼與基本面。</div>
        <div class="chat-suggestions">
          ${suggestions.map(s => `<button class="chat-suggestion">${s}</button>`).join('')}
        </div>
      </div>
    `;
    msgContainer.querySelectorAll('.chat-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.textContent;
        sendMessage();
      });
    });
  }

  // ── Message rendering ─────────────────────────────────────────
  const renderMd = (text) => {
    if (typeof marked !== 'undefined') {
      try { return marked.parse(text); } catch (_) {}
    }
    return text.replace(/</g, '&lt;').replace(/\n/g, '<br>');
  };

  function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg user';
    div.innerHTML = `<div class="chat-msg-bubble">${text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>`;
    msgContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendAssistantMessage() {
    const div = document.createElement('div');
    div.className = 'chat-msg assistant';
    div.innerHTML = `<div class="chat-msg-bubble"></div>`;
    msgContainer.appendChild(div);
    scrollToBottom();
    return div.querySelector('.chat-msg-bubble');
  }

  function appendTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'chat-typing';
    div.id = 'chat-typing';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    msgContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function removeTypingIndicator() {
    document.getElementById('chat-typing')?.remove();
  }

  function appendToolIndicator(toolName) {
    const labels = {
      get_stock_latest: '查詢最新股價與指標',
      get_signals: '偵測交易訊號',
      get_score: '計算綜合評分',
      get_institutional: '查詢法人資料',
      get_margin: '查詢融資融券',
      get_revenue: '查詢月營收',
      get_financial: '查詢財報',
      get_valuation: '計算估值指標',
      screen_stocks: '篩選股票',
    };
    const label = labels[toolName] || toolName;
    const div = document.createElement('div');
    div.className = 'chat-tool-indicator';
    div.id = `tool-${toolName}`;
    div.innerHTML = `<div class="spinner"></div><span>${label}中…</span>`;
    msgContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function removeToolIndicators() {
    msgContainer.querySelectorAll('.chat-tool-indicator').forEach(el => el.remove());
  }

  function scrollToBottom() {
    setTimeout(() => { msgContainer.scrollTop = msgContainer.scrollHeight; }, 10);
  }

  // ── Send message ──────────────────────────────────────────────
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isStreaming) return;

    // Clear empty state
    const emptyEl = msgContainer.querySelector('.chat-empty');
    if (emptyEl) emptyEl.remove();

    isStreaming = true;
    sendBtn.disabled = true;
    input.value = '';
    autoResizeInput();

    appendUserMessage(text);
    history.push({ role: 'user', content: text });

    const typing = appendTypingIndicator();

    try {
      const ctx = getContext();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, context: ctx }),
      });

      typing.remove();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const bubble = appendAssistantMessage();
        bubble.textContent = '❌ ' + (err.error || res.statusText);
        return;
      }

      const bubble = appendAssistantMessage();
      let fullText = '';
      let buffer = '';

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let payload;
          try { payload = JSON.parse(line.slice(6)); } catch { continue; }

          if (payload.error) {
            bubble.textContent = '❌ ' + payload.error;
            return;
          }
          if (payload.tool_call) {
            appendToolIndicator(payload.tool_call.name);
          }
          if (payload.text) {
            removeToolIndicators();
            fullText += payload.text;
            bubble.innerHTML = renderMd(fullText);
            scrollToBottom();
          }
          if (payload.done) break;
        }
      }

      // Final render
      if (fullText) {
        bubble.innerHTML = renderMd(fullText);
        history.push({ role: 'assistant', content: fullText });
      } else if (!bubble.textContent.trim()) {
        bubble.textContent = '（無回應）';
      }

    } catch (err) {
      typing.remove();
      removeToolIndicators();
      const bubble = appendAssistantMessage();
      bubble.textContent = '❌ ' + err.message;
    } finally {
      isStreaming = false;
      sendBtn.disabled = false;
      input.focus();
      scrollToBottom();
    }
  }

  // ── Auto-resize textarea ──────────────────────────────────────
  function autoResizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  // ── Toggle panel ──────────────────────────────────────────────
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    fab.classList.remove('has-unread');
    if (isOpen) {
      updateContextLabel();
      if (history.length === 0) renderEmpty();
      setTimeout(() => input.focus(), 200);
    }
  }

  // ── Event listeners ───────────────────────────────────────────
  fab.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', togglePanel);

  clearBtn.addEventListener('click', () => {
    history = [];
    msgContainer.innerHTML = '';
    renderEmpty();
  });

  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', autoResizeInput);

  // Update context label when stock changes (for chart.html)
  const observer = new MutationObserver(updateContextLabel);
  const stockNameEl = document.getElementById('stockName');
  if (stockNameEl) observer.observe(stockNameEl, { childList: true, characterData: true, subtree: true });

})();
