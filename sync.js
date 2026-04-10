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
                    photo: null // Photos sent separately to avoid URL length limits
                };

                // Use GET with data in URL param to avoid POST redirect issue
                const encoded = encodeURIComponent(JSON.stringify(payload));
                const resp = await fetch(this.url + '?data=' + encoded, {
                    method: 'GET',
                    redirect: 'follow'
                });
                const text = await resp.text();
                try {
                    const result = JSON.parse(text);
                    if (result.success) {
                        DB.markSynced(expense.id);
                    }
                } catch (e) {
                    console.warn('Sync parse error:', text.substring(0, 200));
                }

                // Upload photo separately if exists
                if (expense.photoBase64) {
                    await this._uploadPhoto(expense, projectMap[expense.projectId] || '未分類');
                }
            } catch (e) {
                console.warn('Sync failed for', expense.id, e);
            }
        }
    },

    async _uploadPhoto(expense, projectName) {
        try {
            const payload = {
                action: 'uploadPhoto',
                record: {
                    id: expense.id,
                    project: projectName,
                    amount: expense.amount,
                    currency: expense.currency,
                    paymentDate: expense.date
                },
                photo: expense.photoBase64
            };
            // Photos must use POST due to size
            await fetch(this.url, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.warn('Photo upload failed:', e);
        }
    }
};
