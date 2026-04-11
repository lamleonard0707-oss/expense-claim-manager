const Sync = {
    url: localStorage.getItem('ec_script_url') || '',
    lastErrors: [],

    setUrl(url) { this.url = url; localStorage.setItem('ec_script_url', url); },

    // ─── Transport ────────────────────────────────────────────────────────
    // Two paths:
    //
    // 1) GET — for small/idempotent reads (ping, getRecord). Apps Script /exec
    //    serves doGet inline (no redirect), so it's CORS-clean and we can
    //    read the JSON response directly.
    //
    // 2) POST (no-cors, fire-and-forget) — for large writes (record + full
    //    photo). Apps Script /exec POST returns 302 → script.googleusercontent.com
    //    which has no CORS headers, so a normal fetch throws "TypeError:
    //    Failed to fetch" on the redirect even though doPost has already
    //    processed the request. Workaround: send as a "simple" CORS request
    //    (Content-Type: text/plain) with mode:'no-cors' — browser dispatches
    //    body without preflight, server runs doPost, opaque response is
    //    discarded. We confirm success afterwards by polling getRecord.
    //
    // This replaces the old chunked-GET upload, which (a) needed many round
    // trips, (b) hit the ~2 KB Apps Script GET URL limit and silently failed,
    // and (c) couldn't be retried because client-side bookkeeping diverged
    // from server-side cache state.
    async _get(payload) {
        if (!this.url) throw new Error('Apps Script URL 未設定');
        const url = this.url + (this.url.includes('?') ? '&' : '?') + 'data=' + encodeURIComponent(JSON.stringify(payload));
        const resp = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
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

    async _postFireAndForget(payload) {
        if (!this.url) throw new Error('Apps Script URL 未設定');
        // Note: with mode:'no-cors' the response is opaque — we cannot read
        // status, headers, or body. That's fine: success is verified by
        // polling getRecord afterwards.
        await fetch(this.url, {
            method: 'POST',
            mode: 'no-cors',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
    },

    async testConnection() {
        if (!this.url) return { ok: false, error: 'URL 未設定' };
        try {
            const result = await this._get({ action: 'ping' });
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
                const expectsPhoto = !!expense.photoBase64;
                const photoKB = expectsPhoto ? Math.round(expense.photoBase64.length * 0.75 / 1024) : 0;

                onProgress(`📤 [${expense.id}] POST${expectsPhoto ? ` (photo ~${photoKB}KB)` : ''}...`);
                await this._postFireAndForget({
                    action: 'addRecord',
                    record: record,
                    photo: expense.photoBase64 || null
                });

                onProgress(`🔍 [${expense.id}] verifying...`);
                const verified = await this._verifyRecord(expense.id, expectsPhoto, onProgress);
                if (verified.ok) {
                    DB.markSynced(expense.id);
                    synced++;
                    onProgress(`✅ [${expense.id}] synced${verified.photoUrl ? ' + photo' : ''}`);
                } else {
                    failed++;
                    this.lastErrors.push(`[${expense.id}] ${verified.error}`);
                    onProgress(`❌ [${expense.id}] ${verified.error}`);
                }
            } catch (e) {
                failed++;
                this.lastErrors.push(`[${expense.id}] ${e.name || 'Error'}: ${e.message}`);
                console.warn('Sync failed for', expense.id, e);
            }
        }
        return { synced, failed, errors: this.lastErrors };
    },

    // Poll the server for the record. Returns when:
    //   - record exists AND (no photo expected OR photo URL is filled in col 11)
    //   - timeout reached
    // Server-side addRecord is idempotent: a retry on a row that exists but
    // has no photo will fill the photo in. So leaving an expense unsynced is
    // safe — next sync will pick it up and the server will only do the
    // missing work.
    async _verifyRecord(id, expectsPhoto, onProgress) {
        const progress = onProgress || function() {};
        const start = Date.now();
        // Photos take longer because Apps Script has to base64-decode + write
        // to Drive + share + write back to sheet. 60s is comfortable for ~150KB.
        const TIMEOUT_MS = expectsPhoto ? 60000 : 20000;
        const intervals = [2500, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 10000];
        let attempt = 0;
        let lastSeen = null;

        while (Date.now() - start < TIMEOUT_MS) {
            const wait = intervals[Math.min(attempt, intervals.length - 1)];
            await new Promise(r => setTimeout(r, wait));
            attempt++;
            try {
                const r = await this._get({ action: 'getRecord', id: id });
                lastSeen = r;
                if (r && r.success && r.found) {
                    if (!expectsPhoto) return { ok: true };
                    if (r.hasPhoto) return { ok: true, photoUrl: r.photoUrl };
                    progress(`  ⏳ row OK，等 photo... (${Math.round((Date.now()-start)/1000)}s)`);
                } else {
                    progress(`  ⏳ 等 server... (${Math.round((Date.now()-start)/1000)}s)`);
                }
            } catch (e) {
                progress(`  ⚠️ verify ${e.message}`);
            }
        }
        if (lastSeen && lastSeen.found && expectsPhoto && !lastSeen.hasPhoto) {
            return { ok: false, error: `row OK 但 photo 未上 Drive (${TIMEOUT_MS/1000}s timeout) — 下次 sync 會自動 retry photo` };
        }
        return { ok: false, error: `record ${TIMEOUT_MS/1000}s 內未出現 — 下次 sync 會 retry` };
    }
};
