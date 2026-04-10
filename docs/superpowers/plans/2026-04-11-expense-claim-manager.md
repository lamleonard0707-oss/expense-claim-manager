# Expense Claim Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PWA expense claim manager that lets two users capture receipts (photo + text), auto-extract details via Gemini AI, store locally in IndexedDB, and auto-sync to Google Sheets with receipt photos on Google Drive.

**Architecture:** Offline-first PWA with IndexedDB for local storage. Gemini 2.0 Flash for receipt OCR with conversational clarification. Google Apps Script as backend for Sheets sync + Drive upload. Same stack as existing salary-calculator (HTML/CSS/JS, no framework).

**Tech Stack:** HTML5, CSS3, vanilla JS, IndexedDB, Service Worker, Gemini 2.0 Flash API, Google Apps Script, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-04-11-expense-claim-manager-design.md`

---

## File Structure

```
expense-claim/
├── index.html              # Single page app shell with all views
├── style.css               # All styles, project color theming, mobile-first
├── app.js                  # Main app logic: routing, UI, event handlers
├── db.js                   # IndexedDB wrapper: CRUD for records + projects
├── ai.js                   # Gemini Flash API: receipt OCR + smart assistant logic
├── sync.js                 # Google Sheets + Drive sync logic
├── sw.js                   # Service worker for offline caching
├── manifest.json           # PWA manifest
├── icon-192.png            # App icon (192x192)
├── icon-512.png            # App icon (512x512)
└── google-apps-script.js   # Server-side: Sheets append + Drive upload (deploy separately)
```

---

## Task 1: PWA Shell + Setup Screen

**Files:**
- Create: `expense-claim/index.html`
- Create: `expense-claim/style.css`
- Create: `expense-claim/app.js`
- Create: `expense-claim/manifest.json`
- Create: `expense-claim/sw.js`

- [ ] **Step 1: Create manifest.json**

```json
{
  "name": "Expense Claim Manager",
  "short_name": "Claim",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Create service worker (sw.js)**

```js
const CACHE_NAME = 'expense-claim-v1';
const ASSETS = ['/', 'index.html', 'style.css', 'app.js', 'db.js', 'ai.js', 'sync.js', 'manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ));
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request))
    );
});
```

- [ ] **Step 3: Create index.html with all view containers**

The HTML contains all views as hidden `<section>` elements. Only one is visible at a time. Views:
- `#setup-view` — first-time setup (name + passcode)
- `#dashboard-view` — project cards with monthly totals
- `#add-view` — add new expense (photo/text + AI chat)
- `#records-view` — expense list with filters
- `#projects-view` — manage projects
- `#settings-view` — user settings, API keys, Sheets link

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Expense Claim Manager</title>
    <link rel="manifest" href="manifest.json">
    <meta name="theme-color" content="#e94560">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <!-- Setup (first launch only) -->
    <section id="setup-view" class="view">
        <div class="setup-container">
            <h1>Expense Claim</h1>
            <p>首次設定</p>
            <input type="text" id="setup-name" placeholder="你嘅名" maxlength="20">
            <input type="password" id="setup-passcode" placeholder="4位數密碼" maxlength="4" inputmode="numeric" pattern="[0-9]*">
            <input type="password" id="setup-passcode-confirm" placeholder="再輸入一次密碼" maxlength="4" inputmode="numeric" pattern="[0-9]*">
            <button id="setup-save-btn" class="btn-primary">開始用</button>
        </div>
    </section>

    <!-- Dashboard -->
    <section id="dashboard-view" class="view hidden">
        <header class="app-header">
            <h1>Expense Claim</h1>
            <div class="header-actions">
                <button id="month-prev" class="btn-icon">◀</button>
                <span id="current-month"></span>
                <button id="month-next" class="btn-icon">▶</button>
            </div>
        </header>
        <div id="dashboard-summary" class="summary-bar"></div>
        <div id="project-cards" class="project-cards"></div>
        <button id="add-fab" class="fab">+</button>
        <nav class="bottom-nav">
            <button class="nav-btn active" data-view="dashboard">主頁</button>
            <button class="nav-btn" data-view="records">紀錄</button>
            <button class="nav-btn" data-view="projects">項目</button>
            <button class="nav-btn" data-view="settings">設定</button>
        </nav>
    </section>

    <!-- Add Expense -->
    <section id="add-view" class="view hidden">
        <header class="app-header">
            <button id="add-back" class="btn-icon">←</button>
            <h2>新增支出</h2>
        </header>
        <div id="project-selector" class="project-selector"></div>
        <div class="input-toggle">
            <button id="input-photo" class="toggle-btn active">📷 影相</button>
            <button id="input-text" class="toggle-btn">✏️ 文字</button>
        </div>
        <div id="photo-input" class="input-section">
            <input type="file" id="camera-input" accept="image/*" capture="environment">
            <div id="photo-preview" class="photo-preview"></div>
        </div>
        <div id="text-input" class="input-section hidden">
            <textarea id="text-expense" placeholder="例：五金鋪雜項 $46"></textarea>
        </div>
        <div id="ai-chat" class="ai-chat hidden"></div>
        <div id="expense-form" class="expense-form hidden">
            <label>描述 <input type="text" id="form-desc"></label>
            <label>金額 <input type="number" id="form-amount" step="0.01"></label>
            <div class="form-row">
                <label>貨幣 <select id="form-currency"><option value="HKD">HKD</option><option value="RMB">RMB</option></select></label>
                <label>日期 <input type="date" id="form-date"></label>
            </div>
            <label>付款方式 <select id="form-payment">
                <option value="現金">現金</option>
                <option value="信用卡">信用卡</option>
                <option value="淘寶">淘寶</option>
                <option value="拼多多">拼多多</option>
                <option value="轉數快">轉數快</option>
                <option value="支付寶">支付寶</option>
                <option value="其他">其他</option>
            </select></label>
            <button id="save-expense-btn" class="btn-primary">儲存</button>
        </div>
    </section>

    <!-- Records List -->
    <section id="records-view" class="view hidden">
        <header class="app-header">
            <h2>紀錄</h2>
            <button id="bulk-claim-btn" class="btn-small hidden">Mark Claimed</button>
        </header>
        <div class="filters">
            <select id="filter-project"><option value="">全部項目</option></select>
            <select id="filter-status">
                <option value="">全部狀態</option>
                <option value="unclaimed">未 Claim</option>
                <option value="claimed">已 Claim</option>
            </select>
        </div>
        <div id="records-list" class="records-list"></div>
        <nav class="bottom-nav">
            <button class="nav-btn" data-view="dashboard">主頁</button>
            <button class="nav-btn active" data-view="records">紀錄</button>
            <button class="nav-btn" data-view="projects">項目</button>
            <button class="nav-btn" data-view="settings">設定</button>
        </nav>
    </section>

    <!-- Project Management -->
    <section id="projects-view" class="view hidden">
        <header class="app-header">
            <h2>項目管理</h2>
            <button id="add-project-btn" class="btn-small">+ 新增</button>
        </header>
        <div id="projects-list" class="projects-list"></div>
        <div id="project-form" class="modal hidden">
            <div class="modal-content">
                <h3 id="project-form-title">新增項目</h3>
                <input type="text" id="project-name" placeholder="項目名稱">
                <div id="color-picker" class="color-picker"></div>
                <div class="modal-actions">
                    <button id="project-cancel" class="btn-secondary">取消</button>
                    <button id="project-save" class="btn-primary">儲存</button>
                </div>
            </div>
        </div>
        <nav class="bottom-nav">
            <button class="nav-btn" data-view="dashboard">主頁</button>
            <button class="nav-btn" data-view="records">紀錄</button>
            <button class="nav-btn active" data-view="projects">項目</button>
            <button class="nav-btn" data-view="settings">設定</button>
        </nav>
    </section>

    <!-- Settings -->
    <section id="settings-view" class="view hidden">
        <header class="app-header">
            <h2>設定</h2>
        </header>
        <div class="settings-list">
            <div class="setting-item">
                <label>用戶名稱</label>
                <input type="text" id="setting-name" readonly>
            </div>
            <div class="setting-item">
                <label>Gemini API Key</label>
                <input type="password" id="setting-gemini-key" placeholder="輸入 API Key">
                <button id="save-gemini-key" class="btn-small">儲存</button>
            </div>
            <div class="setting-item">
                <label>Google Apps Script URL</label>
                <input type="url" id="setting-apps-script-url" placeholder="輸入 Web App URL">
                <button id="save-apps-script-url" class="btn-small">儲存</button>
            </div>
            <div class="setting-item">
                <button id="change-passcode" class="btn-secondary">更改密碼</button>
            </div>
        </div>
        <nav class="bottom-nav">
            <button class="nav-btn" data-view="dashboard">主頁</button>
            <button class="nav-btn" data-view="records">紀錄</button>
            <button class="nav-btn" data-view="projects">項目</button>
            <button class="nav-btn active" data-view="settings">設定</button>
        </nav>
    </section>

    <script src="db.js"></script>
    <script src="ai.js"></script>
    <script src="sync.js"></script>
    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create app.js with view routing + setup flow**

```js
// app.js — Main app logic

const App = {
    currentView: null,
    currentMonth: new Date(),
    user: null,

    init() {
        this.user = JSON.parse(localStorage.getItem('claimUser'));
        if (!this.user) {
            this.showView('setup');
        } else {
            this.showView('dashboard');
            this.loadDashboard();
        }
        this.bindNavigation();
        this.bindSetup();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js');
        }
    },

    showView(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(`${name}-view`).classList.remove('hidden');
        this.currentView = name;
    },

    bindNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.showView(view);
                // Update active state across all nav bars
                document.querySelectorAll(`.nav-btn[data-view="${view}"]`).forEach(b => {
                    b.closest('.bottom-nav').querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
                    b.classList.add('active');
                });
                if (view === 'dashboard') this.loadDashboard();
                if (view === 'records') this.loadRecords();
                if (view === 'projects') this.loadProjects();
                if (view === 'settings') this.loadSettings();
            });
        });
    },

    bindSetup() {
        document.getElementById('setup-save-btn').addEventListener('click', () => {
            const name = document.getElementById('setup-name').value.trim();
            const pass = document.getElementById('setup-passcode').value;
            const passConfirm = document.getElementById('setup-passcode-confirm').value;
            if (!name) return alert('請輸入名稱');
            if (pass.length !== 4 || !/^\d{4}$/.test(pass)) return alert('密碼要4位數字');
            if (pass !== passConfirm) return alert('兩次密碼唔一樣');
            this.user = { name, passcode: pass };
            localStorage.setItem('claimUser', JSON.stringify(this.user));
            this.initDefaultProjects();
            this.showView('dashboard');
            this.loadDashboard();
        });
    },

    async initDefaultProjects() {
        const existing = await DB.getProjects();
        if (existing.length === 0) {
            await DB.addProject({ name: 'Partyland MK', color: '#e94560' });
            await DB.addProject({ name: 'Fancy Free BBQ Party Room', color: '#0f3460' });
        }
    },

    async loadDashboard() {
        const month = this.currentMonth;
        const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById('current-month').textContent = `${month.getFullYear()}年${month.getMonth() + 1}月`;

        const projects = await DB.getProjects();
        const records = await DB.getRecordsByMonth(monthStr);

        let totalUnclaimed = 0;
        const cardsHtml = projects.map(p => {
            const projectRecords = records.filter(r => r.project === p.name);
            const unclaimed = projectRecords.filter(r => r.claimStatus === 'unclaimed');
            const total = unclaimed.reduce((sum, r) => sum + r.amount, 0);
            totalUnclaimed += total;
            return `<div class="project-card" style="border-left: 4px solid ${p.color}">
                <div class="card-name" style="color: ${p.color}">${p.name}</div>
                <div class="card-amount">$${total.toFixed(2)}</div>
                <div class="card-count">${projectRecords.length} 筆紀錄 · ${unclaimed.length} 筆未 claim</div>
            </div>`;
        }).join('');

        document.getElementById('dashboard-summary').innerHTML = `<div class="total-unclaimed">未 Claim 總額：<strong>$${totalUnclaimed.toFixed(2)}</strong></div>`;
        document.getElementById('project-cards').innerHTML = cardsHtml;

        // Month navigation
        document.getElementById('month-prev').onclick = () => { this.currentMonth.setMonth(this.currentMonth.getMonth() - 1); this.loadDashboard(); };
        document.getElementById('month-next').onclick = () => { this.currentMonth.setMonth(this.currentMonth.getMonth() + 1); this.loadDashboard(); };

        // FAB
        document.getElementById('add-fab').onclick = () => this.openAddExpense();
    },

    async openAddExpense() {
        this.showView('add');
        const projects = await DB.getProjects();
        document.getElementById('project-selector').innerHTML = projects.map(p =>
            `<button class="project-btn" data-project="${p.name}" style="background:${p.color}">${p.name}</button>`
        ).join('');

        document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('expense-form').classList.add('hidden');
        document.getElementById('ai-chat').classList.add('hidden');
        document.getElementById('ai-chat').innerHTML = '';

        // Project selection
        document.querySelectorAll('.project-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.project-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        // Input toggle
        document.getElementById('input-photo').onclick = () => {
            document.getElementById('input-photo').classList.add('active');
            document.getElementById('input-text').classList.remove('active');
            document.getElementById('photo-input').classList.remove('hidden');
            document.getElementById('text-input').classList.add('hidden');
        };
        document.getElementById('input-text').onclick = () => {
            document.getElementById('input-text').classList.add('active');
            document.getElementById('input-photo').classList.remove('active');
            document.getElementById('text-input').classList.remove('hidden');
            document.getElementById('photo-input').classList.add('hidden');
        };

        // Camera input
        document.getElementById('camera-input').onchange = (e) => this.handlePhoto(e);

        // Text submit
        document.getElementById('text-expense').onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleTextInput(); }
        };

        // Back button
        document.getElementById('add-back').onclick = () => { this.showView('dashboard'); this.loadDashboard(); };

        // Save button
        document.getElementById('save-expense-btn').onclick = () => this.saveExpense();
    },

    async handlePhoto(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const base64 = ev.target.result;
            document.getElementById('photo-preview').innerHTML = `<img src="${base64}" alt="receipt">`;
            this.currentPhotoBase64 = base64;
            await this.runAI(base64, 'photo');
        };
        reader.readAsDataURL(file);
    },

    async handleTextInput() {
        const text = document.getElementById('text-expense').value.trim();
        if (!text) return;
        await this.runAI(text, 'text');
    },

    async runAI(input, type) {
        const chatEl = document.getElementById('ai-chat');
        chatEl.classList.remove('hidden');
        chatEl.innerHTML = '<div class="ai-msg">分析緊...</div>';

        const geminiKey = localStorage.getItem('geminiKey');
        if (!geminiKey) {
            chatEl.innerHTML = '<div class="ai-msg error">請先去設定輸入 Gemini API Key</div>';
            return;
        }

        const projects = await DB.getProjects();
        const recentRecords = await DB.getRecentRecords(30); // last 30 records for context
        const result = await AI.analyze(input, type, geminiKey, projects, recentRecords);

        if (result.error) {
            chatEl.innerHTML = `<div class="ai-msg error">${result.error}</div>`;
            return;
        }

        // Show AI conversation
        let html = `<div class="ai-msg">${result.message}</div>`;
        if (result.questions && result.questions.length > 0) {
            html += result.questions.map(q =>
                `<div class="ai-question">${q.text}
                    ${q.options ? q.options.map(o => `<button class="ai-option" data-field="${q.field}" data-value="${o.value}">${o.label}</button>`).join('') : ''}
                </div>`
            ).join('');
        }
        chatEl.innerHTML = html;

        // Fill form with extracted data
        if (result.description) document.getElementById('form-desc').value = result.description;
        if (result.amount) document.getElementById('form-amount').value = result.amount;
        if (result.currency) document.getElementById('form-currency').value = result.currency;
        if (result.date) document.getElementById('form-date').value = result.date;
        if (result.paymentMethod) document.getElementById('form-payment').value = result.paymentMethod;
        document.getElementById('expense-form').classList.remove('hidden');

        // Bind AI option buttons
        chatEl.querySelectorAll('.ai-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const field = btn.dataset.field;
                const value = btn.dataset.value;
                if (field === 'amount') document.getElementById('form-amount').value = value;
                if (field === 'currency') document.getElementById('form-currency').value = value;
                if (field === 'date') document.getElementById('form-date').value = value;
                if (field === 'description') document.getElementById('form-desc').value = value;
                if (field === 'split') { /* handle multi-item split later */ }
                btn.closest('.ai-question').innerHTML = `<div class="ai-confirmed">✓ ${btn.textContent}</div>`;
            });
        });
    },

    async saveExpense() {
        const selectedProject = document.querySelector('.project-btn.selected');
        if (!selectedProject) return alert('請揀項目');
        const amount = parseFloat(document.getElementById('form-amount').value);
        if (!amount || amount <= 0) return alert('請輸入金額');

        const record = {
            id: crypto.randomUUID(),
            project: selectedProject.dataset.project,
            amount,
            currency: document.getElementById('form-currency').value,
            description: document.getElementById('form-desc').value,
            paymentDate: document.getElementById('form-date').value,
            paymentMethod: document.getElementById('form-payment').value,
            paidBy: this.user.name,
            claimStatus: 'unclaimed',
            claimDate: null,
            receiptPhoto: this.currentPhotoBase64 || null,
            createdAt: new Date().toISOString(),
            syncedAt: null
        };

        // Duplicate detection
        const isDuplicate = await DB.checkDuplicate(record);
        if (isDuplicate) {
            const dupMsg = `呢筆好似同 ${isDuplicate.paymentDate} 嗰筆「${isDuplicate.description} $${isDuplicate.amount}」重複，係咪重複咗？`;
            if (!confirm(dupMsg + '\n\n㩒「確定」= 取消儲存\n㩒「取消」= 唔係重複，繼續儲存')) {
                // User said "cancel" = not duplicate, continue saving
            } else {
                return; // User confirmed it's duplicate, cancel save
            }
        }

        await DB.addRecord(record);
        this.currentPhotoBase64 = null;

        // Auto-sync to Google Sheets
        Sync.syncRecord(record);

        alert('已儲存！');
        this.showView('dashboard');
        this.loadDashboard();
    },

    async loadRecords() {
        const month = this.currentMonth;
        const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
        const projects = await DB.getProjects();
        const projectMap = {};
        projects.forEach(p => projectMap[p.name] = p.color);

        // Populate filter
        const filterProject = document.getElementById('filter-project');
        filterProject.innerHTML = '<option value="">全部項目</option>' +
            projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

        const loadList = async () => {
            let records = await DB.getRecordsByMonth(monthStr);
            const filterP = document.getElementById('filter-project').value;
            const filterS = document.getElementById('filter-status').value;
            if (filterP) records = records.filter(r => r.project === filterP);
            if (filterS) records = records.filter(r => r.claimStatus === filterS);

            records.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

            const selectedIds = new Set();
            document.getElementById('records-list').innerHTML = records.map(r => `
                <div class="record-item" data-id="${r.id}">
                    <input type="checkbox" class="record-check" data-id="${r.id}">
                    <div class="record-color" style="background:${projectMap[r.project] || '#999'}"></div>
                    <div class="record-info">
                        <div class="record-desc">${r.description || '—'}</div>
                        <div class="record-meta">${r.paymentDate} · ${r.project} · ${r.paymentMethod} · ${r.paidBy}</div>
                    </div>
                    <div class="record-right">
                        <div class="record-amount">${r.currency === 'RMB' ? '¥' : '$'}${r.amount.toFixed(2)}</div>
                        <div class="record-status ${r.claimStatus}">${r.claimStatus === 'claimed' ? '已 Claim' : '未 Claim'}</div>
                    </div>
                </div>
            `).join('') || '<div class="empty">冇紀錄</div>';

            // Checkbox handling for bulk claim
            document.querySelectorAll('.record-check').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) selectedIds.add(cb.dataset.id);
                    else selectedIds.delete(cb.dataset.id);
                    document.getElementById('bulk-claim-btn').classList.toggle('hidden', selectedIds.size === 0);
                });
            });

            document.getElementById('bulk-claim-btn').onclick = async () => {
                for (const id of selectedIds) {
                    await DB.updateClaimStatus(id, 'claimed', new Date().toISOString().split('T')[0]);
                }
                Sync.syncClaimUpdates([...selectedIds]);
                loadList();
            };
        };

        document.getElementById('filter-project').onchange = loadList;
        document.getElementById('filter-status').onchange = loadList;
        loadList();
    },

    async loadProjects() {
        const projects = await DB.getProjects();
        const colors = ['#e94560', '#0f3460', '#16213e', '#533483', '#e94560', '#00b4d8', '#2ec4b6', '#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f', '#82e0aa'];

        document.getElementById('projects-list').innerHTML = projects.map(p => `
            <div class="project-item" style="border-left: 4px solid ${p.color}">
                <span>${p.name}</span>
                <button class="btn-icon edit-project" data-id="${p.id}">✏️</button>
            </div>
        `).join('');

        // Color picker
        document.getElementById('color-picker').innerHTML = colors.map(c =>
            `<button class="color-option" data-color="${c}" style="background:${c}"></button>`
        ).join('');

        let editingId = null;

        document.getElementById('add-project-btn').onclick = () => {
            editingId = null;
            document.getElementById('project-form-title').textContent = '新增項目';
            document.getElementById('project-name').value = '';
            document.getElementById('project-form').classList.remove('hidden');
        };

        document.querySelectorAll('.edit-project').forEach(btn => {
            btn.addEventListener('click', () => {
                const project = projects.find(p => p.id == btn.dataset.id);
                if (!project) return;
                editingId = project.id;
                document.getElementById('project-form-title').textContent = '編輯項目';
                document.getElementById('project-name').value = project.name;
                document.getElementById('project-form').classList.remove('hidden');
            });
        });

        document.querySelectorAll('.color-option').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        document.getElementById('project-cancel').onclick = () => {
            document.getElementById('project-form').classList.add('hidden');
        };

        document.getElementById('project-save').onclick = async () => {
            const name = document.getElementById('project-name').value.trim();
            const colorBtn = document.querySelector('.color-option.selected');
            const color = colorBtn ? colorBtn.dataset.color : colors[0];
            if (!name) return alert('請輸入項目名稱');
            if (editingId) {
                await DB.updateProject(editingId, { name, color });
            } else {
                await DB.addProject({ name, color });
            }
            document.getElementById('project-form').classList.add('hidden');
            this.loadProjects();
        };
    },

    loadSettings() {
        document.getElementById('setting-name').value = this.user?.name || '';
        document.getElementById('setting-gemini-key').value = localStorage.getItem('geminiKey') || '';
        document.getElementById('setting-apps-script-url').value = localStorage.getItem('appsScriptUrl') || '';

        document.getElementById('save-gemini-key').onclick = () => {
            localStorage.setItem('geminiKey', document.getElementById('setting-gemini-key').value.trim());
            alert('已儲存');
        };
        document.getElementById('save-apps-script-url').onclick = () => {
            localStorage.setItem('appsScriptUrl', document.getElementById('setting-apps-script-url').value.trim());
            alert('已儲存');
        };
        document.getElementById('change-passcode').onclick = () => {
            const current = prompt('輸入現有密碼');
            if (current !== this.user.passcode) return alert('密碼錯誤');
            const newPass = prompt('輸入新4位數密碼');
            if (!newPass || newPass.length !== 4 || !/^\d{4}$/.test(newPass)) return alert('密碼要4位數字');
            this.user.passcode = newPass;
            localStorage.setItem('claimUser', JSON.stringify(this.user));
            alert('密碼已更改');
        };
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
```

- [ ] **Step 5: Create initial style.css**

Mobile-first dark theme styles. Key elements:
- CSS variables for theming
- `.view` / `.hidden` for view routing
- `.project-card` with colored left border
- `.ai-chat` bubble layout
- `.fab` floating action button
- `.bottom-nav` fixed bottom navigation
- `.modal` overlay for project form
- `.record-item` list items with color dot
- Form inputs styled for mobile touch

```css
:root {
    --bg: #1a1a2e;
    --surface: #16213e;
    --surface2: #0f3460;
    --text: #e0e0e0;
    --text-dim: #888;
    --accent: #e94560;
    --success: #2ec4b6;
    --warning: #f7dc6f;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
}

.view { min-height: 100vh; padding-bottom: 70px; }
.hidden { display: none !important; }

/* Setup */
.setup-container {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 100vh; padding: 20px; gap: 16px;
}
.setup-container h1 { font-size: 28px; color: var(--accent); }
.setup-container input {
    width: 100%; max-width: 300px; padding: 14px;
    border: 1px solid var(--surface2); border-radius: 12px;
    background: var(--surface); color: var(--text); font-size: 16px;
}

/* Buttons */
.btn-primary {
    background: var(--accent); color: white; border: none;
    padding: 14px 28px; border-radius: 12px; font-size: 16px;
    cursor: pointer; width: 100%; max-width: 300px;
}
.btn-secondary {
    background: var(--surface2); color: var(--text); border: none;
    padding: 10px 20px; border-radius: 8px; cursor: pointer;
}
.btn-small {
    background: var(--accent); color: white; border: none;
    padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer;
}
.btn-icon {
    background: none; border: none; color: var(--text);
    font-size: 20px; cursor: pointer; padding: 8px;
}

/* Header */
.app-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px; background: var(--surface); position: sticky; top: 0; z-index: 10;
}
.app-header h1, .app-header h2 { font-size: 18px; }
.header-actions { display: flex; align-items: center; gap: 8px; }

/* Dashboard */
.summary-bar { padding: 12px 16px; background: var(--surface); margin: 8px; border-radius: 12px; text-align: center; }
.total-unclaimed { font-size: 16px; }
.total-unclaimed strong { color: var(--accent); font-size: 22px; }
.project-cards { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.project-card {
    background: var(--surface); padding: 16px; border-radius: 12px; cursor: pointer;
}
.card-name { font-weight: bold; font-size: 16px; margin-bottom: 4px; }
.card-amount { font-size: 24px; font-weight: bold; margin: 4px 0; }
.card-count { font-size: 13px; color: var(--text-dim); }

/* FAB */
.fab {
    position: fixed; bottom: 80px; right: 20px; width: 56px; height: 56px;
    background: var(--accent); color: white; border: none; border-radius: 50%;
    font-size: 28px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 20;
}

/* Bottom Nav */
.bottom-nav {
    position: fixed; bottom: 0; left: 0; right: 0; display: flex;
    background: var(--surface); border-top: 1px solid var(--surface2);
    z-index: 30;
}
.nav-btn {
    flex: 1; padding: 12px; background: none; border: none;
    color: var(--text-dim); font-size: 13px; cursor: pointer;
}
.nav-btn.active { color: var(--accent); font-weight: bold; }

/* Add Expense */
.project-selector { display: flex; gap: 8px; padding: 12px; flex-wrap: wrap; }
.project-btn {
    padding: 10px 16px; border: none; border-radius: 20px;
    color: white; font-size: 14px; cursor: pointer; opacity: 0.6;
}
.project-btn.selected { opacity: 1; box-shadow: 0 0 0 2px white; }
.input-toggle { display: flex; padding: 0 12px; gap: 8px; }
.toggle-btn {
    flex: 1; padding: 10px; border: 1px solid var(--surface2);
    background: var(--surface); color: var(--text-dim); border-radius: 8px;
    font-size: 14px; cursor: pointer;
}
.toggle-btn.active { border-color: var(--accent); color: var(--accent); background: var(--surface2); }
.input-section { padding: 12px; }
.photo-preview img { max-width: 100%; border-radius: 8px; margin-top: 8px; }
#camera-input { width: 100%; }
#text-expense {
    width: 100%; min-height: 80px; padding: 12px; border: 1px solid var(--surface2);
    border-radius: 8px; background: var(--surface); color: var(--text); font-size: 15px; resize: none;
}

/* AI Chat */
.ai-chat { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.ai-msg {
    background: var(--surface2); padding: 12px; border-radius: 12px;
    font-size: 14px; line-height: 1.5;
}
.ai-msg.error { color: #ff6b6b; }
.ai-question { background: var(--surface); padding: 12px; border-radius: 12px; }
.ai-option {
    display: inline-block; margin: 4px; padding: 8px 14px;
    background: var(--accent); color: white; border: none; border-radius: 20px;
    font-size: 13px; cursor: pointer;
}
.ai-confirmed { color: var(--success); font-size: 13px; }

/* Expense Form */
.expense-form { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.expense-form label {
    display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-dim);
}
.expense-form input, .expense-form select {
    padding: 12px; border: 1px solid var(--surface2); border-radius: 8px;
    background: var(--surface); color: var(--text); font-size: 16px;
}
.form-row { display: flex; gap: 12px; }
.form-row label { flex: 1; }

/* Records */
.filters { display: flex; gap: 8px; padding: 12px; }
.filters select {
    flex: 1; padding: 10px; border: 1px solid var(--surface2); border-radius: 8px;
    background: var(--surface); color: var(--text); font-size: 14px;
}
.records-list { padding: 0 12px; }
.record-item {
    display: flex; align-items: center; gap: 10px; padding: 12px;
    background: var(--surface); border-radius: 8px; margin-bottom: 6px;
}
.record-check { width: 20px; height: 20px; accent-color: var(--accent); }
.record-color { width: 8px; height: 40px; border-radius: 4px; flex-shrink: 0; }
.record-info { flex: 1; min-width: 0; }
.record-desc { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.record-meta { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
.record-right { text-align: right; flex-shrink: 0; }
.record-amount { font-size: 16px; font-weight: bold; }
.record-status { font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-top: 2px; display: inline-block; }
.record-status.unclaimed { background: var(--warning); color: #333; }
.record-status.claimed { background: var(--success); color: #333; }
.empty { text-align: center; padding: 40px; color: var(--text-dim); }

/* Projects */
.projects-list { padding: 12px; }
.project-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px; background: var(--surface); border-radius: 8px; margin-bottom: 6px;
}
.color-picker { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.color-option {
    width: 36px; height: 36px; border-radius: 50%; border: 2px solid transparent; cursor: pointer;
}
.color-option.selected { border-color: white; }

/* Modal */
.modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center; z-index: 50;
}
.modal-content {
    background: var(--surface); padding: 24px; border-radius: 16px;
    width: 90%; max-width: 400px;
}
.modal-content h3 { margin-bottom: 16px; }
.modal-content input {
    width: 100%; padding: 12px; border: 1px solid var(--surface2);
    border-radius: 8px; background: var(--bg); color: var(--text); font-size: 16px; margin-bottom: 12px;
}
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* Settings */
.settings-list { padding: 12px; }
.setting-item {
    padding: 16px; background: var(--surface); border-radius: 8px; margin-bottom: 8px;
}
.setting-item label { display: block; font-size: 13px; color: var(--text-dim); margin-bottom: 6px; }
.setting-item input {
    width: 100%; padding: 10px; border: 1px solid var(--surface2);
    border-radius: 8px; background: var(--bg); color: var(--text); font-size: 14px; margin-bottom: 8px;
}
```

- [ ] **Step 6: Verify app shell loads**

Open `expense-claim/index.html` in browser. Should see setup screen. No JS errors in console.

- [ ] **Step 7: Commit**

```bash
git add expense-claim/
git commit -m "feat: add expense claim PWA shell with all views and routing"
```

---

## Task 2: IndexedDB Storage Layer

**Files:**
- Create: `expense-claim/db.js`

- [ ] **Step 1: Implement db.js with full CRUD**

```js
// db.js — IndexedDB wrapper for expense records and projects

const DB = {
    db: null,
    DB_NAME: 'expenseClaimDB',
    DB_VERSION: 1,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('records')) {
                    const store = db.createObjectStore('records', { keyPath: 'id' });
                    store.createIndex('project', 'project', { unique: false });
                    store.createIndex('paymentDate', 'paymentDate', { unique: false });
                    store.createIndex('claimStatus', 'claimStatus', { unique: false });
                    store.createIndex('syncedAt', 'syncedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('projects')) {
                    const store = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('name', 'name', { unique: true });
                }
            };
            request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async addRecord(record) {
        return this._tx('records', 'readwrite', store => store.add(record));
    },

    async getRecord(id) {
        return this._tx('records', 'readonly', store => store.get(id));
    },

    async updateRecord(id, updates) {
        const record = await this.getRecord(id);
        Object.assign(record, updates);
        return this._tx('records', 'readwrite', store => store.put(record));
    },

    async deleteRecord(id) {
        return this._tx('records', 'readwrite', store => store.delete(id));
    },

    async getAllRecords() {
        return this._tx('records', 'readonly', store => store.getAll());
    },

    async getRecordsByMonth(monthStr) {
        // monthStr = "2026-04"
        const all = await this.getAllRecords();
        return all.filter(r => r.paymentDate && r.paymentDate.startsWith(monthStr));
    },

    async getRecentRecords(count) {
        const all = await this.getAllRecords();
        all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return all.slice(0, count);
    },

    async getUnsyncedRecords() {
        const all = await this.getAllRecords();
        return all.filter(r => !r.syncedAt);
    },

    async updateClaimStatus(id, status, claimDate) {
        return this.updateRecord(id, { claimStatus: status, claimDate, syncedAt: null });
    },

    async checkDuplicate(record) {
        const all = await this.getAllRecords();
        const threshold = record.amount * 0.1;
        const recordDate = new Date(record.paymentDate);
        return all.find(r => {
            if (r.project !== record.project) return false;
            if (Math.abs(r.amount - record.amount) > threshold) return false;
            const daysDiff = Math.abs((new Date(r.paymentDate) - recordDate) / (1000 * 60 * 60 * 24));
            return daysDiff <= 3;
        }) || null;
    },

    async markSynced(id) {
        return this.updateRecord(id, { syncedAt: new Date().toISOString() });
    },

    // Projects
    async addProject(project) {
        return this._tx('projects', 'readwrite', store => store.add(project));
    },

    async getProjects() {
        return this._tx('projects', 'readonly', store => store.getAll());
    },

    async updateProject(id, updates) {
        const project = await this._tx('projects', 'readonly', store => store.get(id));
        Object.assign(project, updates);
        return this._tx('projects', 'readwrite', store => store.put(project));
    },

    async deleteProject(id) {
        return this._tx('projects', 'readwrite', store => store.delete(id));
    },

    // Helper
    _tx(storeName, mode, fn) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = fn(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
};
```

- [ ] **Step 2: Add DB.init() call in app.js init**

At the top of `App.init()`, add `await DB.init();` before the user check. Change `init()` to `async init()`.

- [ ] **Step 3: Verify IndexedDB works**

Open app in browser, complete setup, check DevTools → Application → IndexedDB. Should see `expenseClaimDB` with `records` and `projects` stores, and 2 default projects.

- [ ] **Step 4: Commit**

```bash
git add expense-claim/db.js expense-claim/app.js
git commit -m "feat: add IndexedDB storage layer with CRUD and duplicate detection"
```

---

## Task 3: Gemini AI Smart Assistant

**Files:**
- Create: `expense-claim/ai.js`

- [ ] **Step 1: Implement ai.js with receipt analysis**

```js
// ai.js — Gemini Flash AI for receipt recognition + smart assistant

const AI = {
    API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',

    async analyze(input, type, apiKey, projects, recentRecords) {
        try {
            const projectNames = projects.map(p => p.name);
            const recentContext = recentRecords.slice(0, 10).map(r =>
                `${r.paymentDate} ${r.project} ${r.description} $${r.amount} ${r.currency} ${r.paymentMethod}`
            ).join('\n');

            const systemPrompt = `你係一個支出管理助手。你要幫用戶從收據或文字中提取支出資料。

用戶有以下項目：${projectNames.join(', ')}

最近嘅支出紀錄（用嚟做智能推測）：
${recentContext || '（暫時冇紀錄）'}

你要回傳 JSON 格式：
{
  "message": "用廣東話同用戶講你睇到乜（友善、簡潔）",
  "amount": 數字或null,
  "currency": "HKD"或"RMB"或null,
  "date": "YYYY-MM-DD"或null,
  "description": "描述"或null,
  "paymentMethod": "現金/信用卡/淘寶/拼多多/轉數快/支付寶/其他"或null,
  "suggestedProject": "項目名"或null,
  "questions": [
    {
      "text": "用廣東話問嘅問題",
      "field": "對應嘅欄位名（amount/currency/date/description/split）",
      "options": [{"label": "顯示文字", "value": "實際值"}] 或 null（開放式問題）
    }
  ]
}

重要規則：
1. 如果張相唔清楚或金額唔確定，一定要問返用戶
2. 淘寶/拼多多截圖 → 自動建議 currency=RMB，paymentMethod=淘寶/拼多多
3. 如果收據有多件貨品，問用戶想逐件入定合埋一筆
4. 如果金額異常大（>$2000），提醒用戶確認
5. 如果同最近紀錄嘅商戶/描述好似，建議返相同嘅項目
6. 日期如果冇就用今日
7. message 要友善、簡潔，用廣東話，好似朋友幫你對數咁`;

            let parts;
            if (type === 'photo') {
                // input is base64 data URL
                const base64Data = input.split(',')[1];
                const mimeType = input.split(';')[0].split(':')[1];
                parts = [
                    { text: systemPrompt },
                    { inlineData: { mimeType, data: base64Data } },
                    { text: '請分析呢張收據/截圖，提取支出資料。' }
                ];
            } else {
                // input is text
                parts = [
                    { text: systemPrompt },
                    { text: `用戶輸入咗以下文字描述支出：「${input}」\n請提取支出資料。` }
                ];
            }

            const response = await fetch(`${this.API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.1
                    }
                })
            });

            if (!response.ok) {
                const err = await response.json();
                return { error: `API 錯誤：${err.error?.message || response.status}` };
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) return { error: 'AI 冇回應' };

            const result = JSON.parse(text);

            // Post-processing: fix date format
            if (result.date && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
                result.date = null; // Let form default handle it
            }

            return result;
        } catch (e) {
            return { error: `分析失敗：${e.message}` };
        }
    }
};
```

- [ ] **Step 2: Verify AI analysis works**

1. Go to Settings, enter Gemini API key
2. Go to Add Expense, select a project
3. Take a photo of a receipt or type "五金鋪雜項 $46"
4. Should see AI chat bubble with extracted data + form pre-filled

- [ ] **Step 3: Commit**

```bash
git add expense-claim/ai.js
git commit -m "feat: add Gemini AI smart assistant for receipt recognition"
```

---

## Task 4: Google Sheets + Drive Sync

**Files:**
- Create: `expense-claim/sync.js`
- Create: `expense-claim/google-apps-script.js`

- [ ] **Step 1: Implement sync.js (client-side)**

```js
// sync.js — Google Sheets + Drive sync via Apps Script

