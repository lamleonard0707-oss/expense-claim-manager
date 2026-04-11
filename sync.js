const Sync = {
    url: localStorage.getItem('ec_script_url') || '',
    lastErrors: [],

    setUrl(url) { this.url = url; localStorage.setItem('ec_script_url', url); },

    // ---- Transport ----
    // Apps Script web apps return 302 -> script.googleusercontent.com on POST,
    // and the redirected origin doesn't reliably set CORS headers, so cross-origin
    // POST from PWA throws "TypeError: Failed to fetch". GET to /exec serves doGet
    // inline (no redirect), so it's CORS-clean. We send everything as GET ?data=...
    async _call(payload) {
        if (!this.url) throw new Error('Apps Script URL 未設定');
        const url = this.url + (this.url.includes('?') ? '&' : '?') + 'data=' + encodeURIComponent(JSON.stringify(payload));
        const resp = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        const text = await resp.text();
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
            throw new Error('Apps Script 回應 HTML（access 設定唔啱，要 redeploy 為 Anyone）');
        }
        try {
            return JSON.parse(text);
        } catch (parseErr) {
            throw new Error(`回應唔係 JSON: ${text.substring(0, 120)}`);
        }
    },

    async testConnection() {
        if (!this.url) return { ok: false, error: 'URL 未設定' };
        try {
            const result = await this._call({ action: 'ping' });
            if (result && (result.success || result.pong)) {
                return { ok: true, response: JSON.stringify(result).substring(0, 200) };
            }
            return { ok: false, error: 'Unexpected response: ' + JSON.stringify(result).substring(0, 200) };
        } catch (e) {
            return { ok: false, error: `${e.name || 'Error'}: ${e.message}` };
        }
    },

    async push(opts) {
        const onProgress = (opts && opts.onProgress) || function() {};
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

        for (const expense of unsynced) {
            try {
                const record = {
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
                };

                // Step 1: addRecord WITHOUT photo (small payload, fits in URL)
                onProgress(`📝 [${expense.id}] addRecord...`);
                const addResult = await this._call({ action: 'addRecord', record: record, photo: null });
                if (!addResult.success) {
                    failed++;
                    this.lastErrors.push(`[${expense.id}] addRecord 失敗: ${addResult.error || JSON.stringify(addResult)}`);
                    continue;
                }

                // Step 2: if photo exists, upload via chunked GET
                if (expense.photoBase64) {
                    const photoOk = await this._uploadPhotoChunked(record, expense.photoBase64, onProgress);
                    if (!photoOk.success) {
                        // Record IS in sheet but photo upload failed.
                        // Mark as synced anyway so we don't re-insert duplicate, but log warning.
                        this.lastErrors.push(`[${expense.id}] record OK 但 photo 失敗: ${photoOk.error}`);
                    }
                }

                DB.markSynced(expense.id);
                synced++;
            } catch (e) {
                failed++;
                this.lastErrors.push(`[${expense.id}] ${e.name || 'Error'}: ${e.message}`);
                console.warn('Sync failed for', expense.id, e);
            }
        }
        return { synced, failed, errors: this.lastErrors };
    },

    async _uploadPhotoChunked(record, photoDataUrl, onProgress) {
        const progress = onProgress || function() {};
        // Strip data URL prefix
        let base64 = photoDataUrl;
        if (base64.indexOf(',') !== -1) base64 = base64.split(',')[1];

        // Apps Script /exec GET endpoint practical query-string limit is ~2 KB.
        // base64 chars: ~70% are alphanumeric (URL-safe) + ~30% are `+`, `/`, `=`
        // which become %2B, %2F, %3D — so encodeURIComponent inflates base64 by ~1.6x.
        // 1000-char chunk → encoded ~1.6 KB → URL with JSON wrapper + base ~1.9 KB. Safe.
        // (v23 used 3000 → ~5 KB URL → silently failed with "TypeError: Failed to fetch".)
        const CHUNK_SIZE = 1000;
        const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const chunk = base64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            try {
                const result = await this._call({
                    action: 'uploadPhotoChunk',
                    record: { id: record.id, project: record.project, paymentDate: record.paymentDate, amount: record.amount, currency: record.currency },
                    chunk: chunk,
                    chunkIndex: i,
                    totalChunks: totalChunks
                });
                if (!result.success) {
                    return { success: false, error: `chunk ${i + 1}/${totalChunks} 失敗: ${result.error || JSON.stringify(result)}` };
                }
            } catch (chunkErr) {
                return { success: false, error: `chunk ${i + 1}/${totalChunks} ${chunkErr.name || 'Error'}: ${chunkErr.message}` };
            }
            progress(`📤 chunk ${i + 1}/${totalChunks}`);
        }
        return { success: true };
    }
};
