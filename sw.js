const CACHE_NAME = 'expense-claim-v23';
const ASSETS = ['/', 'index.html', 'style.css', 'app.js', 'db.js', 'ai.js', 'sync.js', 'manifest.json'];

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // Skip SW interception for cross-origin requests so they go directly to network
    // (e.g. fetches to script.google.com for Apps Script sync). Otherwise the SW's
    // fetch+catch wrapper can break cross-origin GET with very long URLs and surface
    // as "TypeError: Failed to fetch" in the page.
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) {
        return; // let browser handle natively
    }
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