const Sync = {
    async syncRecord(record) {
        const url = localStorage.getItem('appsScriptUrl');
        if (!url) return; // No URL configured, skip sync

        try {
            const payload = {
                action: 'addRecord',
                record: {
                    id: record.id,
                    project: record.project,
                    amount: record.amount,
                    currency: record.currency,
                    description: record.description,
                    paymentDate: record.paymentDate,
                    paymentMethod: record.paymentMethod,
                    paidBy: record.paidBy,
                    claimStatus: record.claimStatus,
                    claimDate: record.claimDate,
                    createdAt: record.createdAt
                },
                photo: record.receiptPhoto || null // base64 data URL or null
            };

            const response = await fetch(url, {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (result.success) {
                await DB.updateRecord(record.id, {
                    syncedAt: new Date().toISOString(),
                    receiptPhoto: result.driveLink || record.receiptPhoto
                });
            }
        } catch (e) {
            console.error('Sync failed:', e);
            // Record stays unsynced, will retry on next sync
        }
    },

    async syncClaimUpdates(recordIds) {
        const url = localStorage.getItem('appsScriptUrl');
        if (!url) return;

        try {
            const records = [];
            for (const id of recordIds) {
                const r = await DB.getRecord(id);
                if (r) records.push({ id: r.id, claimStatus: r.claimStatus, claimDate: r.claimDate });
            }

            await fetch(url, {
                method: 'POST',
                body: JSON.stringify({ action: 'updateClaims', records })
            });

            for (const id of recordIds) {
                await DB.markSynced(id);
            }
        } catch (e) {
            console.error('Claim sync failed:', e);
        }
    },

    async syncAllPending() {
        const unsynced = await DB.getUnsyncedRecords();
        for (const record of unsynced) {
            await this.syncRecord(record);
        }
    }
};
```

- [ ] **Step 2: Add auto-sync on app load**

In `App.init()`, after showing dashboard, call `Sync.syncAllPending()` to catch up any records that failed to sync previously.

- [ ] **Step 3: Implement google-apps-script.js (server-side)**

```js
/**
 * Expense Claim Manager → Google Sheets + Drive 同步
 * 部署做 Web App，PWA 會 POST 資料過嚟
 *
 * Setup:
 * 1. 開一個新 Google Spreadsheet
 * 2. Extensions → Apps Script → 貼呢段 code
 * 3. 建一個 Google Drive folder 叫 "Expense Receipts"
 * 4. 將 SPREADSHEET_ID 同 DRIVE_FOLDER_ID 改成你自己嘅
 * 5. Deploy → New Deployment → Web App → Anyone → Deploy
 * 6. 將 Web App URL 貼去 app 嘅設定
 */

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
const DRIVE_FOLDER_ID = 'YOUR_DRIVE_FOLDER_ID_HERE';

function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);

        if (data.action === 'addRecord') {
            return addRecord(data.record, data.photo);
        } else if (data.action === 'updateClaims') {
            return updateClaims(data.records);
        }

        return jsonResponse({ success: false, error: 'Unknown action' });
    } catch (err) {
        return jsonResponse({ success: false, error: err.message });
    }
}

