'use strict';
// AquaMega backend: Node + SQLite (see db.js), zero npm dependencies. Run: node server.js  ->  http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000;
const FEE = 25, FREE_AT = 500, MAX_BODY = 1e5, UTC_OFFSET = +(process.env.UTC_OFFSET || 8);
const STATUS = ['Pending', 'Confirmed', 'Out for Delivery', 'Delivered'];
const SLOTS = ['ASAP (Within 1 Hour)', 'Morning (9 AM - 12 PM)', 'Afternoon (1 PM - 5 PM)'];
const PAYS = ['COD', 'GCash', 'Maya', 'Credit'];   // Credit = pay later, charged to a signed-in customer's account
const today = () => new Date(Date.now() + UTC_OFFSET * 36e5).toISOString().slice(0, 10);
const httpErr = (code, message, fields) => Object.assign(new Error(message), { code, fields });
// A delivery address is mandatory: at least 10 characters, with letters and more than one word (house/street/barangay/city).
const ADDR_MSG = 'Delivery address is required: add house/unit, street, barangay and city.';
const validAddr = a => a.length >= 10 && /[A-Za-z]/.test(a) && a.split(/\s+/).length >= 2;

/* ---------- Storage: see db.js (SQLite) ---------- */
const D = require('./db');
const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 32).toString('hex');
const same = (p, h) => { const [s, x] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(hash(p, s).split(':')[1], 'hex'), Buffer.from(x, 'hex')); };
if (!D.setting('pin')) {
  const pw = process.env.ADMIN_PASSCODE || crypto.randomBytes(6).toString('base64url');
  D.setSetting('pin', hash(pw));
  console.log(`First run. Admin passcode: ${pw}  (change it under Riders & Settings)`);
}

