/* ===================================================================
   FETCH HELPERS
   =================================================================== */

// Auth endpoints (sign in / refresh). apikey only, no bearer needed.
async function authRequest(grant, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.msg || data.error || "Auth failed");
  return data;
}

function storeAuth(data) {
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  });
}

async function signIn(email, password) {
  storeAuth(await authRequest("password", { email, password }));
}

// Refresh the access token using the stored refresh token. Returns false on failure.
async function refreshSession() {
  if (!session?.refresh_token) return false;
  try { storeAuth(await authRequest("refresh_token", { refresh_token: session.refresh_token })); return true; }
  catch { return false; }
}

// Core authed fetch. Adds apikey + bearer, transparently refreshes once on 401.
async function api(path, opts = {}, _retried = false) {
  const headers = Object.assign(
    { apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || ""}` },
    opts.headers || {}
  );
  let r;
  try { r = await fetch(`${SUPABASE_URL}${path}`, Object.assign({}, opts, { headers })); }
  catch (e) {
    // Honest failure copy (2026-07-19): say what it means for her data, not
    // just that TCP had a bad day. Surfaced by every toast(e.message) caller.
    // "Didn't go through" is deliberately direction-neutral (covers failed
    // reads too, e.g. the retry-load path — not everything is a save).
    throw new Error(navigator.onLine === false
      ? "You're offline — that didn't go through. It'll work when you're back online."
      : "Can't reach the server right now — that didn't go through. Try again in a moment.");
  }

  if (r.status === 401 && !_retried) {
    if (await refreshSession()) return api(path, opts, true);
    handleSignedOut();
    throw new Error("Session expired — please sign in again.");
  }
  return r;
}

// PostgREST helper. Returns parsed JSON (or null for empty).
async function rest(path, opts = {}) {
  const r = await api(`/rest/v1/${path}`, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || e.hint || `Request failed (${r.status})`);
  }
  if (r.status === 204) return null;
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// Upload a Blob to Storage at <user_id>/<name>. RLS keys off the user-id folder.
async function uploadPhoto(blob, filename) {
  const path = `${session.user.id}/${filename}`;
  const r = await api(`/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { "Content-Type": blob.type, "x-upsert": "true" },
    body: blob,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `Photo upload failed (${r.status})`);
  }
  return path;
}

async function deletePhoto(path) {
  if (!path) return;
  evictPhotoCache(path);  // fire-and-forget; hoisted from the byte-cache block below
  await api(`/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE" }).catch(() => {});
}

// Signed URLs for private photos. Cached in-memory so a grid doesn't re-sign each render.
const _urlCache = new Map();
async function signedUrl(path) {
  if (!path) return null;
  if (_urlCache.has(path)) return _urlCache.get(path);
  const r = await api(`/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_TTL }),
  });
  if (!r.ok) return null;
  const { signedURL } = await r.json();
  const full = `${SUPABASE_URL}/storage/v1${signedURL}`;
  _urlCache.set(path, full);
  setTimeout(() => _urlCache.delete(path), (SIGNED_TTL - 60) * 1000);
  return full;
}