function addRecord(record, photoBase64) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Tab name = month, e.g. "2026-04"
    const monthStr = record.paymentDate ? record.paymentDate.substring(0, 7) : Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM');
    let sheet = ss.getSheetByName(monthStr);

    if (!sheet) {
        sheet = ss.insertSheet(monthStr);
        // Header row
        const headers = ['ID', '日期', '項目', '描述', '金額', '貨幣', '付款方式', '付款人', 'Claim 狀態', 'Claim 日期', '單據連結', '建立時間'];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
        sheet.setFrozenRows(1);
    }

    // Upload photo to Drive if provided
    let driveLink = null;
    if (photoBase64) {
        driveLink = uploadPhoto(photoBase64, record);
    }

    // Append row
    const row = [
        record.id,
        record.paymentDate,
        record.project,
        record.description,
        record.amount,
        record.currency,
        record.paymentMethod,
        record.paidBy,
        record.claimStatus === 'claimed' ? '已 Claim' : '未 Claim',
        record.claimDate || '',
        driveLink ? `=HYPERLINK("${driveLink}","📷")` : '',
        record.createdAt
    ];
    sheet.appendRow(row);

    // Format amount column
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 5).setNumberFormat('#,##0.00');

    // Update subtotals
    updateSubtotals(sheet);

    // Auto resize
    sheet.autoResizeColumns(1, 12);

    return jsonResponse({ success: true, driveLink });
}

