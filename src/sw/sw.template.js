// The offline copy of the app (specs/034). A service worker that keeps the app's OWN files, and nothing else, so the page keeps working
// when the network goes away after it has loaded: the page, its scripts, the data engine and the file readers. It never sees a file
// you open, caches no request to another site, and caches nothing but what this site serves. The build fills in the version and the
// list of files, and writes the result as sw.js beside the page.

const BUILD = "__BUILD_ID__";
const MANIFEST = "__MANIFEST__";
const CACHE = `sdg-${BUILD}`;
const SCOPE = self.registration.scope; // ends with "/"

self.addEventListener("install", (event) => {
  // No skipWaiting: a new version waits until the tabs of the old one are closed, so an open page never loses files it still needs.
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("sdg-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** A cached full response answered as the byte range that was asked for, which is how the data engine reads some files. */
async function answer(request, hit) {
  const range = request.headers.get("range");
  if (!range) return hit;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) return hit;
  const body = await hit.clone().arrayBuffer();
  const total = body.byteLength;
  let start = m[1] === "" ? total - Number(m[2]) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? total - 1 : Number(m[2]);
  start = Math.max(0, start);
  end = Math.min(total - 1, end);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  const headers = new Headers(hit.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Only this site's own files, inside this folder. Anything else goes to the network untouched (and the page's policy refuses it).
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  event.respondWith(handle(request, url));
});

async function handle(request, url) {
  const cache = await caches.open(CACHE);
  const isPage = request.mode === "navigate" || url.href === SCOPE || url.pathname.endsWith("/index.html");
  if (isPage) {
    // The page is fetched first so an update arrives; the copy is only for when there is no network.
    try {
      const res = await fetch(request);
      if (res.ok) await cache.put(SCOPE, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(SCOPE);
      if (hit) return hit;
      throw err;
    }
  }
  const hit = await cache.match(url.origin + url.pathname);
  if (hit) return answer(request, hit);
  const res = await fetch(request);
  if (res.status === 200) await cache.put(url.origin + url.pathname, res.clone());
  return res;
}

// The page asks for the files of the engine it will use to be fetched now, while there is a network, not at the first file it opens.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm") return;
  event.waitUntil(warm(data.variant === "mvp" ? "mvp" : "eh"));
});

async function tell(message) {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(message);
}

async function warm(variant) {
  const cache = await caches.open(CACHE);
  const files = [...MANIFEST.core, ...MANIFEST[variant]];
  const total = files.reduce((n, f) => n + f.size, 0);
  let bytes = 0;
  let failed = false;
  await tell({ type: "warm-progress", done: 0, total, files: files.length, finished: false });
  const queue = [...files];
  const work = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const key = f.path === "index.html" ? SCOPE : SCOPE + f.path;
      try {
        if (!(await cache.match(key))) {
          const res = await fetch(SCOPE + f.path, { cache: "no-cache" });
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(key, res);
        }
      } catch {
        failed = true;
      }
      bytes += f.size;
      await tell({ type: "warm-progress", done: bytes, total, files: files.length, finished: false });
    }
  };
  await Promise.all([work(), work(), work()]);
  await tell({ type: "warm-progress", done: bytes, total, files: files.length, finished: true, failed });
}
