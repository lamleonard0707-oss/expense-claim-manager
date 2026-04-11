/* =====================================================
   Expense Claim Manager — db.js
   Synchronous localStorage-backed storage layer.
   Provides DB.* methods called by app.js.
   ===================================================== */

const DB = {

    // ─── Keys ───────────────────────────────────────────
    KEYS: {
        expenses: 'ec_expenses',
        projects: 'ec_projects',
    },

    // ─── Internal Helpers ───────────────────────────────

    _load(key) {
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch (e) {
            return [];
        }
    },

    _save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    },

    _genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    // ─── Projects ───────────────────────────────────────

    getAllProjects() {
        return this._load(this.KEYS.projects);
    },

    saveProject(project) {
        const projects = this._load(this.KEYS.projects);
        const newProject = {
            id: this._genId(),
            name: project.name || '',
            color: project.color || '#e94560',
            createdAt: this._hkNow(),
        };
        projects.push(newProject);
        this._save(this.KEYS.projects, projects);
        return newProject;
    },

    updateProject(project) {
        // Called as: DB.updateProject({ id, name, color })
        const projects = this._load(this.KEYS.projects);
        const idx = projects.findIndex(p => p.id === project.id);
        if (idx === -1) throw new Error('Project not found: ' + project.id);
        projects[idx] = { ...projects[idx], ...project };
        this._save(this.KEYS.projects, projects);
        return projects[idx];
    },

    deleteProject(id) {
        const projects = this._load(this.KEYS.projects).filter(p => p.id !== id);
        this._save(this.KEYS.projects, projects);
    },

    // ─── Expenses ───────────────────────────────────────

    getAllExpenses() {
        return this._load(this.KEYS.expenses);
    },

    getExpensesByMonth(year, month) {
        // month is 0-indexed (JS Date convention)
        const expenses = this._load(this.KEYS.expenses);
        return expenses.filter(e => {
            if (!e.date) return false;
            const d = new Date(e.date);
            return d.getFullYear() === year && d.getMonth() === month;
        });
    },

    saveExpense(expense) {
        const expenses = this._load(this.KEYS.expenses);
        const newExpense = {
            id: this._genId(),
            projectId:   expense.projectId   || null,
            desc:        expense.desc        || '',
            amount:      expense.amount      || 0,
            currency:    expense.currency    || 'HKD',
            date:        expense.date        || '',
            payment:     expense.payment     || '',
            notes:       expense.notes       || '',
            photoBase64: expense.photoBase64 || null,
            status:      expense.status      || 'unclaimed',
            createdAt:   expense.createdAt   || this._hkNow(),
            syncedAt:    null,
        };
        expenses.push(newExpense);
        this._save(this.KEYS.expenses, expenses);
        return newExpense;
    },

    getExpense(id) {
        const expenses = this._load(this.KEYS.expenses);
        return expenses.find(e => e.id === id) || null;
    },

    updateExpense(id, updates) {
        const expenses = this._load(this.KEYS.expenses);
        const idx = expenses.findIndex(e => e.id === id);
        if (idx === -1) throw new Error('Expense not found: ' + id);
        expenses[idx] = { ...expenses[idx], ...updates };
        this._save(this.KEYS.expenses, expenses);
        return expenses[idx];
    },

    deleteExpense(id) {
        const expenses = this._load(this.KEYS.expenses).filter(e => e.id !== id);
        this._save(this.KEYS.expenses, expenses);
    },

    _hkNow() {
        const now = new Date();
        const hk = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60000);
        return hk.toISOString().replace('Z', '+08:00');
    },

    updateExpenseStatus(id, status) {
        // Called as: DB.updateExpenseStatus(id, 'claimed')
        // Mark _wasSynced so Sync.push knows to use updateRecord instead of addRecord
        return this.updateExpense(id, {
            status,
            claimDate: status === 'claimed' ? this._hkNow() : null,
            _wasSynced: true,
            syncedAt: null,
        });
    },

    markSynced(id) {
        return this.updateExpense(id, { syncedAt: this._hkNow() });
    },

    getUnsyncedExpenses() {
        return this._load(this.KEYS.expenses).filter(e => !e.syncedAt);
    },

    // ─── Duplicate Detection ────────────────────────────

    checkDuplicate(expense) {
        // Find existing record with ALL of:
        //   - same projectId
        //   - same or very similar desc (>= 50% char overlap)
        //   - exact same amount
        //   - exact same date
        const expenses = this._load(this.KEYS.expenses);
        const amount   = Number(expense.amount) || 0;
        const desc     = (expense.desc || '').trim();

        if (!amount || !expense.date || !desc) return null;

        for (const e of expenses) {
            if (e.projectId !== expense.projectId) continue;

            // Exact same amount
            const eAmount = Number(e.amount) || 0;
            if (eAmount !== amount) continue;

            // Exact same date
            if (e.date !== expense.date) continue;

            // Similar description (>= 50% character overlap)
            const eDesc = (e.desc || '').trim();
            if (!eDesc) continue;
            const shorter = Math.min(desc.length, eDesc.length);
            let matchChars = 0;
            for (let i = 0; i < shorter; i++) {
                if (desc[i] === eDesc[i]) matchChars++;
            }
            if (matchChars / shorter < 0.5) continue;

            return e; // duplicate found
        }

        return null;
    },

    // ─── Clear All ──────────────────────────────────────

    clearAll() {
        this._save(this.KEYS.expenses, []);
        this._save(this.KEYS.projects, []);
    },
};