function uploadPhoto(base64DataUrl, record) {
    try {
        const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        // Extract base64 data
        const base64Data = base64DataUrl.split(',')[1];
        const mimeType = base64DataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
        const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType);

        // Filename: YYYY-MM-DD_project_amount_currency.jpg
        const safeName = record.project.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
        const filename = `${record.paymentDate}_${safeName}_${record.amount}_${record.currency}.jpg`;
        blob.setName(filename);

        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl();
    } catch (err) {
        Logger.log('Photo upload error: ' + err.message);
        return null;
    }
}

function updateClaims(records) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();

    for (const update of records) {
        for (const sheet of sheets) {
            const data = sheet.getDataRange().getValues();
            for (let i = 1; i < data.length; i++) {
                if (data[i][0] === update.id) {
                    sheet.getRange(i + 1, 9).setValue(update.claimStatus === 'claimed' ? '已 Claim' : '未 Claim');
                    sheet.getRange(i + 1, 10).setValue(update.claimDate || '');
                    break;
                }
            }
        }
    }

    return jsonResponse({ success: true });
}

function updateSubtotals(sheet) {
    // Remove existing subtotal rows (rows starting with "📊")
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][0]).startsWith('📊') || String(data[i][0]).startsWith('💰')) {
            sheet.deleteRow(i + 1);
        }
    }

    // Re-read data after cleanup
    const freshData = sheet.getDataRange().getValues();
    const projects = {};
    for (let i = 1; i < freshData.length; i++) {
        const project = freshData[i][2]; // Column C = project
        if (!project) continue;
        if (!projects[project]) projects[project] = { total: 0, count: 0, unclaimed: 0 };
        projects[project].total += Number(freshData[i][4]) || 0;
        projects[project].count++;
        if (freshData[i][8] === '未 Claim') projects[project].unclaimed += Number(freshData[i][4]) || 0;
    }

    // Append subtotals
    let row = sheet.getLastRow() + 2; // Skip a blank row
    let grandTotal = 0;
    let grandUnclaimed = 0;
    for (const [name, stats] of Object.entries(projects)) {
        sheet.getRange(row, 1).setValue(`📊 ${name}`);
        sheet.getRange(row, 5).setValue(stats.total).setNumberFormat('#,##0.00');
        sheet.getRange(row, 9).setValue(`未 Claim: $${stats.unclaimed.toFixed(2)}`);
        sheet.getRange(row, 1, 1, 12).setFontWeight('bold').setBackground('#e8f5e9');
        grandTotal += stats.total;
        grandUnclaimed += stats.unclaimed;
        row++;
    }
    sheet.getRange(row, 1).setValue('💰 總計');
    sheet.getRange(row, 5).setValue(grandTotal).setNumberFormat('#,##0.00');
    sheet.getRange(row, 9).setValue(`未 Claim: $${grandUnclaimed.toFixed(2)}`);
    sheet.getRange(row, 1, 1, 12).setFontWeight('bold').setFontSize(12).setBackground('#c8e6c9');
}

function jsonResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Test function
function testAddRecord() {
    const e = {
        postData: {
            contents: JSON.stringify({
                action: 'addRecord',
                record: {
                    id: 'test-001',
                    project: 'Partyland MK',
                    amount: 46,
                    currency: 'HKD',
                    description: '五金鋪雜項',
                    paymentDate: '2026-04-09',
                    paymentMethod: '現金',
                    paidBy: 'Leonard',
                    claimStatus: 'unclaimed',
                    claimDate: null,
                    createdAt: new Date().toISOString()
                },
                photo: null
            })
        }
    };
    const result = doPost(e);
    Logger.log(result.getContent());
}
```

- [ ] **Step 4: Verify sync works**

1. Configure Apps Script URL in Settings
2. Add a new expense
3. Check Google Sheets — should see new tab with the record
4. Mark as claimed — should update in Sheets

- [ ] **Step 5: Commit**

```bash
git add expense-claim/sync.js expense-claim/google-apps-script.js
git commit -m "feat: add Google Sheets + Drive sync via Apps Script"
```

---

## Task 5: Daily Reminder Notifications

**Files:**
- Modify: `expense-claim/app.js` — add notification permission request + reminder logic
- Modify: `expense-claim/sw.js` — handle notification display

- [ ] **Step 1: Add notification permission request on setup**

In `App.bindSetup()`, after saving user, request notification permission:

```js
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}
```

- [ ] **Step 2: Add reminder logic in app.js**

```js
// In App.init(), after showing dashboard:
this.startReminderCheck();

