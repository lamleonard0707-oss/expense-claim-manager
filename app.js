/* =====================================================
   Expense Claim Manager — app.js
   View routing, setup flow, and all page logic.
   Calls DB.*, AI.*, Sync.* (defined in db.js / ai.js / sync.js)
   ===================================================== */

const COLORS = [
    '#e94560', '#0f3460', '#2ec4b6', '#f7dc6f',
    '#9b59b6', '#3498db', '#e67e22', '#2ecc71',
    '#e74c3c', '#1abc9c', '#f39c12', '#8e44ad'
];

const App = {
    // ─── State ──────────────────────────────────────────
    deferredInstallPrompt: null,
    currentView: null,
    currentUser: null,
    dashMonth: null,         // { year, month }  (0-indexed month)
    recMonth: null,
    selectedProject: null,   // project id for add-expense
    selectedProjectColor: null,
    editingProjectId: null,
    selectedColor: COLORS[0],
    photoBase64: null,
    selectedRecords: new Set(),

    // ─── Init ───────────────────────────────────────────
    init() {
        // Apply saved theme immediately
        const savedTheme = localStorage.getItem('ec_theme') || 'dark';
        if (savedTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        }

        const now = new Date();
        this.dashMonth = { year: now.getFullYear(), month: now.getMonth() };
        this.recMonth  = { year: now.getFullYear(), month: now.getMonth() };

        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }

        // PWA install prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredInstallPrompt = e;
            this._showInstallBanner();
        });

        // Online/offline indicator
        window.addEventListener('online', () => {
            document.body.classList.remove('offline');
            this._autoSync();
        });
        window.addEventListener('offline', () => document.body.classList.add('offline'));
        if (!navigator.onLine) document.body.classList.add('offline');

        // Check if first launch
        const user = this._getUser();
        if (!user) {
            this.showView('setup');
            this.bindSetup();
        } else {
            this.currentUser = user;
            this.showView('lock');
            this.bindLock();
        }

        this.bindNavigation();
    },

    // ─── View Routing ───────────────────────────────────
    showView(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const target = document.getElementById(`${name}-view`);
        if (target) target.classList.remove('hidden');
        this.currentView = name;

        // Load view-specific content
        if (name === 'dashboard') this.loadDashboard();
        if (name === 'records')   this.loadRecords();
        if (name === 'projects')  this.loadProjects();
        if (name === 'settings')  this.loadSettings();
    },

    // ─── Navigation ─────────────────────────────────────
    bindNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                this.showView(view);
                // Update active state for all bottom navs
                document.querySelectorAll(`.nav-btn[data-view="${view}"]`).forEach(b => b.classList.add('active'));
                document.querySelectorAll(`.nav-btn:not([data-view="${view}"])`).forEach(b => b.classList.remove('active'));
            });
        });

        // Back buttons
        document.querySelectorAll('[data-back]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.showView(btn.dataset.back);
            });
        });

        // FAB
        document.getElementById('fab-add').addEventListener('click', () => {
            this.openAddExpense();
        });
    },

    // ─── Setup Flow ─────────────────────────────────────
    bindSetup() {
        const form    = document.getElementById('setup-submit');
        const errEl   = document.getElementById('setup-error');
        const nameEl  = document.getElementById('setup-name');
        const passEl  = document.getElementById('setup-passcode');
        const confEl  = document.getElementById('setup-passcode-confirm');

        // Auto-advance on passcode entry
        passEl.addEventListener('input', () => {
            if (passEl.value.length === 4) confEl.focus();
        });

        form.addEventListener('click', () => {
            errEl.classList.add('hidden');
            const name = nameEl.value.trim();
            const pass = passEl.value.trim();
            const conf = confEl.value.trim();

            if (!name) { this._showError(errEl, '請輸入名字'); return; }
            if (pass.length !== 4 || !/^\d{4}$/.test(pass)) {
                this._showError(errEl, '密碼必須係4位數字'); return;
            }
            if (pass !== conf) { this._showError(errEl, '兩次密碼唔一樣'); return; }

            // Save user
            const user = { name, passcode: pass };
            localStorage.setItem('ec_user', JSON.stringify(user));
            this.currentUser = user;

            // Init default projects then enter dashboard
            this.initDefaultProjects();
            this.startReminderCheck();
            this.showView('dashboard');
        });
    },

    bindLock() {
        const errEl  = document.getElementById('lock-error');
        const passEl = document.getElementById('lock-passcode');
        const submit = document.getElementById('lock-submit');
        const user   = this._getUser();

        document.getElementById('lock-user-name').textContent = `歡迎回來，${user.name}`;

        const tryUnlock = () => {
            errEl.classList.add('hidden');
            if (passEl.value === user.passcode) {
                this.startReminderCheck();
                this.showView('dashboard');
            } else {
                passEl.value = '';
                this._showError(errEl, '密碼錯誤，請再試');
                passEl.focus();
            }
        };

        submit.addEventListener('click', tryUnlock);
        passEl.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
        passEl.addEventListener('input', () => { if (passEl.value.length === 4) tryUnlock(); });
        setTimeout(() => passEl.focus(), 100);
    },

    // ─── Daily Reminder ─────────────────────────────────
    startReminderCheck() {
        if (this._reminderStarted) return;
        this._reminderStarted = true;

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        const checkReminder = () => {
            const reminderHour = parseInt(localStorage.getItem('ec_reminder_hour') || '21');
            const now = new Date();
            if (now.getHours() !== reminderHour) return;

            const today = now.toISOString().split('T')[0];
            const lastReminder = localStorage.getItem('ec_last_reminder');
            if (lastReminder === today) return;

            // Check if user already added a record today
            try {
                const expenses = DB.getExpensesByMonth(now.getFullYear(), now.getMonth());
                if (expenses.some(e => e.date === today)) return;
            } catch (e) { return; }

            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('報銷管理提醒', {
                    body: '今日報咗 claim 未呀？📝',
                    icon: 'icon-192.png'
                });
                localStorage.setItem('ec_last_reminder', today);
            }
        };

        setInterval(checkReminder, 60000);
        checkReminder();
    },

    initDefaultProjects() {
        try {
            const existing = DB.getAllProjects();
            if (existing && existing.length > 0) return;
            DB.saveProject({ name: 'Partyland MK',           color: '#e94560' });
            DB.saveProject({ name: 'Fancy Free BBQ Party Room', color: '#0f3460' });
        } catch (e) {
            // DB not yet available; will be created in later task
            console.warn('DB not yet available for initDefaultProjects', e);
        }
    },

    // ─── Dashboard ──────────────────────────────────────
    loadDashboard() {
        const user = this._getUser();
        if (user) document.getElementById('dash-user-name').textContent = user.name;

        this._renderMonthNav('dash', this.dashMonth, (m) => {
            this.dashMonth = m;
            this._renderDashboardContent();
        });

        this._renderDashboardContent();
    },

    _renderDashboardContent() {
        try {
            const { year, month } = this.dashMonth;
            const expenses  = DB.getExpensesByMonth(year, month);
            const projects  = DB.getAllProjects();

            let unclaimedTotal = 0;
            let claimedTotal   = 0;

            expenses.forEach(e => {
                if (e.status === 'claimed') claimedTotal += Number(e.amount) || 0;
                else unclaimedTotal += Number(e.amount) || 0;
            });

            document.getElementById('dash-unclaimed-total').textContent = `HK$${unclaimedTotal.toFixed(0)}`;
            document.getElementById('dash-claimed-total').textContent   = `HK$${claimedTotal.toFixed(0)}`;
            document.getElementById('dash-month-total').textContent     = `HK$${(unclaimedTotal + claimedTotal).toFixed(0)}`;

            const cardsEl = document.getElementById('dash-project-cards');
            const emptyEl = document.getElementById('dash-empty');
            cardsEl.innerHTML = '';

            if (!projects || projects.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }

            let hasData = false;
            projects.forEach(proj => {
                const projExpenses  = expenses.filter(e => e.projectId === proj.id);
                const unclaimed     = projExpenses.filter(e => e.status !== 'claimed');
                const unclaimedAmt  = unclaimed.reduce((s, e) => s + (Number(e.amount) || 0), 0);
                const totalAmt      = projExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

                if (projExpenses.length > 0) hasData = true;

                const card = document.createElement('div');
                card.className = 'project-card';
                card.style.borderLeftColor = proj.color || '#e94560';
                card.innerHTML = `
                    <div class="project-card-left">
                        <span class="project-card-name">${this._esc(proj.name)}</span>
                        <span class="project-card-meta">${projExpenses.length} 筆 · ${unclaimed.length} 未報銷</span>
                    </div>
                    <div class="project-card-right">
                        <div class="project-card-amount" style="color:${this._ensureContrast(proj.color) || '#e94560'}">
                            HK$${unclaimedAmt.toFixed(0)}
                        </div>
                        <div class="project-card-sub">共 HK$${totalAmt.toFixed(0)}</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    this.openAddExpense(proj.id);
                });
                cardsEl.appendChild(card);
            });

            emptyEl.classList.toggle('hidden', hasData);
        } catch (e) {
            console.warn('Dashboard render error (DB may not be ready):', e);
            document.getElementById('dash-empty').classList.remove('hidden');
        }
    },

    // ─── Add Expense ────────────────────────────────────
    openAddExpense(preselectedProjectId) {
        this.photoBase64 = null;
        this.selectedProject = preselectedProjectId || null;

        this.showView('add');

        // Set today's date
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('exp-date').value = today;

        // Reset form
        ['exp-desc', 'exp-amount', 'exp-notes'].forEach(id => {
            document.getElementById(id).value = '';
        });
        document.getElementById('exp-currency').value = 'HKD';
        document.getElementById('exp-payment').value  = '現金';
        document.getElementById('add-error').classList.add('hidden');

        // Reset photo
        this.photoBase64 = null;
        document.getElementById('photo-preview').classList.add('hidden');
        document.getElementById('upload-placeholder').classList.remove('hidden');
        document.getElementById('photo-analyze-btn').classList.add('hidden');
        document.getElementById('photo-input').value = '';

        // Reset text
        document.getElementById('text-input').value = '';

        // Reset AI area
        document.getElementById('ai-chat-area').classList.add('hidden');
        document.getElementById('ai-chat-messages').innerHTML = '';
        document.getElementById('ai-options').classList.add('hidden');

        // Reset toggle to photo
        this._setInputMode('photo');
        document.getElementById('toggle-photo').addEventListener('click', () => this._setInputMode('photo'));
        document.getElementById('toggle-text').addEventListener('click', () => this._setInputMode('text'));

        // Render project pills
        this._renderProjectPills();

        // Photo input handler
        const photoInput = document.getElementById('photo-input');
        photoInput.onchange = (e) => this.handlePhoto(e);

        // Analyze buttons
        document.getElementById('photo-analyze-btn').onclick = () => {
            if (this.photoBase64) this.runAI(this.photoBase64, 'photo');
        };
        document.getElementById('text-analyze-btn').onclick = () => this.handleTextInput();

        // Save button
        document.getElementById('save-expense-btn').onclick = () => this.saveExpense();
    },

    _setInputMode(mode) {
        const photoArea = document.getElementById('photo-input-area');
        const textArea  = document.getElementById('text-input-area');
        const btnPhoto  = document.getElementById('toggle-photo');
        const btnText   = document.getElementById('toggle-text');

        if (mode === 'photo') {
            photoArea.classList.remove('hidden');
            textArea.classList.add('hidden');
            btnPhoto.classList.add('active');
            btnText.classList.remove('active');
        } else {
            textArea.classList.remove('hidden');
            photoArea.classList.add('hidden');
            btnText.classList.add('active');
            btnPhoto.classList.remove('active');
        }
    },

    _renderProjectPills() {
        const container = document.getElementById('add-project-pills');
        container.innerHTML = '';
        try {
            const projects = DB.getAllProjects();
            if (!projects || projects.length === 0) {
                container.innerHTML = '<span class="text-dim" style="font-size:13px">未有項目，請先到「項目」新增</span>';
                return;
            }
            projects.forEach(proj => {
                const pill = document.createElement('button');
                pill.className = 'project-pill';
                pill.textContent = proj.name;
                const isLight = document.documentElement.getAttribute('data-theme') === 'light';
                pill.style.color = isLight ? '#333' : '#fff';
                pill.style.borderColor = isLight ? (proj.color || '#e94560') : (this._ensureContrast(proj.color) || '#e94560');
                pill.style.borderWidth = '2px';
                pill.style.borderStyle = 'solid';
                pill.style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.08)';
                if (proj.id === this.selectedProject) {
                    pill.classList.add('selected');
                    pill.style.background = proj.color || '#e94560';
                    this.selectedProjectColor = proj.color;
                    // Update header with selected project name
                    const headerEl = document.getElementById('add-header-title');
                    if (headerEl) headerEl.textContent = proj.name;
                }
                pill.addEventListener('click', () => {
                    this.selectedProject = proj.id;
                    this.selectedProjectColor = proj.color;
                    // Reset all pills to unselected style
                    const allProjects = DB.getAllProjects();
                    container.querySelectorAll('.project-pill').forEach((p, i) => {
                        p.classList.remove('selected');
                        p.style.background = 'rgba(255,255,255,0.08)';
                    });
                    // Set selected pill
                    pill.classList.add('selected');
                    pill.style.background = proj.color || '#e94560';
                    // Update header with selected project name
                    const headerEl = document.getElementById('add-header-title');
                    if (headerEl) headerEl.textContent = proj.name;
                });
                container.appendChild(pill);
            });

            // Auto-select first if none selected
            if (!this.selectedProject && projects.length > 0) {
                const first = container.querySelector('.project-pill');
                if (first) first.click();
            }
        } catch (e) {
            console.warn('DB not ready for project pills:', e);
            container.innerHTML = '<span class="text-dim" style="font-size:13px">載入項目時出錯</span>';
        }
    },

    handlePhoto(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            this.photoBase64 = ev.target.result; // data:image/...;base64,...

            const preview = document.getElementById('photo-preview');
            preview.src = this.photoBase64;
            preview.classList.remove('hidden');
            document.getElementById('upload-placeholder').classList.add('hidden');
            document.getElementById('photo-analyze-btn').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    },

    handleTextInput() {
        const text = document.getElementById('text-input').value.trim();
        if (!text) {
            this._showToast('請先輸入描述');
            return;
        }
        this.runAI(text, 'text');
    },

    runAI(input, type) {
        const chatArea = document.getElementById('ai-chat-area');
        const messages = document.getElementById('ai-chat-messages');
        const options  = document.getElementById('ai-options');

        chatArea.classList.remove('hidden');
        messages.innerHTML = '';
        options.classList.add('hidden');

        // Show user input bubble
        if (type === 'text') {
            this._addChatBubble(messages, 'user', input);
        } else {
            this._addChatBubble(messages, 'user', '📷 已上傳收據圖片');
        }

        // Show thinking
        const thinkingBubble = this._addChatBubble(messages, 'thinking', '🤔 AI 分析緊...');

        // Call AI.analyze
        try {
            AI.analyze(input, type).then(result => {
                thinkingBubble.remove();

                if (result.error) {
                    this._addChatBubble(messages, 'ai', `❌ ${result.error}`);
                    return;
                }

                // Format result message
                let msg = '✅ 分析完成！已幫你填好以下資料：\n\n';
                if (result.desc)    msg += `📝 描述：${result.desc}\n`;
                if (result.amount)  msg += `💰 金額：${result.amount} ${result.currency || 'HKD'}\n`;
                if (result.date)    msg += `📅 日期：${result.date}\n`;
                if (result.payment) msg += `💳 付款：${result.payment}\n`;

                this._addChatBubble(messages, 'ai', msg);

                // Show AI message (questions, warnings, tips)
                if (result.message) {
                    this._addChatBubble(messages, 'ai', `💬 ${result.message}`);
                }

                // Fill form
                if (result.desc)    document.getElementById('exp-desc').value    = result.desc;
                if (result.amount)  document.getElementById('exp-amount').value  = result.amount;
                if (result.currency) {
                    const cur = document.getElementById('exp-currency');
                    if ([...cur.options].some(o => o.value === result.currency)) cur.value = result.currency;
                }
                if (result.date)    document.getElementById('exp-date').value    = result.date;
                if (result.payment) {
                    const pay = document.getElementById('exp-payment');
                    if ([...pay.options].some(o => o.value === result.payment)) pay.value = result.payment;
                }

                // Show action options
                if (result.suggestions && result.suggestions.length > 0) {
                    options.classList.remove('hidden');
                    options.innerHTML = '';
                    result.suggestions.forEach(s => {
                        const btn = document.createElement('button');
                        btn.className = 'ai-option-btn';
                        btn.textContent = s.label;
                        btn.addEventListener('click', () => {
                            if (s.field && s.value) {
                                document.getElementById(s.field).value = s.value;
                                btn.style.opacity = '0.5';
                            }
                        });
                        options.appendChild(btn);
                    });
                }

            }).catch(err => {
                thinkingBubble.remove();
                this._addChatBubble(messages, 'ai', `❌ AI 分析出錯：${err.message || '未知錯誤'}`);
            });
        } catch (e) {
            thinkingBubble.remove();
            this._addChatBubble(messages, 'ai', '⚠️ AI 模組未準備好，請先到設定輸入 Gemini API Key');
        }
    },

    saveExpense() {
        const errEl = document.getElementById('add-error');
        errEl.classList.add('hidden');

        if (!this.selectedProject) {
            this._showError(errEl, '請選擇項目');
            return;
        }

        const desc    = document.getElementById('exp-desc').value.trim();
        const amount  = parseFloat(document.getElementById('exp-amount').value);
        const currency= document.getElementById('exp-currency').value;
        const date    = document.getElementById('exp-date').value;
        const payment = document.getElementById('exp-payment').value;
        const notes   = document.getElementById('exp-notes').value.trim();

        if (!desc)            { this._showError(errEl, '請輸入描述'); return; }
        if (!amount || amount <= 0) { this._showError(errEl, '請輸入有效金額'); return; }
        if (!date)            { this._showError(errEl, '請選擇日期'); return; }

        const expense = {
            projectId: this.selectedProject,
            desc, amount, currency, date, payment, notes,
            photoBase64: this.photoBase64 || null,
            status: 'unclaimed',
            createdAt: App._hkNow()
        };

        try {
            // Check duplicate
            const isDupe = DB.checkDuplicate(expense);
            if (isDupe) {
                this._showError(errEl, '⚠️ 發現相似記錄，可能重複！請確認後再儲存。');
                // Still allow save — show confirm button
                const saveBtn = document.getElementById('save-expense-btn');
                saveBtn.textContent = '確認儲存（忽略重複）';
                saveBtn.onclick = () => this._doSaveExpense(expense);
                return;
            }
            this._doSaveExpense(expense);
        } catch (e) {
            console.warn('DB not ready for save:', e);
            this._showError(errEl, '儲存失敗：DB 未準備好');
        }
    },

    _doSaveExpense(expense) {
        try {
            DB.saveExpense(expense);
            this._showToast('✅ 已儲存！');

            // Trigger sync with feedback
            this._autoSync();

            // Go back to dashboard
            setTimeout(() => this.showView('dashboard'), 600);
        } catch (e) {
            this._showError(document.getElementById('add-error'), `儲存失敗：${e.message}`);
        }
    },

    async _autoSync() {
        if (!navigator.onLine) return;
        try {
            const before = DB.getUnsyncedExpenses().length;
            if (before === 0) return;
            await Sync.push();
            const after = DB.getUnsyncedExpenses().length;
            this._showToast(`🔄 已同步 ${before - after} 筆`);
        } catch (e) {
            console.warn('Auto-sync failed:', e);
            this._showToast('⚠️ 同步失敗');
        }
    },

    // ─── Records ────────────────────────────────────────
    loadRecords() {
        this.selectedRecords.clear();
        document.getElementById('bulk-claim-bar').classList.add('hidden');

        this._renderMonthNav('rec', this.recMonth, (m) => {
            this.recMonth = m;
            this._renderRecordsList();
        });

        // Populate project filter
        this._populateProjectFilter('rec-filter-project');

        // Default to showing unclaimed only
        document.getElementById('rec-filter-status').value = 'unclaimed';

        document.getElementById('rec-filter-project').onchange = () => this._renderRecordsList();
        document.getElementById('rec-filter-status').onchange  = () => this._renderRecordsList();

        // Bulk claim button
        document.getElementById('bulk-claim-btn').onclick = () => this._bulkClaim();

        this._renderRecordsList();
    },

    _renderRecordsList() {
        const listEl    = document.getElementById('records-list');
        const emptyEl   = document.getElementById('records-empty');
        const projFilter= document.getElementById('rec-filter-project').value;
        const statFilter= document.getElementById('rec-filter-status').value;

        listEl.innerHTML = '';
        this.selectedRecords.clear();
        this._updateBulkBar();

        try {
            const { year, month } = this.recMonth;
            let expenses = DB.getExpensesByMonth(year, month);

            if (projFilter) expenses = expenses.filter(e => e.projectId === projFilter);
            if (statFilter) expenses = expenses.filter(e => e.status === statFilter);

            // Sort newest first
            expenses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            if (expenses.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }
            emptyEl.classList.add('hidden');

            const projects = DB.getAllProjects();
            const projMap  = {};
            projects.forEach(p => projMap[p.id] = p);

            expenses.forEach(exp => {
                const proj  = projMap[exp.projectId] || { name: '未知', color: '#888' };
                const item  = document.createElement('div');
                item.className = 'record-item';
                item.dataset.id = exp.id;

                item.innerHTML = `
                    <div class="record-checkbox" data-id="${exp.id}"></div>
                    <div class="record-dot" style="background:${proj.color}"></div>
                    <div class="record-body">
                        <div class="record-desc">${this._esc(exp.desc)}</div>
                        <div class="record-meta">${proj.name} · ${exp.payment} · ${exp.date}</div>
                    </div>
                    <div class="record-right">
                        <div class="record-amount">${exp.currency} $${Number(exp.amount).toFixed(1)}</div>
                        <div class="record-badge ${exp.status}">${exp.status === 'claimed' ? '已報銷' : '未報銷'}</div>
                    </div>
                `;

                // Checkbox toggle
                const checkbox = item.querySelector('.record-checkbox');
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = exp.id;
                    if (this.selectedRecords.has(id)) {
                        this.selectedRecords.delete(id);
                        checkbox.classList.remove('checked');
                    } else {
                        this.selectedRecords.add(id);
                        checkbox.classList.add('checked');
                    }
                    this._updateBulkBar();
                });

                // Tap to open detail
                item.addEventListener('click', () => this._openRecordDetail(exp));

                listEl.appendChild(item);
            });
        } catch (e) {
            console.warn('DB not ready for records:', e);
            emptyEl.classList.remove('hidden');
        }
    },

    _openRecordDetail(exp) {
        const modal = document.getElementById('record-modal');
        modal.classList.remove('hidden');

        // Fill form
        document.getElementById('rec-desc').value = exp.desc || '';
        document.getElementById('rec-amount').value = exp.amount || '';
        document.getElementById('rec-currency').value = exp.currency || 'HKD';
        document.getElementById('rec-date').value = exp.date || '';
        document.getElementById('rec-payment').value = exp.payment || '現金';
        document.getElementById('rec-notes').value = exp.notes || '';
        document.getElementById('rec-status').value = exp.status || 'unclaimed';

        // Show photo if exists
        const photoArea = document.getElementById('record-photo-area');
        const photoImg = document.getElementById('record-photo');
        if (exp.photoBase64) {
            photoImg.src = exp.photoBase64;
            photoArea.classList.remove('hidden');
        } else {
            photoArea.classList.add('hidden');
        }

        // Close
        document.getElementById('record-modal-close').onclick = () => modal.classList.add('hidden');

        // Save
        document.getElementById('record-save').onclick = () => {
            try {
                DB.updateExpense(exp.id, {
                    desc: document.getElementById('rec-desc').value,
                    amount: parseFloat(document.getElementById('rec-amount').value) || 0,
                    currency: document.getElementById('rec-currency').value,
                    date: document.getElementById('rec-date').value,
                    payment: document.getElementById('rec-payment').value,
                    notes: document.getElementById('rec-notes').value,
                    status: document.getElementById('rec-status').value,
                    _wasSynced: true,
                    syncedAt: null
                });
                this._autoSync();
                modal.classList.add('hidden');
                this._showToast('已更新');
                this.loadRecords();
            } catch (e) {
                this._showToast('更新失敗：' + e.message);
            }
        };

        // Delete
        document.getElementById('record-delete').onclick = () => {
            if (confirm('確定要從 App 刪除呢筆紀錄？\n（Google Sheets 同 Drive 嘅記錄會保留）')) {
                try {
                    DB.deleteExpense(exp.id);
                    modal.classList.add('hidden');
                    this._showToast('已從 App 刪除（Sheets 記錄保留）');
                    this.loadRecords();
                } catch (e) {
                    this._showToast('刪除失敗');
                }
            }
        };
    },

    _updateBulkBar() {
        const bar     = document.getElementById('bulk-claim-bar');
        const countEl = document.getElementById('bulk-count');
        const count   = this.selectedRecords.size;
        if (count === 0) {
            bar.classList.add('hidden');
        } else {
            bar.classList.remove('hidden');
            countEl.textContent = `已選 ${count} 項`;
        }
    },

    _bulkClaim() {
        try {
            this.selectedRecords.forEach(id => DB.updateExpenseStatus(id, 'claimed'));
            this._autoSync();
            this._showToast(`✅ ${this.selectedRecords.size} 筆已標記為報銷`);
            this.selectedRecords.clear();
            this._renderRecordsList();
        } catch (e) {
            this._showToast('操作失敗：' + e.message);
        }
    },

    // ─── Projects ───────────────────────────────────────
    loadProjects() {
        this._renderProjectsList();

        // Add project button
        document.getElementById('add-project-btn').onclick = () => {
            this._openProjectModal(null);
        };

        // Modal bindings
        document.getElementById('project-modal-close').onclick  = () => this._closeProjectModal();
        document.getElementById('project-modal-cancel').onclick = () => this._closeProjectModal();
        document.getElementById('project-modal-save').onclick   = () => this._saveProject();
    },

    _renderProjectsList() {
        const listEl  = document.getElementById('projects-list');
        const emptyEl = document.getElementById('projects-empty');
        listEl.innerHTML = '';

        try {
            const projects = DB.getAllProjects();
            if (!projects || projects.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }
            emptyEl.classList.add('hidden');

            projects.forEach(proj => {
                const item = document.createElement('div');
                item.className = 'project-list-item';
                item.innerHTML = `
                    <div class="project-color-dot" style="background:${proj.color}"></div>
                    <span class="project-list-name">${this._esc(proj.name)}</span>
                    <span class="project-list-arrow">›</span>
                `;
                item.addEventListener('click', () => this._openProjectModal(proj));
                listEl.appendChild(item);
            });
        } catch (e) {
            console.warn('DB not ready for projects:', e);
            emptyEl.classList.remove('hidden');
        }
    },

    _openProjectModal(proj) {
        this.editingProjectId = proj ? proj.id : null;
        this.selectedColor    = proj ? proj.color : COLORS[0];

        document.getElementById('project-modal-title').textContent = proj ? '編輯項目' : '新增項目';
        document.getElementById('project-name-input').value = proj ? proj.name : '';
        document.getElementById('project-modal-error').classList.add('hidden');

        // Render color picker
        const pickerEl = document.getElementById('color-picker');
        pickerEl.innerHTML = '';
        COLORS.forEach(color => {
            const circle = document.createElement('div');
            circle.className = 'color-circle' + (color === this.selectedColor ? ' selected' : '');
            circle.style.background = color;
            circle.addEventListener('click', () => {
                this.selectedColor = color;
                pickerEl.querySelectorAll('.color-circle').forEach(c => c.classList.remove('selected'));
                circle.classList.add('selected');
            });
            pickerEl.appendChild(circle);
        });

        document.getElementById('project-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('project-name-input').focus(), 100);
    },

    _closeProjectModal() {
        document.getElementById('project-modal').classList.add('hidden');
        this.editingProjectId = null;
    },

    _saveProject() {
        const errEl = document.getElementById('project-modal-error');
        errEl.classList.add('hidden');
        const name = document.getElementById('project-name-input').value.trim();

        if (!name) { this._showError(errEl, '請輸入項目名稱'); return; }

        try {
            if (this.editingProjectId) {
                DB.updateProject({ id: this.editingProjectId, name, color: this.selectedColor });
                this._showToast('項目已更新');
            } else {
                DB.saveProject({ name, color: this.selectedColor });
                this._showToast('項目已新增');
            }
            this._closeProjectModal();
            this._renderProjectsList();
        } catch (e) {
            this._showError(errEl, `儲存失敗：${e.message}`);
        }
    },

    // ─── Settings ───────────────────────────────────────
    loadSettings() {
        const user = this._getUser();
        if (user) document.getElementById('settings-username').textContent = user.name;

        // Show app version for debugging
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = 'v14';

        // Theme toggle
        const currentTheme = localStorage.getItem('ec_theme') || 'dark';
        document.getElementById('theme-toggle').querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === currentTheme);
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                localStorage.setItem('ec_theme', theme);
                if (theme === 'light') {
                    document.documentElement.setAttribute('data-theme', 'light');
                } else {
                    document.documentElement.removeAttribute('data-theme');
                }
                document.getElementById('theme-toggle').querySelectorAll('.theme-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.theme === theme);
                });
            });
        });

        // Load saved keys
        const geminiKey = localStorage.getItem('ec_gemini_key') || '';
        const scriptUrl = localStorage.getItem('ec_script_url') || '';
        document.getElementById('settings-gemini-key').value  = geminiKey;
        document.getElementById('settings-script-url').value  = scriptUrl;

        // Gemini key toggle visibility
        document.getElementById('settings-gemini-toggle').onclick = () => {
            const inp = document.getElementById('settings-gemini-key');
            inp.type = inp.type === 'password' ? 'text' : 'password';
        };

        // Save Gemini key
        document.getElementById('settings-gemini-save').onclick = () => {
            const key = document.getElementById('settings-gemini-key').value.trim();
            localStorage.setItem('ec_gemini_key', key);
            this._showToast('Gemini API Key 已儲存');
            try { AI.setApiKey(key); } catch(e) {}
        };

        // Save Apps Script URL
        document.getElementById('settings-script-save').onclick = () => {
            const url = document.getElementById('settings-script-url').value.trim();
            localStorage.setItem('ec_script_url', url);
            this._showToast('Apps Script URL 已儲存');
            try { Sync.setUrl(url); } catch(e) {}
        };

        // Manual sync with logging
        document.getElementById('settings-manual-sync').onclick = async () => {
            const logEl = document.getElementById('sync-log');
            logEl.textContent = '開始同步...\n';
            const url = Sync.url;
            if (!url) { logEl.textContent += '❌ 未設定 Apps Script URL\n'; return; }
            logEl.textContent += `URL: ${url.substring(0, 50)}...\n`;

            const unsynced = DB.getUnsyncedExpenses();
            logEl.textContent += `未同步記錄: ${unsynced.length} 筆\n`;
            for (const exp of unsynced) {
                logEl.textContent += `  [${exp.id}] ${exp.desc} | photo: ${exp.photoBase64 ? exp.photoBase64.length + ' chars' : 'none'}\n`;
            }

            if (unsynced.length === 0) { logEl.textContent += '✅ 全部已同步\n'; return; }

            try {
                // Use Sync.push() which handles both records AND photos
                await Sync.push();
                const remaining = DB.getUnsyncedExpenses().length;
                logEl.textContent += `\n✅ 同步完成！剩餘未同步: ${remaining} 筆\n`;
                if (remaining > 0) {
                    logEl.textContent += '⚠️ 部分記錄同步失敗，請檢查網絡後重試\n';
                }
            } catch (e) {
                logEl.textContent += `\n❌ 同步失敗: ${e.message}\n`;
            }
        };

        // Reminder hour
        const reminderHourEl = document.getElementById('settings-reminder-hour');
        reminderHourEl.value = localStorage.getItem('ec_reminder_hour') || '21';
        reminderHourEl.onchange = () => {
            localStorage.setItem('ec_reminder_hour', reminderHourEl.value);
            this._showToast(`提醒時間已改為 ${reminderHourEl.value}:00`);
        };

        // Change passcode
        document.getElementById('settings-passcode-save').onclick = () => this._changePasscode();

        // Logout / Clear
        document.getElementById('settings-logout').onclick = () => {
            if (confirm('確定要登出並清除所有本地數據？')) {
                localStorage.clear();
                try { DB.clearAll(); } catch(e) {}
                location.reload();
            }
        };
    },

    _changePasscode() {
        const errEl  = document.getElementById('settings-passcode-error');
        errEl.classList.add('hidden');

        const oldPass = document.getElementById('settings-old-passcode').value.trim();
        const newPass = document.getElementById('settings-new-passcode').value.trim();
        const confPass= document.getElementById('settings-new-passcode-confirm').value.trim();
        const user    = this._getUser();

        if (oldPass !== user.passcode) { this._showError(errEl, '現有密碼錯誤'); return; }
        if (newPass.length !== 4 || !/^\d{4}$/.test(newPass)) {
            this._showError(errEl, '新密碼必須係4位數字'); return;
        }
        if (newPass !== confPass) { this._showError(errEl, '兩次新密碼唔一樣'); return; }

        user.passcode = newPass;
        localStorage.setItem('ec_user', JSON.stringify(user));
        this.currentUser = user;

        document.getElementById('settings-old-passcode').value  = '';
        document.getElementById('settings-new-passcode').value  = '';
        document.getElementById('settings-new-passcode-confirm').value = '';
        this._showToast('密碼已更改');
    },

    // ─── Month Nav Helper ────────────────────────────────
    _renderMonthNav(prefix, monthObj, onChange) {
        const labelEl = document.getElementById(`${prefix}-month-label`);
        const prevBtn = document.getElementById(`${prefix}-prev-month`);
        const nextBtn = document.getElementById(`${prefix}-next-month`);

        const update = () => {
            const d = new Date(monthObj.year, monthObj.month, 1);
            labelEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月`;
        };
        update();

        // Clone to remove old listeners
        const newPrev = prevBtn.cloneNode(true);
        const newNext = nextBtn.cloneNode(true);
        prevBtn.parentNode.replaceChild(newPrev, prevBtn);
        nextBtn.parentNode.replaceChild(newNext, nextBtn);

        newPrev.addEventListener('click', () => {
            monthObj.month--;
            if (monthObj.month < 0) { monthObj.month = 11; monthObj.year--; }
            update();
            onChange({ ...monthObj });
        });
        newNext.addEventListener('click', () => {
            monthObj.month++;
            if (monthObj.month > 11) { monthObj.month = 0; monthObj.year++; }
            update();
            onChange({ ...monthObj });
        });
    },

    // ─── Filter Helpers ─────────────────────────────────
    _populateProjectFilter(selectId) {
        const sel = document.getElementById(selectId);
        // Keep first option
        while (sel.options.length > 1) sel.remove(1);
        try {
            const projects = DB.getAllProjects();
            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                sel.appendChild(opt);
            });
        } catch(e) {}
    },

    // ─── Chat Bubble Helper ──────────────────────────────
    _addChatBubble(container, type, text) {
        const bubble = document.createElement('div');
        bubble.className = `ai-bubble ${type}`;
        bubble.textContent = text;
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
        return bubble;
    },

    // ─── Utility ────────────────────────────────────────
    _getUser() {
        try {
            return JSON.parse(localStorage.getItem('ec_user'));
        } catch(e) { return null; }
    },

    _hkNow() {
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const hk = new Date(utc + 8 * 3600000);
        const p = n => String(n).padStart(2, '0');
        return `${hk.getFullYear()}-${p(hk.getMonth()+1)}-${p(hk.getDate())} ${p(hk.getHours())}:${p(hk.getMinutes())}:${p(hk.getSeconds())}`;
    },

    _showError(el, msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
    },

    _showToast(msg, duration = 2500) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, duration);
    },

    _showInstallBanner() {
        // Remove existing banner if any
        const existing = document.getElementById('install-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'install-banner';
        banner.innerHTML = `
            <div class="install-banner">
                <span>📲 安裝到主畫面，用起嚟更方便！</span>
                <button id="install-btn" class="btn-primary" style="padding:8px 16px;font-size:14px;width:auto;">安裝</button>
                <button id="install-dismiss" class="btn-icon" style="font-size:16px;">✕</button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('install-btn').onclick = async () => {
            if (this.deferredInstallPrompt) {
                this.deferredInstallPrompt.prompt();
                const result = await this.deferredInstallPrompt.userChoice;
                if (result.outcome === 'accepted') {
                    this._showToast('安裝成功！');
                }
                this.deferredInstallPrompt = null;
            }
            banner.remove();
        };

        document.getElementById('install-dismiss').onclick = () => banner.remove();
    },

    _ensureContrast(hex) {
        if (!hex) return null;
        // Parse hex to RGB and check luminance against dark bg
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // If too dark for our dark theme, lighten it
        if (luminance < 0.3) {
            const lighten = (c) => Math.min(255, c + 100);
            return `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
        }
        return hex;
    },

    _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};

// Force update: if ?clear=1 in URL, unregister SW and clear caches
if (location.search.includes('clear=1')) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
    location.replace(location.pathname);
}

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