/* ---------- Sessions & login throttling ---------- */
const sessions = new Map(), csess = new Map(), fails = new Map();
const TLS = process.env.TLS_KEY && process.env.TLS_CERT, TRUST_PROXY = process.env.TRUST_PROXY === '1';
const secure = req => !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
const cookie = (req, n, v, age) => `${n}=${v}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const normPhone = p => String(p || '').replace(/[\s-]/g, '').replace(/^\+63/, '0');
const csid = req => /(?:^|; )csid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
const custOf = req => { const s = csess.get(csid(req)); return s && s.exp > Date.now() ? D.customer(s.cid) : null; };
const startCust = (req, res, id, code = 200) => {
  const t = crypto.randomBytes(24).toString('base64url'); csess.set(t, { cid: id, exp: Date.now() + 30 * 864e5 });
  send(res, code, { ok: true }, { 'Set-Cookie': cookie(req, 'csid', t, 2592000) });
};
const guard = (key, pass) => {   // 5 wrong tries locks the caller out for 15 minutes
  const f = fails.get(key) || { n: 0, until: 0 };
  if (f.until > Date.now()) throw httpErr(429, `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 6e4)} minute(s).`);
  if (!pass()) { if (++f.n >= 5) { f.until = Date.now() + 9e5; f.n = 0; } fails.set(key, f); return false; }
  fails.delete(key); return true;
};
const sid = req => /(?:^|; )sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
const adminTok = req => { const t = sid(req); if (t && sessions.get(t) > Date.now()) return t; sessions.delete(t); return null; };

/* ---------- Domain logic ---------- */
const pub = (o, own) => ({ riderPhoto: D.riderPhotos()[o.rider] || null, id: o.id, status: o.status, items: o.items, total: o.total, pay: o.pay, paid: o.paid, rider: o.rider, at: o.at, empty: o.empty, eIn: o.eIn, date: o.date, slot: o.slot, loan: o.loan, ret: o.ret, collected: o.collected, ...(own ? { addr: o.addr } : {}) });
const find = id => D.order(id) || (() => { throw httpErr(404, 'Order not found.'); })();
const prod = id => D.product(id) || (() => { throw httpErr(404, 'Product not found.'); })();
const eMode = o => o.items.some(i => i.sw > 0) ? (o.empty || 'home') : 'none';
const restock = (o, dir) => o.items.forEach(i => D.addStock(i.pid, dir * i.q));
const markPaid = (o, on = true) => { o.paid = on; o.paidAt = on ? (o.paidAt || new Date().toISOString()) : null; };

function setStatus(o, st) {
  if (![...STATUS, 'Cancelled'].includes(st)) throw httpErr(400, 'Unknown status.');
  if (o.status === st) return;
  if (st === 'Out for Delivery' && (!o.rider || o.rider === 'Unassigned')) throw httpErr(409, 'Assign a rider before sending this order out for delivery.');
  if (st === 'Out for Delivery' && eMode(o) === 'store' && !o.eIn) throw httpErr(409, 'Waiting for the customer’s empties at the store.');
  if (st === 'Cancelled') restock(o, 1);
  else if (o.status === 'Cancelled') restock(o, -1);
  o.status = st;
  if (o.pay === 'COD') markPaid(o, st === 'Delivered');   // cash is paid on delivery; Credit stays unpaid until the station records the payment
  D.saveOrder(o);
}

function createOrder(b, cid = null) {
  const f = {}, str = (v, n) => String(v ?? '').trim().slice(0, n);
  const name = str(b.name, 80), phone = normPhone(str(b.phone, 20)), addr = str(b.addr, 200).replace(/\s+/g, ' '), ref = str(b.ref, 60);
  if (!name) f.cn = 'Enter your full name.';
  if (!/^09\d{9}$/.test(phone)) f.cp = 'Use a PH mobile number like 0917 123 4567.';
  if (!validAddr(addr)) f.ca = ADDR_MSG;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || b.date < today()) f.cd = 'Pick today or a later date.';
  if (!PAYS.includes(b.pay)) throw httpErr(400, 'Choose a payment method.');
  if (!['COD', 'Credit'].includes(b.pay) && ref.length < 6) f.cref = 'Enter the reference number from your payment receipt.';
  if (Object.keys(f).length) throw httpErr(400, 'Please fix the highlighted fields.', f);
  if (!['COD', 'Credit'].includes(b.pay) && !D.pay()[b.pay]) throw httpErr(400, `${b.pay} isn’t available right now. Please choose another payment method.`);
  if (!SLOTS.includes(b.slot)) throw httpErr(400, 'Choose a delivery time slot.');
  if (b.pay === 'Credit' && !cid) throw httpErr(400, 'Sign in to use Pay Later (charged to your account).');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) throw httpErr(400, 'Your basket is empty.');
  const need = {};
  const items = b.items.map(i => {   // prices always come from the catalog, never from the client
    const p = D.product(i.pid);
    if (!p || !Number.isInteger(i.q) || i.q < 1 || i.q > (p.cat === 'custom' ? 200 : 50)) throw httpErr(400, 'An item in your basket is no longer available.');
    if (p.types.length && !p.types.includes(i.w)) throw httpErr(400, `Choose a valid water type for ${p.t}.`);
    need[p.id] = (need[p.id] || 0) + i.q;
    return { pid: p.id, t: p.t, w: p.types.length ? i.w : 'Standard', q: i.q, u: p.price, sw: i.swap ? p.swap : 0, cat: p.cat, lend: p.cat === 'refill' && p.swap > 0 && !i.swap };
  });
  const loan = items.reduce((s, i) => s + (i.lend ? i.q : 0), 0);   // no empty handed in = the station lends the container
  items.forEach(i => delete i.lend);
  for (const [id, n] of Object.entries(need)) { const p = prod(id); if (p.stock < n) throw httpErr(409, `Only ${p.stock} left of ${p.t}. Please reduce the quantity.`); }
  const sub = items.reduce((s, i) => s + i.u * i.q, 0), dis = items.reduce((s, i) => s + i.sw * i.q, 0);
  const fee = sub - dis >= FREE_AT ? 0 : FEE;
  // optional pinned location (browser GPS); only accepted if it falls inside the Philippines
  const lat = Number(b.lat), lng = Number(b.lng), pinned = b.lat != null && b.lng != null && inPH(lat, lng);
  let id; do id = 'AQ-' + crypto.randomInt(100000, 1000000); while (D.order(id));
  const o = { id, name, phone, addr, date: b.date, slot: b.slot, pay: b.pay, notes: str(b.notes, 200) || 'None', items, sub, dis, fee, total: sub - dis + fee,
    status: 'Pending', rider: 'Unassigned', cid, loan, ret: 0, collected: false, paidAt: null, lat: pinned ? +lat.toFixed(6) : null, lng: pinned ? +lng.toFixed(6) : null, geoSrc: pinned ? (b.geoSrc === 'pin' ? 'pin' : 'gps') : null, at: new Date().toISOString(), paid: false, empty: items.some(i => i.sw) ? (b.empty === 'store' ? 'store' : 'home') : 'none', ref, eIn: false };
  items.forEach(i => D.addStock(i.pid, -i.q));
  D.saveOrder(o); D.addItems(o);
  if (cid) D.fillCustomerAddr(cid, addr);   // accounts created without an address learn it from their first order
  return o;
}

const OPS = {
  status: b => setStatus(find(b.id), b.status),
  rider: b => { const o = find(b.id); if (b.rider !== 'Unassigned' && !D.riders().includes(b.rider)) throw httpErr(400, 'Unknown rider.'); o.rider = b.rider; if (o.status === 'Pending' && b.rider !== 'Unassigned') o.status = 'Confirmed'; D.saveOrder(o); },
  verify: b => { const o = find(b.id); markPaid(o); if (o.status === 'Pending') o.status = 'Confirmed'; D.saveOrder(o); },
  riderPhoto: b => {   // profile picture upload (the browser resizes it to a small square first)
    const n = String(b.name || ''); if (!D.riders().includes(n)) throw httpErr(404, 'Unknown rider.');
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || '')); if (!m) throw httpErr(400, 'Use a JPG, PNG or WebP picture.');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length < 200 || buf.length > 90000) throw httpErr(400, 'That picture is too large. Try a smaller one.');
    const magic = { jpeg: buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), png: buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), webp: buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' };
    if (!magic[m[1]]) throw httpErr(400, 'That file is not a real picture.');
    const file = 'rider-' + crypto.randomBytes(6).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), old = D.riderPhotoFile(n);
    fs.writeFileSync(path.join(PHOTOS, file), buf); D.setRiderPhoto(n, file);
    if (old && old.startsWith('rider-')) fs.rm(path.join(PHOTOS, old), () => { });   // never deletes the team photos
  },
  geo: b => {   // save a delivery spot: found by address search, or placed by staff on the map
    const o = find(b.id), la = Number(b.lat), ln = Number(b.lng);
    if (!inPH(la, ln)) throw httpErr(400, 'That spot is outside the Philippines.');
    const src = ['staff', 'search', 'approx'].includes(b.src) ? b.src : 'staff';
    if (src !== 'staff' && ['gps', 'pin', 'staff'].includes(o.geoSrc)) return;   // an address search never overwrites a customer's pin or a staff correction
    o.lat = +la.toFixed(6); o.lng = +ln.toFixed(6); o.geoSrc = src; D.saveOrder(o);
  },
  stationPin: b => { const la = Number(b.lat), ln = Number(b.lng); if (!inPH(la, ln)) throw httpErr(400, 'That spot is outside the Philippines.'); D.setSetting('station_ll', `${la.toFixed(6)},${ln.toFixed(6)}`); },
  collect: b => { const o = find(b.id); if (o.status === 'Cancelled') throw httpErr(409, 'This order is cancelled.'); o.collected = true; D.saveOrder(o); },   // empties picked up at the customer's home
  receive: b => { const o = find(b.id); if (o.pay !== 'Credit') throw httpErr(400, 'Only Pay Later orders are paid at the station.'); if (o.status === 'Cancelled') throw httpErr(409, 'This order is cancelled.'); markPaid(o); D.saveOrder(o); },
  returnLoan: b => {   // a customer brings back borrowed containers; applied to their oldest open loans first
    let n = Math.floor(+b.n); if (!(n >= 1)) throw httpErr(400, 'Enter how many containers came back.');
    const ph = normPhone(b.phone), open = D.orders().filter(o => normPhone(o.phone) === ph && o.status === 'Delivered' && o.loan > o.ret).sort((x, y) => x.at < y.at ? -1 : 1);
    const out = open.reduce((s, o) => s + o.loan - o.ret, 0); if (!out) throw httpErr(409, 'This customer has no containers on loan.'); if (n > out) throw httpErr(400, `Only ${out} container(s) are on loan.`);
    for (const o of open) { if (!n) break; const t = Math.min(n, o.loan - o.ret); o.ret += t; n -= t; D.saveOrder(o); }
  },
  autoAssign: () => {   // keep each area (barangay + city) with one rider to cut route overlap, but never let one rider carry far more than the others
    const rs = D.riders(); if (!rs.length) throw httpErr(400, 'Add a rider first (Riders & Settings).');
    const all = D.orders(), OPENS = ['Pending', 'Confirmed', 'Out for Delivery'], load = Object.fromEntries(rs.map(r => [r, all.filter(o => o.rider === r && OPENS.includes(o.status)).length]));
    const todo = all.filter(o => o.rider === 'Unassigned' && ['Pending', 'Confirmed'].includes(o.status));   // includes overdue orders: they need a rider most
    const cap = Math.ceil((Object.values(load).reduce((a, b) => a + b, 0) + todo.length) / rs.length);      // fair share per rider
    const area = o => o.date + '|' + o.addr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(-2).join(',');
    const groups = {}; todo.forEach(o => (groups[area(o)] ??= []).push(o));
    for (const g of Object.values(groups).sort((a, b) => b.length - a.length)) {
      g.sort((a, b) => a.addr.localeCompare(b.addr) || a.slot.localeCompare(b.slot));   // neighbours stay together when a big area has to be split
      while (g.length) {
        const r = rs.reduce((best, x) => load[x] < load[best] ? x : best, rs[0]), room = Math.max(1, cap - load[r]);
        g.splice(0, room).forEach(o => { o.rider = r; if (o.status === 'Pending') o.status = 'Confirmed'; D.saveOrder(o); load[r]++; });
      }
    }
    return { assigned: todo.length, load };
  },
  eIn: b => { const o = find(b.id); o.eIn = true; D.saveOrder(o); },
  settle: b => D.settle(b.rider),
  restock: b => D.addStock(prod(b.id).id, Math.min(Math.max(+b.n || 0, 0), 1000)),
  saveProduct: b => {
    const cat = ['refill', 'custom', 'container', 'dispenser', 'ice'].includes(b.cat) ? b.cat : null, price = +b.price;
    const d = { t: String(b.t || '').trim().slice(0, 80), cat, price, types: (Array.isArray(b.types) ? b.types : []).map(s => String(s).slice(0, 30)).slice(0, 8),
      swap: cat === 'refill' ? Math.max(0, +b.swap || 0) : 0, stock: Math.max(0, Math.floor(+b.stock || 0)), d: String(b.d || '').trim().slice(0, 200) };
    if (!d.t || !cat || !(price >= 0) || price > 1e6) throw httpErr(400, 'Enter a title, a category and a valid price.');
    if (d.swap > price) throw httpErr(400, 'The swap discount can’t be more than the price.');
    if (b.id) D.saveProduct({ ...prod(b.id), ...d }); else D.saveProduct({ id: 'p' + Date.now(), e: { refill: '💧', custom: '🧪', container: '🫙', dispenser: '🧴', ice: '❄️' }[cat], ...d });
  },
  delProduct: b => { prod(b.id); D.delProduct(b.id); },
  delOrder: b => { const o = find(b.id); if (!['Cancelled', 'Delivered'].includes(o.status)) restock(o, 1); D.delOrder(o.id); },
  addRider: b => { const n = String(b.name || '').trim().slice(0, 40); if (!n) throw httpErr(400, 'Enter a rider name.'); if (D.riders().includes(n)) throw httpErr(409, 'That rider already exists.'); D.addRider(n); },
  delRider: b => D.delRider(b.name),
  setPay: b => { const s = k => String(b[k] || '').trim().slice(0, 40); D.setPay({ name: s('name') || 'AquaMega Station', GCash: s('GCash'), Maya: s('Maya') }); },
  setPin: (b, tok) => {
    if (String(b.pin || '').length < 8) throw httpErr(400, 'Passcode needs at least 8 characters.');
    D.setSetting('pin', hash(String(b.pin))); for (const k of sessions.keys()) if (k !== tok) sessions.delete(k);
  }
};

/* ---------- HTTP ---------- */
const send = (res, code, obj, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  if (!/json/.test(req.headers['content-type'] || '')) return no(httpErr(415, 'Unsupported request.'));
  let s = ''; req.on('data', c => { s += c; if (s.length > MAX_BODY) { no(httpErr(413, 'Request too large.')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { no(httpErr(400, 'Invalid request.')); } });
});

async function route(req, res, url, r) {
  if (req.method === 'GET' && r === 'state') {
    const a = adminTok(req), c = custOf(req);
    return send(res, 200, { admin: !!a, me: c && { name: c.name, phone: c.phone, addr: c.addr }, mine: c ? D.ordersOf(c.id).map(o => pub(o, true)) : [], products: D.products(), pay: D.pay(), ...(a ? { orders: D.orders(), riders: D.riders(), riderPhotos: D.riderPhotos() } : {}) });
  }
  if (req.method === 'GET' && r === 'track') {   // private: admins see any order, customers only the ones on their own account
    const a = adminTok(req), c = custOf(req);
    if (!a && !c) throw httpErr(401, 'Please sign in to look up your orders.');
    const ids = (url.searchParams.get('ids') || '').toUpperCase().split(',').slice(0, 50);
    return send(res, 200, D.ordersByIds(ids).filter(o => a || o.cid === c.id).map(o => pub(o, true)));
  }
  if (req.method !== 'POST') throw httpErr(404, 'Not found.');
  const b = await readBody(req); let m;
  if (r === 'orders') {   // every order belongs to a signed-in account, so only its owner (and the admin) can ever see it
    const c = custOf(req); if (!c) throw httpErr(401, 'Please sign in or create an account to place an order.');
    return send(res, 201, pub(D.tx(() => createOrder(b, c.id))));
  }
  if ((m = /^orders\/(AQ-\d{6})\/cancel$/.exec(r))) {
    const a = adminTok(req), c = custOf(req);
    if (!a && !c) throw httpErr(401, 'Please sign in to manage your orders.');
    const o = find(m[1]);
    if (!a && o.cid !== c.id) throw httpErr(404, 'Order not found.');   // same answer as a missing order: never confirm that someone else's exists
    if (o.status !== 'Pending') throw httpErr(409, 'This order is already confirmed. Please contact the station to cancel it.');
    D.tx(() => setStatus(o, 'Cancelled')); return send(res, 200, { ok: true });
  }
  if (r === 'login') {
    if (!guard('a' + req.socket.remoteAddress, () => same(String(b.passcode || ''), D.setting('pin')))) throw httpErr(401, 'Wrong passcode. Check it and try again.');
    const t = crypto.randomBytes(24).toString('base64url'); sessions.set(t, Date.now() + 8 * 36e5);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'sid', t, 28800) });
  }
  if (r === 'logout') { sessions.delete(sid(req)); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'sid', '', 0) }); }
  if (r === 'customer/register') {
    const name = str(b.name, 80), phone = normPhone(b.phone), pw = String(b.password || ''), f = {};
    if (!name) f.an = 'Enter your full name.';
    if (!/^09\d{9}$/.test(phone)) f.ap = 'Use a PH mobile number like 0917 123 4567.'; else if (D.customerByPhone(phone)) f.ap = 'This number already has an account. Sign in instead.';
    if (pw.length < 8) f.aw = 'Use at least 8 characters.';
    const addr = str(b.addr, 200).replace(/\s+/g, ' ');
    if (!validAddr(addr)) f.aa = ADDR_MSG;
    if (Object.keys(f).length) throw httpErr(400, 'Please fix the highlighted fields.', f);
    return startCust(req, res, D.addCustomer({ name, phone, pass: hash(pw), addr }), 201);
  }
  if (r === 'customer/login') {
    let c; if (!guard('c' + req.socket.remoteAddress, () => (c = D.customerByPhone(normPhone(b.phone))) && same(String(b.password || ''), c.pass))) throw httpErr(401, 'Wrong mobile number or password.');
    return startCust(req, res, c.id);
  }
  if (r === 'customer/logout') { csess.delete(csid(req)); return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'csid', '', 0) }); }
  if ((m = /^admin\/(\w+)$/.exec(r)) && Object.hasOwn(OPS, m[1])) {
    const t = adminTok(req); if (!t) throw httpErr(401, 'Your session expired. Please log in again.');
    const out = D.tx(() => OPS[m[1]](b, t)); return send(res, 200, { ok: true, ...(out || {}) });
  }
  throw httpErr(404, 'Not found.');
}

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/index.css': 'index.css', '/index.js': 'index.js', '/api.js': 'api.js', '/map.js': 'map.js', '/reports.js': 'reports.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PHOTOS = path.join(__dirname, 'photos'); fs.mkdirSync(PHOTOS, { recursive: true });
const inPH = (la, ln) => la >= 4 && la <= 22 && ln >= 116 && ln <= 128;   // rough Philippines bounding box
const serve = (req, res, p) => {
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (p === '/robots.txt' || p === '/sitemap.xml') {
    const host = /^[\w.-]+(:\d+)?$/.test(req.headers.host || '') ? req.headers.host : 'localhost';
    const base = (secure(req) ? 'https://' : 'http://') + host, txt = p === '/robots.txt';
    res.writeHead(200, { 'Content-Type': txt ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
    return res.end(txt ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}/</loc></url>\n</urlset>\n`);
  }
  const ph = p.match(/^\/photos\/([\w.-]+\.(?:jpe?g|png|webp))$/i);   // team and rider pictures
  if (ph) return fs.readFile(path.join(PHOTOS, ph[1]), (e, d) => e ? send(res, 404, { error: 'Not found.' }) : (res.writeHead(200, { 'Content-Type': TYPES[path.extname(ph[1]).toLowerCase()], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300' }), res.end(d)));
  const f = FILES[p]; if (!f) return send(res, 404, { error: 'Not found.' });
  fs.readFile(path.join(__dirname, f), (e, d) => {
    if (e) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()', 'Cache-Control': 'no-cache', ...(secure(req) ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://tile.openstreetmap.org https://unpkg.com; connect-src 'self' https://nominatim.openstreetmap.org https://router.project-osrm.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" });
    res.end(d);
  });
};

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await route(req, res, url, url.pathname.slice(5)); else serve(req, res, url.pathname);
  } catch (e) {
    const known = Number.isInteger(e.code);
    if (!known) console.error(e);
    send(res, known ? e.code : 500, { error: known ? e.message : 'Something went wrong on our side. Please try again.', fields: e.fields });
  }
};
const server = TLS ? require('https').createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, handler) : http.createServer(handler);
server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other server or run with PORT=<another number>.` : e);
  process.exit(1);
});
server.listen(PORT, () => console.log(`AquaMega running at ${TLS ? 'https' : 'http'}://localhost:${PORT}`));