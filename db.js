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
            createdAt: new Date().toISOString(),
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
            createdAt:   expense.createdAt   || new Date().toISOString(),
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

    updateExpenseStatus(id, status) {
        // Called as: DB.updateExpenseStatus(id, 'claimed')
        return this.updateExpense(id, {
            status,
            claimDate: status === 'claimed' ? new Date().toISOString() : null,
            syncedAt: null,
        });
    },

    markSynced(id) {
        return this.updateExpense(id, { syncedAt: new Date().toISOString() });
    },

    getUnsyncedExpenses() {
        return this._load(this.KEYS.expenses).filter(e => !e.syncedAt);
    },

    // ─── Duplicate Detection ────────────────────────────

    checkDuplicate(expense) {
        // Find existing record with:
        //   - same projectId
        //   - amount within ±10%
        //   - date within ±3 days
        const expenses = this._load(this.KEYS.expenses);
        const amount   = Number(expense.amount) || 0;
        const date     = expense.date ? new Date(expense.date).getTime() : null;

        if (!amount || !date) return null;

        const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

        for (const e of expenses) {
            if (e.projectId !== expense.projectId) continue;

            const eAmount = Number(e.amount) || 0;
            if (eAmount === 0) continue;

            // Amount within ±10%
            const amountDiff = Math.abs(eAmount - amount) / amount;
            if (amountDiff > 0.1) continue;

            // Date within ±3 days
            const eDate = e.date ? new Date(e.date).getTime() : null;
            if (!eDate) continue;
            if (Math.abs(eDate - date) > THREE_DAYS_MS) continue;

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