// New method:
startReminderCheck() {
    const checkReminder = async () => {
        const reminderTime = parseInt(localStorage.getItem('reminderHour') || '21'); // default 9pm
        const now = new Date();
        if (now.getHours() !== reminderTime) return;

        // Check if already reminded today
        const lastReminder = localStorage.getItem('lastReminderDate');
        const today = now.toISOString().split('T')[0];
        if (lastReminder === today) return;

        // Check if user already added a record today
        const todayRecords = await DB.getRecordsByMonth(today.substring(0, 7));
        const hasToday = todayRecords.some(r => r.paymentDate === today);
        if (hasToday) return;

        // Send notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Expense Claim 提醒', {
                body: '今日報咗 claim 未呀？📝',
                icon: 'icon-192.png'
            });
            localStorage.setItem('lastReminderDate', today);
        }
    };
    setInterval(checkReminder, 60000); // Check every minute
    checkReminder();
}
```

- [ ] **Step 3: Add reminder time setting in Settings view**

Add to settings HTML and `loadSettings()`:
```html
<div class="setting-item">
    <label>每日提醒時間</label>
    <select id="setting-reminder-hour">
        <!-- options 18-23 -->
    </select>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add expense-claim/app.js expense-claim/sw.js
git commit -m "feat: add daily reminder notifications"
```

---

## Task 6: App Icons + Final Polish

**Files:**
- Create: `expense-claim/icon-192.png`
- Create: `expense-claim/icon-512.png`
- Modify: `expense-claim/app.js` — add online/offline indicator, polish interactions

- [ ] **Step 1: Generate app icons**

Use a simple SVG-to-PNG approach or create placeholder icons. The icon should be a simple receipt/dollar sign on a colored background.

- [ ] **Step 2: Add online/offline indicator**

In `app.js`, add connection status listener:

```js
// In App.init():
window.addEventListener('online', () => {
    document.body.classList.remove('offline');
    Sync.syncAllPending();
});
window.addEventListener('offline', () => {
    document.body.classList.add('offline');
});
```

In `style.css`:
```css
body.offline .app-header::after {
    content: '離線模式'; display: block; background: var(--warning);
    color: #333; text-align: center; font-size: 11px; padding: 2px;
}
```

- [ ] **Step 3: Full end-to-end test**

1. Open app on Android Chrome
2. Complete setup (name + passcode)
3. Check default projects exist
4. Add a project with custom color
5. Add expense via text: "五金鋪雜項 $46"
6. Add expense via photo of a receipt
7. Check AI chat clarifications work
8. Check duplicate detection triggers on similar entry
9. View records, filter by project
10. Bulk mark as claimed
11. Check Google Sheets has all data
12. Add to home screen, verify PWA works

- [ ] **Step 4: Commit**

```bash
git add expense-claim/
git commit -m "feat: add icons, offline indicator, and polish"
```

---

## Task 7: Deploy to GitHub Pages

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Enable GitHub Pages**

Go to repo Settings → Pages → Source: main branch, folder: `/expense-claim` (or root).

- [ ] **Step 3: Verify deployment**

Open the GitHub Pages URL on both phones. Complete setup on each device with different names.

- [ ] **Step 4: Deploy Google Apps Script**

1. Open Google Spreadsheet
2. Extensions → Apps Script
3. Paste `google-apps-script.js` content
4. Update `SPREADSHEET_ID` and `DRIVE_FOLDER_ID`
5. Deploy → New Deployment → Web App → Anyone can access
6. Copy URL → paste into app Settings on both phones

- [ ] **Step 5: Final commit**

```bash
git commit -m "docs: deployment complete"
```
