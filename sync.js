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
                // If this expense was previously synced (has a prior syncedAt record),
                // it means only status changed — use updateRecord instead of addRecord
                const isUpdate = expense._wasSynced;
                const action = isUpdate ? 'updateRecord' : 'addRecord';

                const payload = {
                    action,
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
                    } else if (isUpdate && result.error && result.error.includes('not found')) {
                        // updateRecord failed (ID not in sheet yet) — retry as addRecord
                        payload.action = 'addRecord';
                        const retryEncoded = encodeURIComponent(JSON.stringify(payload));
                        const retryResp = await fetch(this.url + '?data=' + retryEncoded, {
                            method: 'GET', redirect: 'follow'
                        });
                        const retryText = await retryResp.text();
                        try {
                            const retryResult = JSON.parse(retryText);
                            if (retryResult.success) DB.markSynced(expense.id);
                        } catch (e2) {}
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
            // Compress image before upload to reduce payload size
            const compressed = await this._compressPhoto(expense.photoBase64);

            const payload = {
                action: 'uploadPhoto',
                record: {
                    id: expense.id,
                    project: projectName,
                    amount: expense.amount,
                    currency: expense.currency,
                    paymentDate: expense.date
                },
                photo: compressed
            };
            // Apps Script 302 redirects POST→GET, losing body.
            // no-cors mode: body IS sent, server processes doPost, we just can't read response.
            await fetch(this.url, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            console.log('Photo upload sent for', expense.id);
        } catch (e) {
            console.warn('Photo upload failed:', e);
        }
    },

    async _compressPhoto(base64Data) {
        // Compress to max 800px wide, 0.6 quality JPEG
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxW = 800;
                let w = img.width, h = img.height;
                if (w > maxW) { h = h * maxW / w; w = maxW; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
            img.onerror = () => resolve(base64Data); // fallback to original
            img.src = base64Data;
        });
    }
};