// Batch-sign up to `paths.length` URLs in a single API call (Supabase batch endpoint).
async function signedUrlBatch(paths) {
  if (!paths.length) return;
  try {
    const r = await api(`/storage/v1/object/sign/${BUCKET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, expiresIn: SIGNED_TTL }),
    });
    if (!r.ok) return;
    const rows = await r.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row.signedURL && !row.error) {
        const full = `${SUPABASE_URL}/storage/v1${row.signedURL}`;
        _urlCache.set(row.path, full);
        setTimeout(() => _urlCache.delete(row.path), (SIGNED_TTL - 60) * 1000);
      }
    }
  } catch (_) { /* non-fatal */ }
}

// Pre-warm the URL cache for all item photos right after data loads.
async function prewarmUrlCache() {
  const paths = [...new Set(
    items.filter(i => i.image_path && !_urlCache.has(i.image_path)).map(i => i.image_path)
  )];
  for (let i = 0; i < paths.length; i += 100) {
    signedUrlBatch(paths.slice(i, i + 100)); // fire and forget
  }
}

/* ===================================================================
   LOCAL PHOTO BYTE CACHE  (Cache Storage API — Supabase egress guard)
   =================================================================== */
// Signed URLs change every session, so the browser's HTTP cache never hits and
// every session re-downloaded every photo from Supabase (the July 2026 "usage
// quota" email — EGRESS, not storage size). Fix: cache the actual image bytes
// locally, keyed by the STABLE image_path, and serve blob: URLs from the cache.
// First view downloads once; every later view — including future sessions — is
// local. Falls back to plain signed URLs where the Cache API is unavailable
// (insecure context / some private-browsing modes).
const PHOTO_CACHE = "wardrobe-photos-v1";
const _photoCacheOK = typeof caches !== "undefined";
const _blobUrlCache = new Map();   // image_path -> blob: URL (this session)
const _photoPending = new Map();   // image_path -> in-flight promise (dedupes grid re-renders)
const photoCacheKey = (path) => `${location.origin}/__photo-cache/${encodeURIComponent(path)}`;

function photoUrl(path) {
  if (!path) return Promise.resolve(null);
  if (_blobUrlCache.has(path)) return Promise.resolve(_blobUrlCache.get(path));
  let p = _photoPending.get(path);
  if (!p) {
    p = _photoUrlUncached(path).finally(() => _photoPending.delete(path));
    _photoPending.set(path, p);
  }
  return p;
}
async function _photoUrlUncached(path) {
  if (_photoCacheOK) {
    try {
      const cache = await caches.open(PHOTO_CACHE);
      const key = photoCacheKey(path);
      let resp = await cache.match(key);
      if (!resp) {
        const su = await signedUrl(path);
        if (!su) return null;
        const net = await fetch(su);
        if (!net.ok) throw new Error(`photo fetch ${net.status}`);
        await cache.put(key, net.clone());
        resp = net;
      }
      const blobUrl = URL.createObjectURL(await resp.blob());
      _blobUrlCache.set(path, blobUrl);
      return blobUrl;
    } catch (_) { /* cache quota/eviction/offline — fall through to a signed URL */ }
  }
  return signedUrl(path);
}
// Local bytes are stale the moment the storage object changes — called from
// deletePhoto (which both photo-replace and photo-remove flow through).
async function evictPhotoCache(path) {
  if (!path) return;
  const u = _blobUrlCache.get(path);
  if (u) { URL.revokeObjectURL(u); _blobUrlCache.delete(path); }
  if (_photoCacheOK) { try { (await caches.open(PHOTO_CACHE)).delete(photoCacheKey(path)); } catch (_) {} }
}
// Drop cached bytes no longer referenced by any item (items deleted, photos
// replaced on another device). Fire-and-forget after loadData.
async function prunePhotoCache() {
  if (!_photoCacheOK || !items.length) return;
  try {
    const live = new Set(items.map(i => i.image_path).filter(Boolean).map(photoCacheKey));
    const cache = await caches.open(PHOTO_CACHE);
    for (const req of await cache.keys()) if (!live.has(req.url)) cache.delete(req);
  } catch (_) {}
}

/* ===================================================================
   IMAGE COMPRESSION  (canvas downscale -> WebP, JPEG fallback)
   =================================================================== */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > MAX_DIM) {
        const s = MAX_DIM / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      /* ⚠️ TRANSPARENCY IS PRESERVED WHEN THE SOURCE HAS IT (2026-08-16, her
         report: "images with background removed get uploaded with white
         background"). This used to fillRect white unconditionally, to flatten
         any alpha — right when every photo was a camera shot on a surface, and
         wrong now she cuts backgrounds out. It also contradicted the display
         layer: loadPhotoNode sets backgroundColor "transparent" precisely so a
         cut-out garment sits cleanly on the tile, and every thumb is
         background-size: contain. So upload was destroying exactly what display
         was built to show — and a white rectangle looks worst in dark mode,
         where the tile behind it is not white.
         ⚠️ JPEG CANNOT CARRY ALPHA, so a transparent image must never reach the
         JPEG fallback — PNG is the fallback there instead. Bigger, but a photo
         silently flattened is the bug being fixed. */
      const mayHaveAlpha = /png|webp|gif|avif/i.test(file.type || "");
      ctx.drawImage(img, 0, 0, w, h);
      let keepAlpha = false;
      if (mayHaveAlpha) {
        try {
          // Sample the alpha channel rather than trusting the MIME type — most
          // PNGs are fully opaque, and those should still get the smaller
          // white-flattened JPEG path.
          const d = ctx.getImageData(0, 0, w, h).data;
          for (let k = 3; k < d.length; k += 4) if (d[k] < 250) { keepAlpha = true; break; }
        } catch { keepAlpha = true; }   // tainted canvas: assume alpha, never flatten
      }
      if (!keepAlpha) {
        // Opaque source: flatten onto true white (baked into the stored file, so
        // deliberately not a theme token) and take the smaller encodings.
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
      }
      c.toBlob((blob) => {
        if (blob && blob.type === "image/webp") return resolve({ blob, ext: "webp" });
        if (keepAlpha) {
          return c.toBlob((png) => png ? resolve({ blob: png, ext: "png" })
                                       : reject(new Error("Could not process image")), "image/png");
        }
        c.toBlob((jpg) => jpg ? resolve({ blob: jpg, ext: "jpg" }) : reject(new Error("Could not process image")),
                 "image/jpeg", ENCODE_Q);
      }, "image/webp", ENCODE_Q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

