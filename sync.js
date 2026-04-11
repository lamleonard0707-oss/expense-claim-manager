const Sync = {
    url: localStorage.getItem('ec_script_url') || '',
    lastErrors: [],

    setUrl(url) { this.url = url; localStorage.setItem('ec_script_url', url); },

    async push() {
        this.lastErrors = [];
        if (!this.url) {
            this.lastErrors.push('Apps Script URL 未設定');
            return { synced: 0, failed: 0, errors: this.lastErrors };
        }
        const unsynced = DB.getUnsyncedExpenses();
        if (unsynced.length === 0) return { synced: 0, failed: 0, errors: [] };

        const projects = DB.getAllProjects();
        const projectMap = {};
        projects.forEach(p => { projectMap[p.id] = p.name; });

        let synced = 0, failed = 0;

        // Send each unsynced record
        for (const expense of unsynced) {
            try {
                const payload = {
                    action: 'addRecord',
                    record: {
                        id: expense.id,
                        project: projectMap[expense.projectId] || '未分類',
                        amount: expense.amount,
                        currency: expense.currency,
                        description: expense.desc,
                        paymentDate: expense.date,
                        paymentMethod: expense.payment,
                        paidBy: JSON.parse(localStorage.getItem('ec_user') || '{}').name || '未知',
                        claimStatus: expense.status,
                        claimDate: expense.claimDate || '',
                        notes: expense.notes || '',
                        createdAt: expense.createdAt
                    },
                    photo: expense.photoBase64 || null
                };

                const resp = await fetch(this.url, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    redirect: 'follow'
                });

                if (!resp.ok) {
                    failed++;
                    this.lastErrors.push(`[${expense.id}] HTTP ${resp.status} ${resp.statusText}`);
                    continue;
                }

                const text = await resp.text();
                let result;
                try {
                    result = JSON.parse(text);
                } catch (parseErr) {
                    failed++;
                    this.lastErrors.push(`[${expense.id}] 回應唔係 JSON (前 80 字): ${text.substring(0, 80)}`);
                    continue;
                }

                if (result.success) {
                    DB.markSynced(expense.id);
                    synced++;
                } else {
                    failed++;
                    this.lastErrors.push(`[${expense.id}] Apps Script error: ${result.error || JSON.stringify(result)}`);
                }
            } catch (e) {
                failed++;
                this.lastErrors.push(`[${expense.id}] fetch error: ${e.name}: ${e.message}`);
                console.warn('Sync failed for', expense.id, e);
            }
        }
        return { synced, failed, errors: this.lastErrors };
    },

    async testConnection() {
        if (!this.url) return { ok: false, error: 'URL 未設定' };
        try {
            const resp = await fetch(this.url, {
                method: 'POST',
                body: JSON.stringify({ action: 'ping' }),
                redirect: 'follow'
            });
            const text = await resp.text();
            if (!resp.ok) {
                return { ok: false, error: `HTTP ${resp.status}: ${text.substring(0, 200)}` };
            }
            // Apps Script returns the literal HTML login page if not properly deployed-as-anyone
            if (text.includes('<html') || text.includes('<!DOCTYPE')) {
                return { ok: false, error: 'Apps Script 回應 HTML（多數係 deployment 唔係 "Anyone" access，或者要重新 authorize）' };
            }
            return { ok: true, response: text.substring(0, 200) };
        } catch (e) {
            return { ok: false, error: `${e.name}: ${e.message}` };
        }
    }
};
