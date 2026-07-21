// Embeddable chat widget (Section 9) — deliberately separate from the
// DOO/Manager/Specialist task chain. Include this script plus a call to
// initChatWidget(mode) on any page; it talks to /api/chatbot/message.
// mode: 'sales' (works logged-out) | 'support' | 'billing' (better logged in).
(function () {
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  window.initChatWidget = function initChatWidget(defaultMode) {
    const sessionId = localStorage.getItem('chat_session_id') || uuid();
    localStorage.setItem('chat_session_id', sessionId);

    const launcher = document.createElement('button');
    launcher.className = 'chat-launcher';
    launcher.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    launcher.title = 'Chat with us';

    const win = document.createElement('div');
    win.className = 'chat-window hidden';
    win.innerHTML = `
      <div class="chat-header">
        <span>Assistant</span>
        <div>
          <select id="chat-mode-select">
            <option value="sales">Sales</option>
            <option value="support">Support</option>
            <option value="billing">Billing</option>
          </select>
          <button id="chat-close-btn" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:16px;">&times;</button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Ask a question…" />
        <button id="chat-send-btn">Send</button>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(win);

    const modeSelect = win.querySelector('#chat-mode-select');
    modeSelect.value = defaultMode || 'sales';

    const messagesEl = win.querySelector('#chat-messages');
    const inputEl = win.querySelector('#chat-input');

    function appendMessage(role, text) {
      const div = document.createElement('div');
      div.className = `chat-msg ${role}`;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function send() {
      const message = inputEl.value.trim();
      if (!message) return;
      inputEl.value = '';
      appendMessage('user', message);

      const token = localStorage.getItem('token');
      try {
        const res = await fetch('/api/chatbot/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId, message, mode: modeSelect.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Chat failed');
        appendMessage('assistant', data.reply);
      } catch (err) {
        appendMessage('assistant', `Sorry — something went wrong: ${err.message}`);
      }
    }

    launcher.addEventListener('click', () => {
      win.classList.toggle('hidden');
      if (!win.classList.contains('hidden') && messagesEl.children.length === 0) {
        appendMessage('assistant', "Hi! Ask me anything about the product, your account, or billing — I'll file a support ticket for you if I can't help directly.");
      }
    });
    win.querySelector('#chat-close-btn').addEventListener('click', () => win.classList.add('hidden'));
    win.querySelector('#chat-send-btn').addEventListener('click', send);
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  };
})();
