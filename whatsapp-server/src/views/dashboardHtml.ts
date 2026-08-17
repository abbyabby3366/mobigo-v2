export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mobigo WhatsApp Manager</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
    .chat-bg {
      background-color: #efeae2;
      background-image: radial-gradient(#d1d7db 0.75px, transparent 0.75px);
      background-size: 16px 16px;
    }
  </style>
</head>
<body class="bg-slate-100 text-slate-900 antialiased h-screen flex overflow-hidden">

  <!-- LEFT NAVIGATION BAR (WhatsBlast Style) -->
  <aside class="w-64 bg-slate-900 text-white flex flex-col justify-between shrink-0 border-r border-slate-800 z-30">
    <div>
      <!-- Brand Header -->
      <div class="h-16 px-5 border-b border-slate-800 flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
          📱
        </div>
        <div class="overflow-hidden">
          <h1 class="text-sm font-bold text-white tracking-wide truncate">MOBIGO WHATSAPP</h1>
          <div class="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Server Active (Port 4000)
          </div>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="p-3 space-y-1">
        <button onclick="navigateView('sessions')" id="nav-sessions" class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 transition">
          <div class="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
            <span>WhatsApp Sessions</span>
          </div>
          <span id="navSessionsCount" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">1</span>
        </button>

        <button onclick="navigateView('chat')" id="nav-chat" class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition">
          <div class="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Live Chat Log</span>
          </div>
          <span id="navChatBadge" class="hidden text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-mono">New</span>
        </button>

        <button onclick="navigateView('submissions')" id="nav-submissions" class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition">
          <div class="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>DocuSeal Submissions</span>
          </div>
        </button>
      </nav>
    </div>

    <!-- Bottom Footer Status -->
    <div class="p-3 border-t border-slate-800 space-y-2 text-xs">
      <div class="p-2.5 bg-slate-800/50 rounded-lg border border-slate-700/50 space-y-1">
        <div class="flex justify-between text-[11px] text-slate-400">
          <span>Active Phone</span>
          <span id="sidebarPhone" class="font-mono text-slate-200 font-semibold">+601172438377</span>
        </div>
        <div class="flex justify-between text-[11px] text-slate-400">
          <span>Redis Cloud</span>
          <span class="text-emerald-400 font-medium">Synced</span>
        </div>
      </div>
      <a href="http://localhost:3000" target="_blank" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition">
        <span>Open DocuSeal (3000)</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
      </a>
    </div>
  </aside>

  <!-- RIGHT MAIN CONTENT AREA -->
  <div class="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden">

    <!-- VIEW 1: SESSIONS MANAGEMENT -->
    <section id="view-sessions" class="flex-1 flex flex-col p-6 overflow-y-auto">
      <div class="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 class="text-lg font-bold text-slate-900">WhatsApp Sessions</h2>
          <p class="text-xs text-slate-500">Configure paired phone numbers, aliases, labels, and forwarding agents.</p>
        </div>
        <div class="flex items-center gap-2">
          <input id="sessionSearchInput" oninput="filterSessionsList()" type="text" placeholder="Search sessions..." class="text-xs h-9 px-3 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-56"/>
          <button onclick="openCreateModal()" class="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5v14"/></svg>
            Add Session
          </button>
        </div>
      </div>

      <!-- Session Cards Grid -->
      <div id="sessionsGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div class="col-span-full py-12 text-center text-slate-400 text-xs">Loading sessions...</div>
      </div>
    </section>

    <!-- VIEW 2: WHATSAPP WEB CHAT LOG -->
    <section id="view-chat" class="flex-1 flex overflow-hidden hidden">
      <!-- Chat Left Contacts Sidebar -->
      <div class="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div class="p-3.5 border-b border-slate-200 space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="font-bold text-sm text-slate-900">Conversations</h3>
            <button onclick="openNewChatPrompt()" class="text-xs text-emerald-600 font-semibold hover:text-emerald-700 flex items-center gap-1">
              + New Chat
            </button>
          </div>
          <input id="chatSearchInput" oninput="filterChatList()" type="text" placeholder="Search contacts or number..." class="w-full text-xs h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          <div class="flex items-center justify-between pt-1 px-0.5">
            <label class="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-slate-700 hover:text-emerald-700">
              <input type="checkbox" id="onlyAgentsFilter" onchange="filterChatList()" class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer">
              <span>🤖 Only Agents</span>
            </label>
            <span id="chatCountBadge" class="text-[10px] font-mono text-slate-400"></span>
          </div>
        </div>

        <div id="chatContactsList" class="flex-1 overflow-y-auto divide-y divide-slate-100">
          <div class="p-8 text-center text-xs text-slate-400">Loading chat logs...</div>
        </div>
      </div>

      <!-- Chat Right Message Stream & Input -->
      <div class="flex-1 flex flex-col bg-slate-100 overflow-hidden">
        <!-- Active Chat Header -->
        <div id="chatHeader" class="h-16 px-5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-emerald-600/10 text-emerald-700 font-bold flex items-center justify-center text-sm border border-emerald-600/20" id="chatAvatar">
              💬
            </div>
            <div>
              <h4 id="chatActiveName" class="text-sm font-bold text-slate-900 leading-tight">Select a conversation</h4>
              <p id="chatActivePhone" class="text-xs font-mono text-slate-500">No contact selected</p>
            </div>
          </div>
          <div class="flex items-center gap-2" id="chatHeaderActions" style="display:none;">
            <button onclick="triggerQuickDocuSeal()" class="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg font-medium transition flex items-center gap-1.5">
              📄 Send DocuSeal Link
            </button>
            <button onclick="clearCurrentChatThread()" class="text-xs px-2.5 py-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition">
              🗑️ Clear
            </button>
          </div>
        </div>

        <!-- Chat Stream (WhatsApp Wallpaper) -->
        <div id="chatMessagesStream" class="flex-1 p-4 overflow-y-auto chat-bg space-y-3 flex flex-col">
          <div class="flex-1 flex items-center justify-center text-xs text-slate-400">
            Select a conversation on the left to view messages and files.
          </div>
        </div>

        <!-- Chat Input Bar -->
        <div id="chatInputBar" class="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0">
          <input type="file" id="chatFileInput" class="hidden" onchange="handleSendMediaFile(event)"/>
          <button type="button" onclick="document.getElementById('chatFileInput').click()" title="Attach file or image" class="p-2 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-lg transition">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input id="chatTextInput" onkeydown="handleChatInputKeyDown(event)" type="text" placeholder="Type a message..." class="flex-1 text-xs h-9 px-3.5 rounded-lg border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          <button onclick="sendChatMessage()" id="btnChatSend" class="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs flex items-center gap-1 shadow-xs transition">
            <span>Send</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </div>
      </div>
    </section>

    <!-- VIEW 3: DOCUSEAL INTEGRATION -->
    <section id="view-submissions" class="flex-1 flex flex-col p-6 overflow-y-auto hidden">
      <div class="mb-6">
        <h2 class="text-lg font-bold text-slate-900">DocuSeal Integration</h2>
        <p class="text-xs text-slate-500">Send signing requests to WhatsApp and automate completed document delivery.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Send Submission Form -->
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <h3 class="font-bold text-sm text-slate-900">📄 Create Submission & Send via WhatsApp</h3>
          <form onsubmit="handleSendSubmissionForm(event)" class="space-y-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-700">Recipient Phone Number</label>
              <input id="subPhoneInput" type="text" placeholder="e.g. 60123456789" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none" required/>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-700">Recipient Name</label>
              <input id="subNameInput" type="text" placeholder="e.g. John Doe" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-700">DocuSeal Template ID</label>
              <input id="subTemplateInput" type="text" placeholder="e.g. 1" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none" required/>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-700">Custom WhatsApp Message</label>
              <textarea id="subMessageInput" rows="2" placeholder="Please review and sign your contract..." class="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"></textarea>
            </div>
            <button type="submit" id="btnSubSubmit" class="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-xs transition">
              Create Submission & Send WhatsApp
            </button>
          </form>
        </div>

        <!-- Webhook Info Box -->
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
          <h3 class="font-bold text-sm text-slate-900">🔗 Webhook Automation</h3>
          <p class="text-xs text-slate-600 leading-relaxed">
            When a submitter completes and signs their document in DocuSeal, DocuSeal can automatically send the final PDF back to their WhatsApp number.
          </p>
          <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-xs font-mono">
            <span class="text-[11px] text-slate-400 uppercase font-bold">Webhook URL to configure in DocuSeal:</span>
            <div class="text-emerald-700 font-semibold select-all bg-white p-2 rounded border border-slate-200">
              http://whatsapp:4000/api/webhooks/docuseal
            </div>
          </div>
          <p class="text-[11px] text-slate-500">
            Event triggers supported: <code>submission.completed</code>, <code>form.completed</code>.
          </p>
        </div>
      </div>
    </section>

  </div>

  <!-- MANAGE SESSION MODAL -->
  <div id="manageModal" class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
      <div class="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
        <div>
          <h3 class="text-lg font-semibold text-slate-900">Manage Session</h3>
          <p class="text-xs text-slate-500">Configure session settings, forwarding, and test messaging.</p>
        </div>
        <button onclick="closeManageModal()" class="text-slate-400 hover:text-slate-600 rounded-lg p-1.5 hover:bg-slate-100">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="p-5 space-y-4">
        <!-- Banner -->
        <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
          <div class="space-y-1 text-xs">
            <div class="flex items-center gap-2">
              <span class="text-slate-500 font-medium">Session ID:</span>
              <button type="button" onclick="copySessionId()" class="font-mono text-slate-800 font-semibold hover:text-emerald-600 flex items-center gap-1">
                <span id="modalSessionId">session_xxx</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-slate-500 font-medium">Phone:</span>
              <span id="modalPhone" class="font-mono text-slate-800">Not connected</span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span id="modalStatusBadge" class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Connected</span>
            <div class="relative">
              <button onclick="toggleActionsDropdown()" class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-xs">
                Actions
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div id="actionsDropdown" class="hidden absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-slate-200 py-1 text-xs z-20">
                <button onclick="openQrFromModal()" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">📷 Scan QR Code</button>
                <button onclick="reconnectFromModal()" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-blue-600 font-medium">🔄 Reconnect</button>
                <button onclick="logoutFromModal()" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-amber-600 font-medium">🚪 Logout</button>
                <div class="border-t border-slate-100 my-1"></div>
                <button onclick="deleteFromModal()" class="w-full text-left px-3 py-2 hover:bg-red-50 flex items-center gap-2 text-red-600 font-medium">🗑️ Delete Session</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 3 Tabs -->
        <div class="border-b border-slate-200 flex">
          <button onclick="switchTab('settings')" id="tabBtn-settings" class="px-4 py-2.5 text-xs font-semibold border-b-2 border-emerald-600 text-emerald-700 flex-1 text-center">Session settings</button>
          <button onclick="switchTab('forwarding')" id="tabBtn-forwarding" class="px-4 py-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex-1 text-center">Forwarding</button>
          <button onclick="switchTab('testing')" id="tabBtn-testing" class="px-4 py-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex-1 text-center">Testing</button>
        </div>

        <!-- TAB 1 -->
        <div id="tabContent-settings" class="space-y-3 pt-2">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-slate-700">Session Alias (Friendly Name)</label>
            <input id="settingAlias" type="text" placeholder="e.g. Main Store WhatsApp" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-slate-700">Labels / Tags (comma-separated)</label>
            <input id="settingLabels" type="text" placeholder="e.g. marketing, sales, promo" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
          </div>
          <button onclick="saveSessionSettings()" class="w-full h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-xs transition mt-2">
            Save Session Settings
          </button>
        </div>

        <!-- TAB 2 -->
        <div id="tabContent-forwarding" class="space-y-4 pt-2 hidden">
          <p class="text-xs text-slate-500">Forward received customer files and messages to these agent phone numbers.</p>
          <form onsubmit="addAgentPhone(event)" class="flex items-end gap-2">
            <div class="flex-1 space-y-1">
              <label class="text-xs font-medium text-slate-700">Add Agent Phone Number</label>
              <input id="newAgentInput" type="text" placeholder="e.g. 60123456789" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
            </div>
            <button type="submit" class="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs shadow-xs">+ Add</button>
          </form>
          <div class="border border-slate-200 rounded-lg overflow-hidden">
            <ul id="agentsList" class="divide-y divide-slate-200 text-xs">
              <li class="p-3 text-center text-slate-400">No agents added yet.</li>
            </ul>
          </div>
        </div>

        <!-- TAB 3 -->
        <div id="tabContent-testing" class="space-y-3 pt-2 hidden">
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-700">Recipient Phone Number</label>
            <input id="testPhoneInput" type="text" placeholder="e.g. 60123456789" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-700">Test Message</label>
            <textarea id="testTextInput" rows="3" class="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none">Hello! This is a test message from Mobigo WhatsApp.</textarea>
          </div>
          <button onclick="sendTestMessage()" id="btnSendTest" class="w-full h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-xs transition">
            Send Test Message
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- QR MODAL -->
  <div id="qrModal" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl space-y-4 border border-slate-200">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-900 text-base">📱 Pair WhatsApp</h3>
        <button onclick="closeQrModal()" class="text-slate-400 hover:text-slate-600 p-1">✕</button>
      </div>
      <p class="text-xs text-slate-500">Open WhatsApp > Linked Devices > Link a Device, then point camera at this QR code.</p>
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center min-h-[260px]">
        <div id="qrContainer" class="flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
          <div class="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading QR code...</span>
        </div>
      </div>
      <div class="text-xs font-mono text-slate-400" id="qrSessionLabel">Session: mobigo_main</div>
    </div>
  </div>

  <!-- CREATE SESSION MODAL -->
  <div id="createModal" class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-xl p-5 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-slate-900 text-base">Add WhatsApp Session</h3>
        <button onclick="closeCreateModal()" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <form onsubmit="handleCreateSession(event)" class="space-y-3">
        <div class="space-y-1">
          <label class="text-xs font-medium text-slate-700">Session ID</label>
          <input id="newSessionIdInput" type="text" placeholder="e.g. session_sales_1" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none" required/>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-slate-700">Alias</label>
          <input id="newSessionAliasInput" type="text" placeholder="e.g. Sales Branch 1" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium text-slate-700">Labels</label>
          <input id="newSessionLabelsInput" type="text" placeholder="e.g. sales, support" class="w-full text-xs h-9 px-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"/>
        </div>
        <button type="submit" class="w-full h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs transition">Create & Initialize</button>
      </form>
    </div>
  </div>

  <script>
    let allSessions = [];
    let currentSession = null;
    let allConversations = [];
    let activeChatPhone = null;
    let qrPollInterval = null;
    let chatPollInterval = null;

    function navigateView(viewName) {
      ['sessions', 'chat', 'submissions'].forEach(v => {
        const el = document.getElementById('view-' + v);
        const nav = document.getElementById('nav-' + v);
        if (v === viewName) {
          el.classList.remove('hidden');
          nav.className = 'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 transition';
        } else {
          el.classList.add('hidden');
          nav.className = 'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition';
        }
      });

      if (viewName === 'chat') {
        loadConversations();
        if (chatPollInterval) clearInterval(chatPollInterval);
        chatPollInterval = setInterval(loadConversations, 4000);
      } else {
        if (chatPollInterval) clearInterval(chatPollInterval);
      }
    }

    async function loadSessions() {
      try {
        const res = await fetch('/api/whatsapp-sessions');
        allSessions = await res.json();
        renderSessionsGrid(allSessions);
        document.getElementById('navSessionsCount').textContent = allSessions.length;
        const main = allSessions.find(s => s.phone_number) || allSessions[0];
        if (main && main.phone_number) {
          document.getElementById('sidebarPhone').textContent = '+' + main.phone_number;
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
    }

    function renderSessionsGrid(sessions) {
      const container = document.getElementById('sessionsGrid');
      if (!sessions || sessions.length === 0) {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">No sessions found.</div>';
        return;
      }

      container.innerHTML = sessions.map(s => {
        const isConn = (s.status || '').toUpperCase() === 'CONNECTED';
        const badgeClass = isConn ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200';
        const badgeText = isConn ? 'Connected' : 'Disconnected';

        return \`
          <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition">
            <div class="space-y-3">
              <div class="flex items-start justify-between">
                <div>
                  <h3 class="font-bold text-sm text-slate-900">\${s.alias || s.session_id}</h3>
                  <div class="font-mono text-xs text-slate-400">\${s.session_id}</div>
                </div>
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border \${badgeClass}">\${badgeText}</span>
              </div>
              <div class="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div class="flex justify-between">
                  <span class="text-slate-400">Phone:</span>
                  <span class="font-mono font-medium">\${s.phone_number ? '+' + s.phone_number : 'Not connected'}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-400">Push Name:</span>
                  <span>\${s.push_name || '-'}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-400">Forwarding Agents:</span>
                  <span>\${(s.agent_phone_numbers || []).length}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
              <button onclick="openManageModal('\${s.session_id}')" class="flex-1 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-xs transition">Manage Session</button>
              <button onclick="openQrModal('\${s.session_id}')" class="h-8 px-3 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium text-xs">📷 Scan</button>
            </div>
          </div>
        \`;
      }).join('');
    }

    // CHAT SYSTEM
    async function loadConversations() {
      try {
        const res = await fetch('/api/chats');
        const data = await res.json();
        allConversations = data.conversations || [];
        filterChatList();

        if (activeChatPhone) {
          loadMessagesForActiveChat(activeChatPhone);
        }
      } catch (err) {
        console.error('Failed to load chats:', err);
      }
    }

    function renderChatContacts(convs) {
      const container = document.getElementById('chatContactsList');
      if (!convs || convs.length === 0) {
        container.innerHTML = '<div class="p-8 text-center text-xs text-slate-400">No conversations matching filter.</div>';
        return;
      }

      container.innerHTML = convs.map(c => {
        const isActive = c.contact_phone === activeChatPhone;
        const activeClass = isActive ? 'bg-emerald-50 border-r-4 border-emerald-600' : 'hover:bg-slate-50';
        const timeStr = c.last_timestamp ? new Date(c.last_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const phoneLabel = c.contact_phone && c.contact_phone.length <= 13 ? '+' + c.contact_phone : '';
        const titleName = c.contact_name || phoneLabel || 'WhatsApp Contact';

        return \`
          <div onclick="selectChatContact('\${c.contact_phone}', '\${c.contact_name || ''}')" class="p-3.5 flex items-center gap-3 cursor-pointer transition \${activeClass}">
            <div class="w-10 h-10 rounded-full \${c.is_agent ? 'bg-purple-100 text-purple-700' : 'bg-emerald-600/10 text-emerald-700'} font-bold flex items-center justify-center text-xs shrink-0">
              \${c.is_agent ? '🤖' : '👤'}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-center mb-0.5">
                <div class="flex items-center gap-1.5 truncate">
                  <span class="font-bold text-xs text-slate-900 truncate">\${titleName}</span>
                  \${c.is_agent ? '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-800 border border-purple-200 shrink-0">Agent</span>' : ''}
                </div>
                <span class="text-[10px] text-slate-400 shrink-0">\${timeStr}</span>
              </div>
              <p class="text-xs text-slate-500 truncate">\${c.last_message || 'Media file'}</p>
            </div>
          </div>
        \`;
      }).join('');
    }

    function selectChatContact(phone, name) {
      activeChatPhone = phone;
      const isLid = phone && (phone.length > 13 || phone.startsWith('112') || phone.startsWith('202'));
      const phoneLabel = !isLid && phone && phone.length <= 13 ? '+' + phone : '';
      const titleName = name || phoneLabel || 'WhatsApp Contact';
      document.getElementById('chatActiveName').textContent = titleName;
      document.getElementById('chatActivePhone').textContent = phoneLabel || (name ? 'WhatsApp Account' : 'ID: ' + phone);
      document.getElementById('chatHeaderActions').style.display = 'flex';
      renderChatContacts(allConversations);
      loadMessagesForActiveChat(phone);
    }

    async function loadMessagesForActiveChat(phone) {
      try {
        const res = await fetch(\`/api/chats/\${phone}/messages\`);
        const data = await res.json();
        renderChatMessages(data.messages || []);
      } catch (err) {
        console.error('Error fetching messages:', err);
      }
    }

    function renderChatMessages(messages) {
      const container = document.getElementById('chatMessagesStream');
      if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="flex-1 flex items-center justify-center text-xs text-slate-400">No messages in this conversation.</div>';
        return;
      }

      container.innerHTML = messages.map(m => {
        const isOut = m.direction === 'OUTBOUND';
        const alignClass = isOut ? 'self-end bg-[#d9fdd3] text-slate-900 rounded-tr-none' : 'self-start bg-white text-slate-900 rounded-tl-none';
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        let mediaHtml = '';
        if (m.has_media) {
          if (m.media_type === 'image' && m.file_url) {
            mediaHtml = \`<div class="mb-2"><a href="\${m.file_url}" target="_blank"><img src="\${m.file_url}" class="max-w-xs rounded-lg max-h-60 object-cover shadow-xs hover:opacity-95" alt="Image"/></a></div>\`;
          } else {
            mediaHtml = \`
              <div class="mb-2 p-2.5 bg-black/5 rounded-lg flex items-center gap-2 border border-black/5">
                <span class="text-xl">📄</span>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-xs truncate">\${m.file_name || 'Document.pdf'}</div>
                  \${m.file_url ? \`<a href="\${m.file_url}" target="_blank" class="text-[11px] text-emerald-700 hover:underline font-semibold">Open / Download &darr;</a>\` : ''}
                </div>
              </div>
            \`;
          }
        }

        return \`
          <div class="max-w-[75%] p-3 rounded-2xl shadow-xs text-xs \${alignClass} space-y-1">
            \${mediaHtml}
            \${m.text ? \`<div class="whitespace-pre-wrap leading-relaxed">\${m.text}</div>\` : ''}
            <div class="text-[10px] text-slate-400 text-right flex items-center justify-end gap-1 mt-1">
              <span>\${timeStr}</span>
              \${isOut ? '<span>✓✓</span>' : ''}
            </div>
          </div>
        \`;
      }).join('');

      container.scrollTop = container.scrollHeight;
    }

    async function sendChatMessage() {
      if (!activeChatPhone) {
        alert('Please select a contact first.');
        return;
      }
      const input = document.getElementById('chatTextInput');
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      try {
        await fetch(\`/api/chats/\${activeChatPhone}/send\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        await loadMessagesForActiveChat(activeChatPhone);
        await loadConversations();
      } catch (err) {
        alert('Failed to send message: ' + err.message);
      }
    }

    function handleChatInputKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
      }
    }

    async function handleSendMediaFile(e) {
      const file = e.target.files?.[0];
      if (!file || !activeChatPhone) return;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', file.name);

      try {
        await fetch(\`/api/chats/\${activeChatPhone}/send-media\`, {
          method: 'POST',
          body: formData
        });
        e.target.value = '';
        await loadMessagesForActiveChat(activeChatPhone);
        await loadConversations();
      } catch (err) {
        alert('Failed to upload & send file: ' + err.message);
      }
    }

    function openNewChatPrompt() {
      const phone = prompt('Enter recipient WhatsApp phone number (e.g. 60123456789):');
      if (phone) {
        const clean = phone.replace(/[^0-9]/g, '');
        selectChatContact(clean, '+' + clean);
      }
    }

    async function triggerQuickDocuSeal() {
      if (!activeChatPhone) return;
      navigateView('submissions');
      document.getElementById('subPhoneInput').value = activeChatPhone;
    }

    async function clearCurrentChatThread() {
      if (!activeChatPhone || !confirm('Clear all chat messages for this contact?')) return;
      try {
        await fetch(\`/api/chats/\${activeChatPhone}\`, { method: 'DELETE' });
        await loadMessagesForActiveChat(activeChatPhone);
        await loadConversations();
      } catch (_) {}
    }

    // DOCUSEAL FORM SUBMISSION
    async function handleSendSubmissionForm(e) {
      e.preventDefault();
      const phone = document.getElementById('subPhoneInput').value.trim();
      const name = document.getElementById('subNameInput').value.trim();
      const template_id = document.getElementById('subTemplateInput').value.trim();
      const custom_message = document.getElementById('subMessageInput').value.trim();

      const btn = document.getElementById('btnSubSubmit');
      btn.disabled = true;
      btn.textContent = 'Creating & Sending...';

      try {
        const res = await fetch('/api/messages/send-submission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, name, template_id, custom_message })
        });
        const data = await res.json();
        if (data.success) {
          alert('DocuSeal Submission created and signing link sent via WhatsApp!');
          navigateView('chat');
          selectChatContact(phone, name || '+' + phone);
        } else {
          alert('Error: ' + (data.error || 'Failed to create submission'));
        }
      } catch (err) {
        alert('Submission error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Submission & Send WhatsApp';
      }
    }

    // MODAL HANDLERS
    function openManageModal(sessionId) {
      currentSession = allSessions.find(s => s.session_id === sessionId);
      if (!currentSession) return;

      document.getElementById('modalSessionId').textContent = currentSession.session_id;
      document.getElementById('modalPhone').textContent = currentSession.phone_number ? '+' + currentSession.phone_number : 'Not connected';
      
      const isConn = (currentSession.status || '').toUpperCase() === 'CONNECTED';
      const badge = document.getElementById('modalStatusBadge');
      badge.textContent = isConn ? 'Connected' : 'Disconnected';
      badge.className = isConn ? 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200' : 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200';

      document.getElementById('settingAlias').value = currentSession.alias || '';
      document.getElementById('settingLabels').value = (currentSession.labels || []).join(', ');
      
      renderAgentsList(currentSession.agent_phone_numbers || []);
      switchTab('settings');
      document.getElementById('manageModal').classList.remove('hidden');
    }

    function closeManageModal() {
      document.getElementById('manageModal').classList.add('hidden');
      document.getElementById('actionsDropdown').classList.add('hidden');
      currentSession = null;
    }

    function toggleActionsDropdown() {
      document.getElementById('actionsDropdown').classList.toggle('hidden');
    }

    function copySessionId() {
      if (currentSession) {
        navigator.clipboard.writeText(currentSession.session_id);
        alert('Session ID copied to clipboard!');
      }
    }

    function switchTab(tab) {
      ['settings', 'forwarding', 'testing'].forEach(t => {
        document.getElementById('tabContent-' + t).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById('tabBtn-' + t);
        if (t === tab) {
          btn.className = 'px-4 py-2.5 text-xs font-semibold border-b-2 border-emerald-600 text-emerald-700 flex-1 text-center';
        } else {
          btn.className = 'px-4 py-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex-1 text-center';
        }
      });
    }

    async function saveSessionSettings() {
      if (!currentSession) return;
      const alias = document.getElementById('settingAlias').value.trim();
      const labels = document.getElementById('settingLabels').value.split(',').map(s => s.trim()).filter(Boolean);

      try {
        const res = await fetch(\`/api/whatsapp-sessions/\${currentSession.session_id}\`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias, labels })
        });
        if (res.ok) {
          alert('Session settings saved successfully!');
          await loadSessions();
          closeManageModal();
        }
      } catch (err) {
        alert('Failed to save session settings: ' + err.message);
      }
    }

    function renderAgentsList(agents) {
      const container = document.getElementById('agentsList');
      if (!agents || agents.length === 0) {
        container.innerHTML = '<li class="p-3 text-center text-slate-400">No agents added yet.</li>';
        return;
      }
      container.innerHTML = agents.map(a => \`
        <li class="p-3 flex justify-between items-center bg-slate-50">
          <span class="font-medium text-slate-800">+\${a.phone_number}</span>
          <button onclick="deleteAgentPhone('\${a.id}')" class="text-red-500 hover:text-red-700 text-xs px-2 py-1 hover:bg-red-50 rounded">Remove</button>
        </li>
      \`).join('');
    }

    async function addAgentPhone(e) {
      e.preventDefault();
      if (!currentSession) return;
      const input = document.getElementById('newAgentInput');
      const phone = input.value.trim();
      if (!phone) return;

      try {
        const res = await fetch('/api/agent-phone-numbers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: currentSession.session_id, phone_number: phone })
        });
        if (res.ok) {
          input.value = '';
          await loadSessions();
          const updated = allSessions.find(s => s.session_id === currentSession.session_id);
          if (updated) {
            currentSession = updated;
            renderAgentsList(updated.agent_phone_numbers || []);
          }
        }
      } catch (err) {
        alert('Failed to add agent: ' + err.message);
      }
    }

    async function deleteAgentPhone(agentId) {
      if (!confirm('Are you sure you want to remove this agent number?')) return;
      try {
        await fetch(\`/api/agent-phone-numbers/\${agentId}\`, { method: 'DELETE' });
        await loadSessions();
        const updated = allSessions.find(s => s.session_id === currentSession.session_id);
        if (updated) {
          currentSession = updated;
          renderAgentsList(updated.agent_phone_numbers || []);
        }
      } catch (err) {
        alert('Failed to delete agent: ' + err.message);
      }
    }

    async function sendTestMessage() {
      if (!currentSession) return;
      const phone = document.getElementById('testPhoneInput').value.trim();
      const text = document.getElementById('testTextInput').value.trim();
      if (!phone || !text) {
        alert('Please enter recipient phone number and message.');
        return;
      }
      try {
        const res = await fetch(\`/api/messages/\${currentSession.session_id}/send-text\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, text })
        });
        const data = await res.json();
        if (data.success) {
          alert('Test message sent successfully!');
        } else {
          alert('Failed to send: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    function openQrModal(sessionId) {
      document.getElementById('qrSessionLabel').textContent = 'Session: ' + sessionId;
      document.getElementById('qrContainer').innerHTML = '<div class="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>';
      document.getElementById('qrModal').classList.remove('hidden');

      if (qrPollInterval) clearInterval(qrPollInterval);
      pollQrCode(sessionId);
      qrPollInterval = setInterval(() => pollQrCode(sessionId), 3000);
    }

    async function pollQrCode(sessionId) {
      try {
        const res = await fetch(\`/api/whatsapp-sessions/\${sessionId}/qr\`);
        const data = await res.json();
        const container = document.getElementById('qrContainer');

        if (data.status === 'CONNECTED') {
          container.innerHTML = '<div class="text-emerald-600 font-bold text-sm">✅ Connected Successfully!</div>';
          clearInterval(qrPollInterval);
          await loadSessions();
          setTimeout(closeQrModal, 2000);
          return;
        }

        if (data.qr_code || data.qrBase64) {
          const src = data.qr_code || data.qrBase64;
          container.innerHTML = \`<img src="\${src}" class="w-56 h-56 rounded-lg border border-slate-200" alt="QR"/>\`;
        }
      } catch (_) {}
    }

    function closeQrModal() {
      document.getElementById('qrModal').classList.add('hidden');
      if (qrPollInterval) clearInterval(qrPollInterval);
    }

    function openQrFromModal() {
      const sId = currentSession?.session_id;
      closeManageModal();
      if (sId) openQrModal(sId);
    }

    async function reconnectFromModal() {
      if (!currentSession) return;
      try {
        await fetch(\`/api/whatsapp-sessions/\${currentSession.session_id}/reconnect\`, { method: 'POST' });
        alert('Reconnecting session...');
        closeManageModal();
        await loadSessions();
      } catch (err) {
        alert('Failed to reconnect: ' + err.message);
      }
    }

    async function logoutFromModal() {
      if (!currentSession) return;
      if (!confirm('Are you sure you want to log out this WhatsApp session?')) return;
      try {
        await fetch(\`/api/whatsapp-sessions/\${currentSession.session_id}/logout\`, { method: 'POST' });
        alert('Session logged out.');
        closeManageModal();
        await loadSessions();
      } catch (err) {
        alert('Failed to logout: ' + err.message);
      }
    }

    async function deleteFromModal() {
      if (!currentSession) return;
      if (!confirm('Are you sure you want to permanently delete this session?')) return;
      try {
        await fetch(\`/api/whatsapp-sessions/\${currentSession.session_id}\`, { method: 'DELETE' });
        closeManageModal();
        await loadSessions();
      } catch (err) {
        alert('Failed to delete session: ' + err.message);
      }
    }

    function openCreateModal() {
      document.getElementById('newSessionIdInput').value = 'session_' + Date.now();
      document.getElementById('newSessionAliasInput').value = '';
      document.getElementById('newSessionLabelsInput').value = '';
      document.getElementById('createModal').classList.remove('hidden');
    }

    function closeCreateModal() {
      document.getElementById('createModal').classList.add('hidden');
    }

    async function handleCreateSession(e) {
      e.preventDefault();
      const sessionId = document.getElementById('newSessionIdInput').value.trim();
      const alias = document.getElementById('newSessionAliasInput').value.trim();
      const labels = document.getElementById('newSessionLabelsInput').value.split(',').map(s => s.trim()).filter(Boolean);

      try {
        const res = await fetch('/api/whatsapp-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, alias, labels })
        });
        if (res.ok) {
          closeCreateModal();
          await loadSessions();
          openQrModal(sessionId);
        }
      } catch (err) {
        alert('Failed to create session: ' + err.message);
      }
    }

    function filterSessionsList() {
      const q = document.getElementById('sessionSearchInput').value.toLowerCase();
      const filtered = allSessions.filter(s => 
        s.session_id.toLowerCase().includes(q) ||
        (s.alias && s.alias.toLowerCase().includes(q)) ||
        (s.phone_number && s.phone_number.includes(q))
      );
      renderSessionsGrid(filtered);
    }

    function filterChatList() {
      const q = (document.getElementById('chatSearchInput')?.value || '').toLowerCase();
      const onlyAgents = document.getElementById('onlyAgentsFilter')?.checked || false;

      let filtered = allConversations || [];
      if (onlyAgents) {
        filtered = filtered.filter(c => c.is_agent);
      }
      if (q) {
        filtered = filtered.filter(c => 
          c.contact_phone.includes(q) ||
          (c.contact_name && c.contact_name.toLowerCase().includes(q)) ||
          (c.last_message && c.last_message.toLowerCase().includes(q))
        );
      }

      const countBadge = document.getElementById('chatCountBadge');
      if (countBadge) {
        countBadge.textContent = \`\${filtered.length} of \${allConversations.length}\`;
      }

      renderChatContacts(filtered);
    }

    // Start
    loadSessions();
  </script>
</body>
</html>`;
}
