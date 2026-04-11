const Sync = {
    url: localStorage.getItem('ec_script_url') || '',

    setUrl(url) { this.url = url; localStorage.setItem('ec_script_url', url); },

    async push() {
        if (!this.url) return;
        const unsynced = DB.getUnsyncedExpenses();
        if (unsynced.length === 0) return;

        const projects = DB.getAllProjects();
        const projectMap = {};
        projects.forEach(p => { projectMap[p.id] = p.name; });

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
                    body: JSON.stringify(payload)
                });
                const result = await resp.json();
                if (result.success) {
                    DB.markSynced(expense.id);
                }
            } catch (e) {
                console.warn('Sync failed for', expense.id, e);
            }
        }
    }
};
