// AquaMega maps: 100% free. OpenStreetMap tiles (Leaflet) + Nominatim (address search) + OSRM (road routing).
// No account, API key or credit card needed. Needs an internet connection in the browser.
// Accuracy model: a customer's pin (or a staff-corrected spot) is exact. A typed address is searched, saved on the order,
// and flagged "approximate" unless it matched the actual house/building. Any pin can be dragged onto the doorstep to fix it for good.
let lm = null, lLayer = null, lEl = null, lDot = null, lWatch = null, routeOpt = null, routeTok = 0, routeCache = {}, geoQ = Promise.resolve();
let cm = null, cLayer = null, cEl = null, cvTok = 0;
const geoCache = ld('aqf_geo2', {});
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
let leafP = null;
const loadLeaflet = () => window.L ? Promise.resolve() : leafP || (leafP = new Promise((ok, no) => {
  const c = document.createElement('link'); c.rel = 'stylesheet'; c.href = LEAFLET + '.css'; document.head.appendChild(c);
  const s = document.createElement('script'); s.src = LEAFLET + '.js'; s.onload = ok;
  s.onerror = () => { leafP = null; no(new Error('Couldn’t load the map. Check the internet connection.')); };
  document.head.appendChild(s);
}));
const TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }];
const MANILA = { lat: 14.5995, lng: 120.9842 };
const stationLL = () => payNums.stationLL || null;
const km = m => (m / 1000).toFixed(1) + ' km', mins = s => Math.max(1, Math.round(s / 60)) + ' min';
const hav = (a, b) => { const r = x => x * Math.PI / 180, d = r(b.lat - a.lat), e = r(b.lng - a.lng), q = Math.sin(d / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(e / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(q)); };

const getJSON = async (url, ms = 15000) => {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
};

/* ---- Address -> coordinates (Nominatim: max 1 request/second; results cached on this device) ---- */
const ABBR = [[/\bbrgy\.?\s*/gi, 'Barangay '], [/\bbgy\.?\s*/gi, 'Barangay '], [/\bst\.?(?=\s|,|$)/gi, 'Street'], [/\bave\.?(?=\s|,|$)/gi, 'Avenue'], [/\bext\.?(?=\s|,|$)/gi, 'Extension'],
  [/\bblvd\.?(?=\s|,|$)/gi, 'Boulevard'], [/\bsta\.?\s+/gi, 'Santa '], [/\bbldg\.?/gi, 'Building'], [/\bnr\.?\s+/gi, 'near '], [/[#]/g, ' '], [/\s+/g, ' ']];
const clean = a => ABBR.reduce((s, [r, t]) => s.replace(r, t), a).replace(/\s*,\s*/g, ', ').trim();
const noNums = a => a.replace(/(^|[\s,])(?<!barangay\s)(?:no\.?\s*)?\d+[a-z]?(?:-\d+)?(?=[\s,]|$)/gi, '$1').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');   // drop house/unit numbers
function variants(addr) {   // best guess first, then progressively broader
  const list = [[addr, 0], [clean(addr), 0]], n = noNums(clean(addr)), parts = clean(addr).split(',').map(s => s.trim()).filter(Boolean), words = n.split(' ');
  list.push([n, 1]);
  if (parts.length > 2) list.push([parts.slice(-3).join(', '), 2], [parts.slice(-2).join(', '), 2]);
  else if (words.length >= 3) { if (words.length > 3) list.push([words.slice(-3).join(' '), 2]); list.push([words.slice(-2).join(' '), 2]); }
  const seen = new Set(); return list.filter(([q]) => q && !/^(street|avenue|extension|boulevard)\b/i.test(q) && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()));   // skip fragments that start with just a street word
}
const bias = () => { const c = stationLL() || MANILA, d = .25; return `${c.lng - d},${c.lat + d},${c.lng + d},${c.lat - d}`; };   // prefer matches near the station
const levelOf = r => (r.category === 'highway' || r.category === 'place' && r.type === 'square') ? 'street'
  : ((r.category === 'building' || r.category === 'amenity' || r.category === 'shop' || r.category === 'office' || r.category === 'tourism' || r.category === 'craft' || r.category === 'healthcare' || ['house', 'residential', 'apartments', 'yes'].includes(r.type)) ? 'exact' : 'area');
const nominatim = q => geoQ = geoQ.then(async () => {
  const k = q.toLowerCase(); if (k in geoCache) return geoCache[k];
  await new Promise(r => setTimeout(r, 1100));
  let hit = null;
  try { const j = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&viewbox=' + bias() + '&q=' + enc(q)); if (j[0]) hit = { lat: +j[0].lat, lng: +j[0].lon, level: levelOf(j[0]), name: j[0].display_name }; } catch { return null; }   // network hiccup: don't cache
  geoCache[k] = hit; sv('aqf_geo2', geoCache); return hit;
});
async function geocode(addr, noSanity) {
  for (const [q, broad] of variants(addr)) {
    const h = await nominatim(q + ', Philippines'); if (!h) continue;
    let exact = h.level === 'exact' && broad === 0, note = exact ? '' : h.level === 'street' && broad === 0 ? 'matched to the street only' : 'matched by area only';
    const st = stationLL();
    if (!noSanity && st && hav(st, h) > 30000) { exact = false; note = 'looks far from the station'; }   // sanity check: wrong city / province match
    return { lat: h.lat, lng: h.lng, exact, note };
  }
  return null;
}
const srcLabel = p => p.src === 'staff' ? 'Verified by staff' : p.src === 'pin' ? 'Customer set pin' : p.src === 'gps' ? 'Customer GPS pin' : p.exact ? 'Address match (house level)' : '⚠ Approximate: ' + (p.note || 'matched by area only');
// Where is this order? Saved spot first (pin / staff / earlier search), else search the typed address and save the result.
async function locate(o) {
  if (o.lat != null && o.lng != null) return { lat: +o.lat, lng: +o.lng, exact: o.geoSrc !== 'approx', src: o.geoSrc || 'gps', note: o.geoSrc === 'approx' ? 'matched by area only' : '' };
  const g = await geocode(o.addr); if (!g) return null;
  const src = g.exact ? 'search' : 'approx'; o.lat = g.lat; o.lng = g.lng; o.geoSrc = src;
  if (authed) api('admin/geo', { id: o.id, lat: g.lat, lng: g.lng, src }).catch(() => { });
  return { ...g, src };
}
const here = () => new Promise(ok => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, exact: true }), () => ok(null), { enableHighAccuracy: true, timeout: 8000 })
  : ok(null));
const saveSpot = async (id, ll) => { try { await api('admin/geo', { id, lat: ll.lat, lng: ll.lng, src: 'staff' }); toast(`Delivery spot saved for ${id}. Next time it's exact.`, 'k'); await refresh(); } catch (e) { fail(e); } };
const saveStation = async ll => { try { await api('admin/stationPin', { lat: ll.lat, lng: ll.lng }); toast('Station location saved. All routes now start from this exact spot.', 'k'); await refresh(); } catch (e) { fail(e); } };

/* ---- Rider route map ---- */
const mkMap = (el, c) => { const m = L.map(el).setView([c.lat, c.lng], 12); L.tileLayer(...TILES).addTo(m); return m; };
const pinIcon = (txt, bg) => L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div style="width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px #0006;font:700 13px/24px system-ui;text-align:center">${txt}</div>` });

function afterRender() {   // called by render(); re-attaches the persistent maps so they aren't rebuilt (and reloaded) on every redraw
  let ph = $('#rmapph');
  if (ph) { if (!lEl) { lEl = document.createElement('div'); lEl.id = 'rmap'; lEl.style.cssText = 'height:420px;border-radius:12px;margin-top:10px;background:var(--soft);position:relative;z-index:0'; } ph.replaceWith(lEl); drawRoute(); }
  ph = $('#cvph');
  if (ph) { if (!cEl) { cEl = document.createElement('div'); cEl.id = 'cvmap'; cEl.style.cssText = 'height:460px;border-radius:12px;background:var(--soft);position:relative;z-index:0'; } ph.replaceWith(cEl); drawCoverage(); }
}

async function drawRoute() {
  const my = ++routeTok, info = () => $('#rinfo'), live = () => my === routeTok && info();
  window.lastRoute = null;
  const all = stopsFor(orders.filter(o => o.rider === rider && o.status !== 'Cancelled')).slice(0, 20);
  if (!all.length || !info()) return;
  info().textContent = 'Loading map…';
  try { await loadLeaflet(); } catch (e) { if (live()) info().innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!live()) return;
  if (!lm) { lm = mkMap(lEl, stationLL() || MANILA); lLayer = L.layerGroup().addTo(lm); }
  lm.invalidateSize();

  // 1. starting point: the station (a pin placed by staff beats an address search)
  let start = stationLL() && { ...stationLL(), exact: true, src: 'staff' }; const loop = !!payNums.station;
  if (!start && loop) { info().textContent = 'Locating the station…'; start = await geocode(payNums.station, true); } else if (!loop) start = await here();
  if (!live()) return;
  if (!start) { info().innerHTML = `<p class="err">${loop ? 'Couldn’t find the station address on the map. Open the Coverage tab and drag the station pin onto the exact spot.' : 'Allow location access so the route has a starting point.'}</p>`; return; }
  // 2. find every stop
  const pts = [];
  for (let i = 0; i < all.length; i++) { if (!live()) return; info().textContent = `Locating addresses… ${i + 1} of ${all.length}`; pts.push(await locate(all[i])); }
  if (!live()) return;
  const stops = all.filter((_, i) => pts[i]), P = pts.filter(Boolean), lost = all.filter((_, i) => !pts[i]);
  lLayer.clearLayers();
  lost.forEach((o, i) => L.marker([start.lat + .002 * (i + 1), start.lng + .002 * (i + 1)], { icon: pinIcon('?', '#dc2626'), draggable: true }).bindPopup(`<b>${esc(o.name)}</b><br>${esc(o.addr)}<br>Drag me onto the exact spot`).on('dragend', e => saveSpot(o.id, e.target.getLatLng())).addTo(lLayer));
  const lostMsg = lost.length ? `<p class="err">Couldn’t find ${lost.map(o => esc(o.id) + ' (' + esc(o.addr) + ')').join(', ')} from the address. Drag the red <b>?</b> pin onto the exact spot on the map and it’s saved for good (or ask the customer to pin their location). Use Navigate meanwhile.</p>` : '';
  if (!stops.length) { info().innerHTML = lostMsg; lm.setView([start.lat, start.lng], 14); return; }

  // 3. road route (OSRM). Keep promised time slots in order unless told otherwise.
  const slots = new Set(stops.map(o => o.date + o.slot)).size, opt = (routeOpt ?? slots === 1) && stops.length > 1;
  const c = [start, ...P].map(p => `${p.lng},${p.lat}`), base = 'https://router.project-osrm.org';
  info().textContent = 'Finding the best road route…';
  const url = opt ? `${base}/trip/v1/driving/${c.join(';')}?source=first&${loop ? 'roundtrip=true' : 'roundtrip=false&destination=last'}&geometries=geojson&overview=full`
    : `${base}/route/v1/driving/${(loop ? [...c, c[0]] : c).join(';')}?geometries=geojson&overview=full`;
  let j = routeCache[url];
  try { if (!j) { j = await getJSON(url); if (j.code !== 'Ok') throw new Error(j.code); routeCache[url] = j; } }
  catch (e) { if (live()) info().innerHTML = `<p class="err">Couldn’t reach the free routing service${e.message ? ' (' + esc(e.message) + ')' : ''}. Try again in a moment, or use the Navigate buttons.</p>${lostMsg}`; return; }
  if (!live()) return;

  const r = opt ? j.trips[0] : j.routes[0];
  const order = opt ? stops.map((_, i) => ({ i, k: j.waypoints[i + 1].waypoint_index })).sort((a, b) => a.k - b.k).map(x => x.i) : stops.map((_, i) => i);
  const line = L.polyline(r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), { color: '#0284c7', weight: 5, opacity: .85 }).addTo(lLayer);
  L.marker([start.lat, start.lng], { icon: pinIcon(loop ? 'S' : '●', '#0f766e'), draggable: loop }).bindPopup(loop ? '<b>Station</b><br>Drag to set the exact spot' : 'Your location').on('dragend', e => saveStation(e.target.getLatLng())).addTo(lLayer);
  let dist = 0, secs = 0, weak = 0;
  const rows = order.map((si, n) => {
    const o = stops[si], p = P[si], lg = r.legs[n]; dist += lg.distance; secs += lg.duration; if (!p.exact) weak++;
    L.marker([p.lat, p.lng], { icon: pinIcon(n + 1, p.exact ? '#0284c7' : '#d97706'), draggable: true }).bindPopup(`<b>${esc(o.name)}</b><br>${esc(o.addr)}<br><i>${esc(srcLabel(p))}</i><br>Drag to correct`).on('dragend', e => saveSpot(o.id, e.target.getLatLng())).addTo(lLayer);
    return `<li><b>${esc(o.name)}</b> · ${esc(o.id)}<div class="mu">📍 ${esc(o.addr)} · ${esc(o.slot)}<br>🚗 ${km(lg.distance)}, about ${mins(lg.duration)} from ${n ? 'the previous stop' : (loop ? 'the station' : 'your location')} · <a target="_blank" rel="noopener" href="${esc(navUrl(o))}">Navigate</a><br><span class="${p.exact ? 'mu' : 'err'}">${p.exact ? '✔ ' : ''}${esc(srcLabel(p))}</span></div></li>`;
  }).join('');
  if (loop && r.legs[order.length]) { dist += r.legs[order.length].distance; secs += r.legs[order.length].duration; }
  lm.fitBounds(line.getBounds(), { padding: [30, 30] });
  window.lastRoute = { rider, order: order.map(si => stops[si]), meta: `Route ${km(dist)} · about ${mins(secs)} driving` };
  info().innerHTML = `${lostMsg}<ol style="margin:6px 0 8px;padding-left:20px">${rows}</ol><div><b>Total${loop ? ' (back to station)' : ''}: ${km(dist)} · about ${mins(secs)} driving</b></div>
    <label class="chk"><input type="checkbox" id="ropt" ${opt ? 'checked' : ''}${stops.length < 2 ? ' disabled' : ''}> Re-order stops for the shortest trip${slots > 1 ? ' (may ignore time slots)' : ''}</label>
    <p class="mu">${weak ? `<b>${weak} stop${weak > 1 ? 's are' : ' is'} approximate (orange).</b> ` : ''}Drag any pin onto the exact doorstep to fix it for good. Blue = exact, orange = approximate. Map © OpenStreetMap contributors, routing by OSRM.</p>`;

  if (!lWatch && navigator.geolocation) lWatch = navigator.geolocation.watchPosition(p => {   // live blue dot for this device
    const ll = [p.coords.latitude, p.coords.longitude];
    if (!lDot) lDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(lm); else lDot.setLatLng(ll);
  }, () => { }, { enableHighAccuracy: true });
}
document.addEventListener('change', e => { if (e.target.id === 'ropt') { routeOpt = e.target.checked; drawRoute(); } });

/* ---- Coverage map (Statement of the Problem #1: know which households are served and where the gaps are) ---- */
const areaOf = a => { const p = a.split(',').map(s => s.trim()).filter(Boolean); return (p.length > 1 ? p.slice(-2).join(', ') : a.trim().split(/\s+/).slice(-2).join(' ')).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); };
function households() {   // one entry per customer address (latest order wins), with its saved spot if it has one
  const m = {};
  orders.filter(o => o.status !== 'Cancelled').sort((a, b) => a.at < b.at ? -1 : 1).forEach(o => {
    const k = Biz.phoneKey(o.phone), h = m[k] ??= { key: k, name: o.name, orders: 0, spent: 0 };
    h.name = o.name; h.addr = o.addr; h.o = o; h.orders++; if (o.status === 'Delivered') h.spent += Biz.cents(o.total);
    if (o.lat != null) { h.lat = +o.lat; h.lng = +o.lng; h.src = o.geoSrc; }
  });
  return Object.values(m);
}
async function drawCoverage() {
  const my = ++cvTok, info = () => $('#cvinfo'), live = () => my === cvTok && info();
  if (!info()) return;
  try { await loadLeaflet(); } catch (e) { info().innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!live()) return;
  const hs = households(), st = stationLL(), placed = hs.filter(h => h.lat != null);
  if (!cm) { cm = mkMap(cEl, st || MANILA); cLayer = L.layerGroup().addTo(cm); }
  cm.invalidateSize(); cLayer.clearLayers();
  if (st) { [500, 1000, 2000].forEach((r, i) => L.circle([st.lat, st.lng], { radius: r, color: '#0f766e', weight: 1, fillOpacity: .03 + i * .0 }).addTo(cLayer)); L.marker([st.lat, st.lng], { icon: pinIcon('S', '#0f766e'), draggable: true }).bindPopup('<b>Station</b><br>Drag to set the exact spot').on('dragend', e => saveStation(e.target.getLatLng())).addTo(cLayer); }
  placed.forEach(h => L.marker([h.lat, h.lng], { icon: pinIcon('🏠', h.src === 'approx' ? '#d97706' : '#0284c7'), draggable: true }).bindPopup(`<b>${esc(h.name)}</b><br>${esc(h.addr)}<br>${h.orders} order(s)<br>Drag to correct`).on('dragend', e => saveSpot(h.o.id, e.target.getLatLng())).addTo(cLayer));
  if (placed.length) cm.fitBounds(L.latLngBounds(placed.map(h => [h.lat, h.lng]).concat(st ? [[st.lat, st.lng]] : [])), { padding: [30, 30], maxZoom: 16 });
  const areas = {}; hs.forEach(h => { const a = areas[areaOf(h.addr)] ??= { n: 0, orders: 0, spent: 0 }; a.n++; a.orders += h.orders; a.spent += h.spent; });
  const ring = r => st ? placed.filter(h => hav(st, h) <= r).length : 0;
  info().innerHTML = `<div class="stats"><div class="card"><span class="mu">Households served</span><b>${hs.length}</b></div><div class="card"><span class="mu">Shown on the map</span><b>${placed.length}</b></div>${st ? `<div class="card"><span class="mu">Within 500 m · 1 km · 2 km of the station</span><b>${ring(500)} · ${ring(1000)} · ${ring(2000)}</b></div>` : ''}</div>
    ${hs.length > placed.length ? `<p class="mu">${hs.length - placed.length} household(s) aren’t on the map yet. <button class="btn sm" data-a="locateAll">📍 Locate all households</button> (about a second each, saved for next time)</p>` : ''}
    ${st ? '' : '<p class="mu">Tip: open a Dispatch route once so the station is located, then drag the S pin to the exact spot.</p>'}
    <h3 style="margin:14px 0 6px">Households by area</h3><div class="scroll"><table><thead><tr><th>Area</th><th>Households</th><th>Orders</th><th>Sales</th></tr></thead><tbody>${Object.entries(areas).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => `<tr><td>${esc(k)}</td><td>${a.n}</td><td>${a.orders}</td><td>${Biz.money(a.spent)}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">No customers yet.</td></tr>'}</tbody></table></div>
    <p class="mu">Use this to plan canvassing: streets with many served homes next to empty streets are your best places to hand out flyers. Blue pins are exact, orange are approximate; drag any pin to correct it.</p>`;
}
async function locateAll() {
  const todo = households().filter(h => h.lat == null); let n = 0;
  for (const h of todo) { toast(`Locating ${++n} of ${todo.length}…`); await locate(h.o); }
  toast('Households located.', 'k'); drawCoverage();
}

/* ---- Customer pin picker: GPS first, then drag the pin onto the doorstep ---- */
let pm = null, pmark = null, pcirc = null, pcur = null, pmoved = false;
const gpsBest = (ms = 8000) => new Promise(ok => {   // keep the most accurate reading for a few seconds
  if (!navigator.geolocation) return ok(null);
  let best = null, id = navigator.geolocation.watchPosition(p => { if (!best || p.coords.accuracy < best.acc) best = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; }, () => { }, { enableHighAccuracy: true });
  setTimeout(() => { navigator.geolocation.clearWatch(id); ok(best); }, ms);
});
function pinPut(ll, acc) {
  pcur = { lat: ll.lat, lng: ll.lng };
  if (!pmark) pmark = L.marker([ll.lat, ll.lng], { draggable: true }).addTo(pm).on('dragend', e => { pcur = e.target.getLatLng(); pmoved = true; pcirc && pm.removeLayer(pcirc); pcirc = null; $('#pinHint').textContent = 'Pin moved. Tap “Use this spot” when it is on your gate or door.'; });
  else pmark.setLatLng([ll.lat, ll.lng]);
  pcirc && pm.removeLayer(pcirc); pcirc = acc ? L.circle([ll.lat, ll.lng], { radius: acc, color: '#2563eb', weight: 1 }).addTo(pm) : null;
  pm.setView([ll.lat, ll.lng], acc && acc > 150 ? 16 : 18);
}
async function openPinPicker() {
  const d = $('#pinDlg'); d.showModal(); $('#pinHint').textContent = 'Loading map…';
  try { await loadLeaflet(); } catch (e) { $('#pinHint').textContent = e.message; return; }
  if (!pm) { pm = L.map('pinMap').setView([MANILA.lat, MANILA.lng], 13); L.tileLayer(...TILES).addTo(pm); }
  setTimeout(() => pm.invalidateSize(), 60); pmoved = false;
  if (pcur) { pinPut(pcur); $('#pinHint').textContent = 'Drag the pin onto your gate or door, then tap “Use this spot”.'; return; }
  A.pinGps();
}
Object.assign(A, {
  pin: openPinPicker,
  pinGps: async () => {
    $('#pinHint').textContent = 'Finding you… hold still for a few seconds.'; const g = await gpsBest();
    if (!g) return $('#pinHint').textContent = 'Couldn’t get your GPS. Tap “Find my typed address”, or drag the pin to your house.';
    pmoved = false; pinPut(g, g.acc);
    $('#pinHint').textContent = g.acc <= 30 ? `Good signal (about ${Math.round(g.acc)} m). Drag the pin if it’s not on your door.` : `GPS is only accurate to about ${Math.round(g.acc)} m here. Please drag the pin onto your gate or door.`;
  },
  pinFind: async () => {
    const a = $('#ca').value.trim(); if (!a) return $('#pinHint').textContent = 'Type your delivery address first.';
    $('#pinHint').textContent = 'Searching…'; const g = await geocode(a, true);
    if (!g) return $('#pinHint').textContent = 'Couldn’t find that address. Zoom the map and drag the pin to your house.';
    pmoved = true; pinPut(g); $('#pinHint').textContent = g.exact ? 'Found it. Check the pin is on your gate or door.' : 'Found the area only. Please drag the pin onto your exact gate or door.';
  },
  pinDone: () => {
    if (!pcur) return $('#pinHint').textContent = 'Place the pin first.';
    pinLL = { lat: pcur.lat, lng: pcur.lng, src: pmoved ? 'pin' : 'gps' };
    $('#pinInfo').textContent = ` ✓ Pinned (${pinLL.src === 'gps' ? 'from your GPS' : 'set on the map'}). The rider will go to this exact spot.`; $('#pinDlg').close();
  },
  pinCancel: () => $('#pinDlg').close(),
  locateAll
});
