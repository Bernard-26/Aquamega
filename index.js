// AquaMega – Water Refilling Station app logic

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const peso = n => '₱' + Number(n).toFixed(2);
const FEE = 25;
const FREE_AT = 500;
const LOW = 10;
const STATUS = ['Pending', 'Confirmed', 'Out for Delivery', 'Delivered'];
const eMode = o => o.items.some(i => i.sw > 0) ? (o.empty || 'home') : 'none';
const sc = s => 's-' + s.split(' ')[0];
const payState = o => o.paid ? 'Paid' : o.pay === 'COD' ? 'To pay' : o.pay === 'Credit' ? 'On account (unpaid)' : 'Payment being verified';
const firstOfMonth = () => today().slice(0, 8) + '01';
let rFrom = '', rTo = '';
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const ld = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch (e) {
    return d;
  }
};
const sv = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) { }
};
let payNums = {}, riders = [], authed = false, products = [], orders = [], riderPhotos = {};
const photoOf = (name, o) => (o && o.riderPhoto) || riderPhotos[name] || '';
const avatar = (name, px = 36, src = photoOf(name)) => src
  ? `<img class="av" src="${esc(src)}" alt="" width="${px}" height="${px}" style="width:${px}px;height:${px}px">`
  : `<span class="av" aria-hidden="true" style="width:${px}px;height:${px}px;line-height:${px}px;font-size:${Math.round(px / 2.2)}px">${esc((String(name).trim()[0] || '?').toUpperCase())}</span>`;
const TEAM = {   // demo data only: fictional team, no personal photos
  owner: { name: 'Demo Owner', role: 'Owner' },
  groups: [
    { title: 'Delivery', members: [{ name: 'Demo Rider One', role: 'Delivery Boy' }, { name: 'Demo Rider Two', role: 'Delivery Boy' }] },
    { title: 'Station Staff', members: [{ name: 'Demo Refiller', role: 'Refiller' }, { name: 'Demo Staff', role: 'Station Staff' }] }
  ]
};
const geoBadge = o => o.lat == null ? '' : o.geoSrc === 'approx' ? ' <span class="badge s-Pending">approx. spot</span>' : o.geoSrc === 'staff' ? ' <span class="badge s-Delivered">verified spot</span>' : o.geoSrc === 'search' ? ' <span class="badge s-Confirmed">address match</span>' : ' <span class="badge s-Delivered">GPS pin</span>';
let tq = '';   // order number the customer searched for under My Orders
let cart = [];
let role = 'customer';
let cTab = 'catalog';
let cat = 'all';
let aTab = 'orders';
let aFilter = 'All';
let aQ = '';
let rider = '';
function toast(m, t = '') {
  const d = document.createElement('div'); d.textContent = m; d.className = t;
  if (t === 'e') d.setAttribute('role', 'alert');
  $('#toast').appendChild(d); setTimeout(() => d.remove(), t === 'e' ? 7000 : 3500);
}
// A delivery address is mandatory (mirrors the server rule)
const ADDR_MSG = 'Delivery address is required: add house/unit, street, barangay and city.';
const validAddr = a => a.length >= 10 && /[A-Za-z]/.test(a) && a.trim().split(/\s+/).length >= 2;
const lines = () => {
  const sub = cart.reduce((s, i) => s + i.u * i.q, 0); const dis = cart.reduce((s, i) => s + i.sw * i.q, 0); const fee = cart.length && sub - dis < FREE_AT ? FEE : 0; return {
    sub, dis, fee, total: sub - dis + fee
  };
};
const inCart = pid => cart.filter(c => c.pid === pid).reduce((s, c) => s + c.q, 0);
/* ---------- Customer ---------- */
function vCustomer() {
  const active = orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status)).length;
  let h = `<div class="hero"><h1>Fresh, pure water at your doorstep.</h1><p>Order refills, containers and dispensers. Swap your empty gallon and save ₱15. Free delivery on orders ₱500+.</p></div>
 <div class="sub"><button class="${cTab == 'catalog' ? 'on' : ''}" data-a="ctab" data-v="catalog">Products & Refills</button><button class="${cTab == 'track' ? 'on' : ''}" data-a="ctab" data-v="track">My Orders${active ? ` (${active})` : ''}</button><button class="${cTab == 'about' ? 'on' : ''}" data-a="ctab" data-v="about">About us</button></div>`;
  if (cTab === 'about') return h + vAbout();
  if (cTab === 'catalog') {
    h += `<div class="row" style="margin-bottom:12px">${[['all', 'All'], ['refill', 'Refills'], ['custom', 'Custom refill'], ['ice', 'Ice blocks'], ['container', 'Containers'], ['dispenser', 'Dispensers']].map(([k, l]) => `<button class="pill ${cat == k ? 'on' : ''}" data-a="cat" data-v="${k}">${l}</button>`).join('')}</div><div class="grid">`;
    h += products.filter(p => cat === 'all' || p.cat === cat).map(p => {
      const left = p.stock - inCart(p.id);
      return `<div class="card"><div class="emo">${p.e}</div>
   <h3 style="margin:10px 0 2px;font-size:15px">${esc(p.t)}</h3><div class="mu">${esc(p.d)}</div>
   <div class="price" style="margin:8px 0">${peso(p.price)}</div>
   ${p.types.length ? `<select id="w-${p.id}">${p.types.map(t => `<option value="${esc(t)}">${esc(t)} water</option>`).join('')}</select>` : ''}
   ${p.swap > 0 ? `<label class="chk"><input type="checkbox" id="s-${p.id}" checked> I have an empty bottle to swap (-₱${p.swap})</label>` : ''}
   <div class="mu" style="margin:8px 0">${p.stock <= 0 ? 'Out of stock' : p.stock <= LOW ? `Only ${p.stock} left` : 'In stock'}</div>
   <button class="btn" style="width:100%" data-a="add" data-v="${p.id}" ${left <= 0 ? 'disabled' : ''}>Add to order</button></div>`;
    }).join('') + '</div>';
  } else {
    if (!me) h += `<div class="card" style="text-align:center;padding:28px"><h3 style="margin:0 0 6px">🔒 Your orders are private</h3><p class="mu" style="margin:0 0 14px">Sign in to see your orders and track them by order number.</p><button class="btn" data-a="acct">Sign in or create account</button></div>`;
    else {
      h += `<div class="row" style="margin-bottom:12px"><input id="trk" value="${esc(tq)}" placeholder="Search your orders, e.g. AQ-123456" style="max-width:300px"><button class="btn" data-a="trackId">Search</button>${tq ? '<button class="btn alt" data-a="clearTrack">Show all</button>' : ''}</div>`;
      const owed = orders.filter(o => !o.paid && o.status !== 'Cancelled' && o.pay === 'Credit').reduce((s, o) => s + Biz.cents(o.total), 0), lent = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + (o.loan || 0) - (o.ret || 0), 0);
      if (owed || lent) h += `<div class="card" style="margin-bottom:12px"><b>Your account</b><div class="mu">${owed ? `Unpaid balance (Pay Later): <b>${Biz.money(owed)}</b>` : ''}${owed && lent ? '<br>' : ''}${lent ? `Containers you still have on loan: <b>${lent}</b>` : ''}</div></div>`;
      const list = tq ? orders.filter(o => o.id === tq) : orders;
      h += list.length ? list.map(vOrderCard).join('') : '<div class="card mu">No orders yet. Place an order and it will show up here.</div>';
    }
  }
  return h;
}
function vOrderCard(o) {
  const idx = STATUS.indexOf(o.status);
  const canc = o.status === 'Cancelled';
  return `<div class="card" style="margin-bottom:12px"><div class="row sp"><div><b>Order #${esc(o.id)}</b> <span class="badge ${sc(o.status)}">${o.status}</span><div class="mu">${new Date(o.at).toLocaleString()}</div></div>
 <div style="text-align:right"><b>${peso(o.total)}</b><div class="mu">${esc(o.pay)} · ${payState(o)}</div></div></div>
 ${o.addr ? `<div class="mu" style="margin-top:6px">📍 ${esc(o.addr)}</div>` : ''}${o.date ? `<div class="mu">🕒 ${esc(o.date)} · ${esc(o.slot)}</div>` : ''}
 ${canc ? '' : `<div class="tl">${STATUS.map((s, i) => `<div class="${i <= idx ? 'd' : ''}"><i>${i < idx ? '✓' : i + 1}</i>${s}</div>`).join('')}</div>`}
 <div class="mu" style="margin-top:8px">${o.items.map(i => `${i.q}× ${esc(i.t)} (${esc(i.w)})${i.sw ? ' · swap' : ''}`).join('<br>')}<br>${o.rider === 'Unassigned' ? '🛵 ' : avatar(o.rider, 32, o.riderPhoto)}${esc(o.rider)}${o.loan ? `<br>🫙 Container on loan: ${o.loan - (o.ret || 0)} of ${o.loan} (please return it)` : ''}${eMode(o) !== 'none' ? `<br>♻️ Empties: ${eMode(o) === 'store' ? (o.eIn ? 'received at store' : 'you drop them at our store') : (o.collected ? 'collected by our rider' : 'rider collects at your home')}` : ''}</div>
 ${eMode(o) === 'store' && !o.eIn && o.status !== 'Cancelled' ? '<div class="badge s-Pending" style="margin-top:8px">⚠ Please bring your empty gallons to our store. We deliver once received.</div>' : ''}
 ${o.status === 'Pending' ? `<button class="btn bad sm" style="margin-top:8px" data-a="cancel" data-v="${o.id}">Cancel order</button>` : ''}</div>`;
}
/* ---------- Admin ---------- */
const vol = () => {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toDateString(); });
  return days.map(d => ({ l: d.slice(0, 3), v: orders.filter(o => o.status !== 'Cancelled' && new Date(o.at).toDateString() === d).reduce((s, o) => s + o.items.filter(i => i.cat !== 'dispenser').reduce((a, i) => a + i.q, 0), 0) }));
};
function vAdmin() {
  const ok = orders.filter(o => o.status !== 'Cancelled');
  const rev = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0);
  const gal = ok.reduce((s, o) => s + o.items.filter(i => i.cat === 'refill').reduce((a, i) => a + i.q, 0), 0);
  const act = orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status)).length;
  const lowN = products.filter(p => p.stock <= LOW).length;
  let h = `<div class="row sp" style="margin-bottom:12px"><h2 style="margin:0">Station Dashboard</h2><div class="row"><button class="btn alt sm" data-a="csv">Export CSV</button><button class="btn alt sm" data-a="logout">Log out</button></div></div>
 <div class="stats"><div class="card"><span class="mu">Revenue (delivered)</span><b>${peso(rev)}</b></div><div class="card"><span class="mu">Total orders</span><b>${orders.length}</b></div><div class="card"><span class="mu">Active orders</span><b>${act}</b></div><div class="card"><span class="mu">Gallons refilled</span><b>${gal}</b></div><div class="card"><span class="mu">Low stock items</span><b>${lowN}</b></div></div>
 <div class="sub">${[['orders', 'Orders'], ['dispatch', 'Dispatch'], ['coverage', 'Coverage map'], ['assets', 'Assets & Balances'], ['reports', 'Reports'], ['inventory', 'Products & Stock'], ['analytics', 'Analytics'], ['settings', 'Riders & Settings']].map(([k, l]) => `<button class="${aTab == k ? 'on' : ''}" data-a="atab" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (aTab === 'orders') {
    let f = orders.filter(o => aFilter === 'All' || o.status === aFilter);
    const q = aQ.toLowerCase();
    if (q)
      f = f.filter(o => (o.id + o.name + o.addr).toLowerCase().includes(q));
    h += `<div class="row sp" style="margin-bottom:10px"><div class="row">${['All', ...STATUS, 'Cancelled'].map(s => `<button class="pill ${aFilter == s ? 'on' : ''}" data-a="afilter" data-v="${s}">${s}</button>`).join('')}</div><input id="aq" value="${esc(aQ)}" placeholder="Search order, customer…" style="max-width:240px"></div>
  <div class="scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Amount</th><th>Rider</th><th>Status</th><th></th></tr></thead><tbody>${f.length ? f.map(o => `<tr><td><b>${esc(o.id)}</b></td><td><b>${esc(o.name)}</b><div class="mu">📍 ${esc(o.addr)}<br>📞 ${esc(o.phone)}<br>🕒 ${esc(o.date)} · ${esc(o.slot)}</div></td>
  <td>${o.items.map(i => `${i.q}× ${esc(i.t)} (${esc(i.w)})`).join('<br>')}${eMode(o) === 'none' ? '' : `<div class="mu">♻️ ${eMode(o) === 'store' ? (o.eIn ? 'Empties received' : 'Customer drops empties at store <button class="btn sm" data-a="eIn" data-v="' + o.id + '">Mark received</button>') : 'Rider collects at home'}</div>`}</td><td><b>${peso(o.total)}</b><div class="mu">${esc(o.pay)} · ${o.paid ? 'Paid' : 'Unpaid'}</div>${!o.paid && o.pay === 'Credit' ? `<div class="mu">On account</div><button class="btn ok sm" data-a="receive" data-v="${o.id}">Record payment</button>` : !o.paid && o.pay !== 'COD' ? `<div class="mu">Ref: ${esc(o.ref || '—')}</div><button class="btn ok sm" data-a="verify" data-v="${o.id}">Verify payment</button>` : ''}</td>
  <td><select data-c="rider" data-v="${o.id}" style="min-width:110px"><option>Unassigned</option>${riders.map(r => `<option ${o.rider === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></td>
  <td><select data-c="status" data-v="${o.id}" style="min-width:130px">${[...STATUS, 'Cancelled'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
  <td><button class="btn alt sm" data-a="receipt" data-v="${o.id}">Receipt</button> <button class="btn bad sm" data-a="del" data-v="${o.id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="7" class="mu">No orders match.</td></tr>'}</tbody></table></div>`;
  } else if (aTab === 'inventory') {
    h += `<div class="row sp" style="margin-bottom:12px"><span class="mu">Stock drops automatically when orders are placed and is restored on cancellation.</span><button class="btn" data-a="addP">+ Add product</button></div><div class="grid">${products.map(p => `<div class="card"><div class="row sp"><div class="row"><span style="font-size:24px">${p.e}</span><div><b>${esc(p.t)}</b><div class="mu">${p.cat}</div></div></div></div>
  <div class="row sp" style="margin:10px 0"><span>${peso(p.price)}</span><span class="badge ${p.stock <= LOW ? 'low' : ''}">${p.stock} in stock</span></div>
  <div class="mu">Types: ${p.types.length ? esc(p.types.join(', ')) : 'N/A'} · Swap: ${peso(p.swap)}</div>
  <div class="row" style="margin-top:10px"><button class="btn alt sm" data-a="restock" data-v="${p.id}">+10 stock</button><button class="btn alt sm" data-a="editP" data-v="${p.id}">Edit</button><button class="btn bad sm" data-a="delP" data-v="${p.id}">Remove</button></div></div>`).join('')}</div>`;
  } else if (aTab === 'dispatch') {
    h += vRider();
  } else if (aTab === 'coverage') {
    h += vCoverage();
  } else if (aTab === 'assets') {
    h += vAssets();
  } else if (aTab === 'reports') {
    h += vReports();
  } else if (aTab === 'settings') {
    h += vSettings();
  } else {
    const v = vol();
    const mx = Math.max(1, ...v.map(x => x.v));
    const wt = {};
    ok.forEach(o => o.items.forEach(i => {
      if (i.cat !== 'dispenser')
        wt[i.w] = (wt[i.w] || 0) + i.q;
    }));
    const tot = Object.values(wt).reduce((a, b) => a + b, 0) || 1;
    h += `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><b>Gallons ordered – last 7 days</b><div class="bars" style="margin-top:14px">${v.map(x => `<div>${x.v}<span style="height:${x.v / mx * 120}px"></span>${x.l}</div>`).join('')}</div></div>
  <div class="card dist"><b>Water type mix</b>${Object.entries(wt).map(([k, n]) => `<p>${esc(k)} – ${n} (${Math.round(n / tot * 100)}%)<s style="width:${n / tot * 100}%"></s></p>`).join('') || '<p class="mu">No data yet.</p>'}</div></div>`;
  }
  return h;
}
/* ---------- Maps (Google Maps directions, no API key needed for the links) ---------- */
const SLOTS = ['ASAP (Within 1 Hour)', 'Morning (9 AM - 12 PM)', 'Afternoon (1 PM - 5 PM)'];
const dest = o => (o.lat != null && o.lng != null && o.geoSrc !== 'approx') ? `${o.lat},${o.lng}` : `${o.addr}, Philippines`;   // a pin or verified spot beats typed text; weak guesses don't
const enc = encodeURIComponent;
const stopsFor = list => list.filter(o => ['Pending', 'Confirmed', 'Out for Delivery'].includes(o.status) && !(eMode(o) === 'store' && !o.eIn))
  .sort((a, b) => (a.status === 'Out for Delivery' ? 0 : 1) - (b.status === 'Out for Delivery' ? 0 : 1) || a.date.localeCompare(b.date) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
const from = () => payNums.station ? `&origin=${enc(payNums.station)}` : '';   // routes start at the station (falls back to the rider's live location)
const navUrl = o => `https://www.google.com/maps/dir/?api=1${from()}&destination=${enc(dest(o))}&travelmode=driving&dir_action=navigate`;
const routeUrl = stops => {
  const s = stops.slice(0, 10), last = s[s.length - 1], via = s.slice(0, -1).map(dest).join('|');
  return `https://www.google.com/maps/dir/?api=1${from()}&destination=${enc(dest(last))}${via ? '&waypoints=' + enc(via) : ''}&travelmode=driving`;
};
function vRoute(list) {
  const st = stopsFor(list);
  if (!st.length) return '';
  const more = st.length > 10 ? `<p class="mu">Google Maps takes 10 stops at a time. This route covers the first 10; do the rest after.</p>` : '';
  const map = '<div id="rmapph"></div><div id="rinfo" class="mu" style="margin-top:8px"></div>';
  return `<div class="card" style="margin-bottom:12px"><div class="row sp"><b>🗺️ Route: ${st.length} stop${st.length > 1 ? 's' : ''}, in delivery order</b><a class="btn sm" target="_blank" rel="noopener" href="${esc(routeUrl(st))}">Open full route in Google Maps</a></div>${more}${map}</div>`;
}
/* ---------- Rider ---------- */
function vRider() {
  if (!riders.length)
    return '<div class="card mu">No riders yet. Add one under Riders & Settings.</div>';
  const unas = orders.filter(o => o.rider === 'Unassigned' && ['Pending', 'Confirmed'].includes(o.status)).length;
  if (!riders.includes(rider))
    rider = riders[0];
  const mineO = orders.filter(o => o.rider === rider && o.status !== 'Cancelled');
  const open = mineO.filter(o => o.status !== 'Delivered');
  const sw = open.reduce((s, o) => s + (eMode(o) === 'home' ? o.items.filter(i => i.sw).reduce((a, i) => a + i.q, 0) : 0), 0);
  const cash = mineO.filter(o => o.pay === 'COD' && o.status === 'Delivered' && !o.settled).reduce((s, o) => s + o.total, 0);
  return `<div class="row sp" style="margin-bottom:12px"><div class="row"><button class="btn sm" data-a="autoAssign">⚡ Auto-assign ${unas} unassigned order${unas === 1 ? '' : 's'}</button><button class="btn alt sm" data-a="printDispatch">🖨 Print dispatch list</button></div></div>
 <div class="row sp" style="margin-bottom:12px"><h2 style="margin:0;display:flex;align-items:center">${avatar(rider, 52)} ${esc(rider)}</h2><select id="rsel" style="max-width:180px">${riders.map(r => `<option ${r === rider ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
 <div class="stats"><div class="card"><span class="mu">Open deliveries</span><b>${open.length}</b></div><div class="card"><span class="mu">Empties to collect</span><b>${sw}</b></div>
 <div class="card"><span class="mu">COD cash to turn over</span><b>${peso(cash)}</b>${cash > 0 ? '<button class="btn sm" data-a="settle">Mark turned over</button>' : ''}</div></div>
 ${vRoute(mineO)}<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${mineO.length ? mineO.map(o => {
    const e = o.items.filter(i => i.sw).reduce((a, i) => a + i.q, 0);
    return `<div class="card"><div class="row sp"><b>#${esc(o.id)}</b><span class="badge ${sc(o.status)}">${o.status}</span></div>
 <p style="margin:8px 0"><b>${esc(o.name)}</b><br>📞 <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a><br>📍 ${esc(o.addr)}${geoBadge(o)}<br><span class="mu">🕒 ${esc(o.date)} · ${esc(o.slot)}<br>📝 ${esc(o.notes)}</span></p>
 <div class="card" style="background:var(--soft);padding:10px">${o.items.map(i => `${i.q}× ${esc(i.t)} (${esc(i.w)})`).join('<br>')}${e && eMode(o) === 'home' ? `<br><b>♻️ Collect ${e} empty gallon(s)</b>` : ''}</div>
 ${o.loan ? `<p style="margin:0"><b>🫙 Lend ${o.loan} container(s)</b> to the customer</p>` : ''}${eMode(o) === 'home' && e && ['Out for Delivery', 'Delivered'].includes(o.status) && !o.collected ? `<button class="btn alt sm" style="margin-top:6px" data-a="collect" data-v="${o.id}">☐ Empties collected</button>` : eMode(o) === 'home' && e && o.collected ? '<p class="mu" style="margin:0">☑ Empties collected</p>' : ''}
 <div class="row sp" style="margin:10px 0"><span class="mu">Collect</span><b>${o.paid ? 'PAID' : o.pay === 'Credit' ? 'ON ACCOUNT · don’t collect' : o.pay === 'COD' ? peso(o.total) + ' (COD)' : 'Awaiting payment check'}</b></div>
 ${['Pending', 'Confirmed', 'Out for Delivery'].includes(o.status) ? `<a class="btn alt" style="width:100%;display:block;text-align:center;margin-bottom:8px;text-decoration:none" target="_blank" rel="noopener" href="${esc(navUrl(o))}">🧭 Navigate in Google Maps</a>` : ''}
 ${o.status === 'Pending' || o.status === 'Confirmed' ? `<button class="btn" style="width:100%" data-a="rstat" data-v="${o.id}|Out for Delivery" ${eMode(o) == 'store' && !o.eIn ? 'disabled' : ''}>${eMode(o) === 'store' && !o.eIn ? 'Waiting for empties at store' : 'Start delivery'}</button>` : ''}
 ${o.status === 'Out for Delivery' ? `<button class="btn ok" style="width:100%" data-a="rstat" data-v="${o.id}|Delivered">Mark delivered${o.paid ? '' : ' & cash collected'}</button>` : ''}</div>`;
  }).join('') : '<div class="card mu">No deliveries assigned.</div>'}</div>`;
}
function vLogin() { return `<div class="card" style="max-width:360px;margin:40px auto"><h2 style="margin:0 0 4px">🔒 Admin login</h2><p class="mu">Staff only. Enter the admin passcode.</p><input id="lp" type="password" aria-label="Admin passcode" placeholder="Passcode" autocomplete="current-password"><button class="btn" style="width:100%;margin-top:12px" data-a="login">Log in</button><p class="err" id="lerr" role="alert"></p></div>`; }
function vSettings() {
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><b>Riders</b><div style="margin:10px 0">${riders.map(x => `<div class="row sp" style="padding:6px 0;border-bottom:1px solid var(--bd)"><span style="display:flex;align-items:center">${avatar(x, 40)} ${esc(x)}</span><span><label class="btn alt sm" style="cursor:pointer">📷 Photo<input type="file" accept="image/jpeg,image/png,image/webp" data-rphoto="${esc(x)}" hidden></label> <button class="btn bad sm" data-a="delRider" data-v="${esc(x)}">Remove</button></span></div>`).join('') || '<span class="mu">No riders.</span>'}</div><div class="row"><input id="nr" placeholder="New rider name" style="flex:1"><button class="btn" data-a="addRider">Add</button></div></div>
<div class="card"><b>Payment accounts</b><label>Station name</label><input id="payn" value="${esc(payNums.name)}"><label>GCash number</label><input id="payg" value="${esc(payNums.GCash)}"><label>Maya number</label><input id="paym" value="${esc(payNums.Maya)}"><label>Station address (every route starts here)</label><input id="pays" value="${esc(payNums.station || '')}" readonly aria-readonly="true"><button class="btn" style="margin-top:10px" data-a="setPay">Save payment details</button><p class="mu">Customers see these at checkout and enter their payment reference. You verify each one under Orders.</p></div>
<div class="card"><b>Admin passcode</b><label>New passcode (min 8 characters)</label><input id="np" type="password"><button class="btn" style="margin-top:10px" data-a="setPin">Update passcode</button><p class="mu">The passcode is stored hashed on the server. Changing it signs out other sessions.</p></div></div>`;
}
function say(t, w) { const d = document.createElement('div'); d.className = 'm ' + w; d.textContent = t; const b = $('#chatBody'); b.appendChild(d); b.scrollTop = b.scrollHeight; }
function botReply(q) {
  q = q.toLowerCase();
  if (/owner|who owns|mata|sino ang may-ari/.test(q))
    return `AquaMega is owned by ${TEAM.owner.name}. See the whole team under “About us”.`;
  if (/team|staff|rider|delivery boy|who delivers|refiller|dishwasher/.test(q))
    return TEAM.groups.map(g => g.title + ': ' + g.members.map(m => `${m.name} (${m.role})`).join(', ')).join('\n') + '\nMeet them under “About us”.';
  if (/price|how much|cost|magkano/.test(q))
    return 'Our prices:\n' + products.map(p => `• ${p.t}: ${peso(p.price)}`).join('\n') + '\nSwapping an empty gallon saves you up to ₱15 per refill.';
  if (/swap|empty|gallon|pick ?up|bring/.test(q))
    return 'For gallon swaps, choose at checkout:\n1) Our rider collects your empties at your home during delivery, or\n2) You bring your empties to our store first, and we deliver the filled gallons after we receive them.';
  if (/pay|gcash|maya|cod|cash/.test(q))
    return 'We accept Cash on Delivery, GCash and Maya, and signed-in customers can pay later (charged to their account). For GCash/Maya, send the exact total to the number shown at checkout and enter your reference number. We confirm once we verify it.';
  if (/deliver|fee|free|time|hour/.test(q))
    return `Delivery fee is ${peso(FEE)}, free for orders of ${peso(FREE_AT)} or more after discounts. Pick ASAP (within 1 hour) or a morning/afternoon slot.`;
  if (/track|status|where/.test(q))
    return 'Open "My Orders" for live tracking, or type your order number (e.g. AQ-123456).';
  if (/cancel/.test(q))
    return 'You can cancel in My Orders while the order is still Pending. After it is confirmed, please contact the station.';
  if (/^(hi|hello|hey|kumusta)\b/.test(q))
    return 'Hello! I can help with prices, delivery, gallon swaps, payments and order tracking.';
  return 'Sorry, I didn\'t get that. Try asking about prices, delivery, gallon swaps, payment, or type an order number like AQ-123456. For anything else, see "About us" to reach the station team.';
}
function syncCheckout() {
  const sw = cart.some(c => c.sw > 0);
  const cm = $('#cm'), signed = typeof me !== 'undefined' && me, hasC = [...cm.options].some(x => x.value === 'Credit');
  if (signed && !hasC) cm.add(new Option('Pay later (charge to my account)', 'Credit'));
  else if (!signed && hasC) { if (cm.value === 'Credit') cm.value = 'COD'; cm.querySelector('option[value=Credit]').remove(); }
  const m = cm.value;
  $('#creditHint').classList.toggle('hide', m !== 'Credit');
  $('#emptyBox').classList.toggle('hide', !sw);
  $('#emptyHint').textContent = $('#ce').value === 'store' ? 'Drop your empties at our store first. We deliver once we receive them.' : 'Keep your empties ready at your door. The rider collects them on delivery.';
  $('#payBox').classList.toggle('hide', m === 'COD' || m === 'Credit');
  $('#payInfo').innerHTML = m === 'COD' || m === 'Credit' ? '' : !payNums[m] ? `<b>${m} isn’t available yet.</b> The station hasn’t set a ${m} number. Please choose Cash on Delivery or another payment method.` : `Send <b>${peso(lines().total)}</b> via <b>${m}</b> to <b>${esc(payNums[m] || '')}</b> (${esc(payNums.name)}). Then enter the reference number below. Your order is confirmed once we verify the payment. <button type="button" class="btn alt sm" data-a="copyPay">Copy number</button>`;
}
/* ---------- Render ---------- */
function render() {
  document.querySelectorAll('#roles button').forEach(b => b.classList.toggle('on', b.dataset.v === role));
  $('#cartBtn').classList.toggle('hide', role !== 'customer');
  $('#chatBtn').classList.toggle('hide', role !== 'customer');
  if (role !== 'customer')
    $('#chat').classList.remove('open');
  const keep = document.activeElement && document.activeElement.id;
  $('#app').innerHTML = role === 'customer' ? vCustomer() : authed ? vAdmin() : vLogin();
  if (keep === 'aq') {
    const e = $('#aq');
    if (e) {
      e.focus();
      e.setSelectionRange(e.value.length, e.value.length);
    }
  }
  $('#cartN').textContent = cart.reduce((s, i) => s + i.q, 0);
  if (typeof afterRender === 'function') afterRender();
}
function renderCart() {
  const L = lines();
  const n = cart.length;
  $('#cartList').innerHTML = n ? cart.map((c, i) => `<div class="ci"><div><b>${esc(c.t)}</b><div class="mu">${esc(c.w)}${c.sw ? ` · swap -₱${c.sw}` : ''}</div><b>${peso((c.u - c.sw) * c.q)}</b></div>
 <div class="q"><button data-a="qty" data-v="${i}|-1">−</button><b>${c.q}</b><button data-a="qty" data-v="${i}|1">+</button></div></div>`).join('') : '<p class="mu" style="text-align:center;padding:30px 0">Your basket is empty.</p>';
  $('#checkout').classList.toggle('hide', !n);
  $('#cartFt').classList.toggle('hide', !n);
  $('#tSub').textContent = peso(L.sub);
  $('#tDis').textContent = '-' + peso(L.dis);
  $('#tFee').textContent = L.fee ? peso(L.fee) : 'FREE';
  $('#tTot').textContent = peso(L.total);
  syncCheckout();
  $('#cartN').textContent = cart.reduce((s, i) => s + i.q, 0);
}
/* ---------- Actions ---------- */
const A = {
  role: v => { role = v; render(); },
  chat: () => {
    const c = $('#chat'); c.classList.toggle('open'); if (c.classList.contains('open') && !$('#chatBody').children.length)
      say('Hi! 👋 I\'m AquaBot. Ask me about prices, delivery, gallon swaps or payments, or type your order number to check its status.', 'b');
  },
  send: () => {
    const i = $('#chatIn'); const v = i.value.trim(); if (!v)
      return; i.value = ''; A.ask(v);
  },
  ctab: v => { cTab = v; render(); }, cat: v => { cat = v; render(); }, atab: v => { aTab = v; render(); }, afilter: v => { aFilter = v; render(); },
  add: id => {
    const p = products.find(x => x.id === id);
    if (!p)
      return;
    const w = $('#w-' + id)?.value || 'Standard';
    const sw = $('#s-' + id)?.checked ? p.swap : 0;
    const n = p.cat === 'custom' ? Math.min(200, Math.max(1, parseInt($('#q-' + id)?.value) || 1)) : 1;
    if (inCart(id) + n > p.stock)
      return toast('Not enough stock', 'e');
    const c = cart.find(x => x.pid === id && x.w === w && x.sw === sw);
    c ? c.q += n : cart.push({
      pid: id, t: p.t, w, u: p.price, sw, q: n, cat: p.cat
    });
    render();
    renderCart();
    toast('Added to basket', 'k');
  },
  qty: v => {
    const [i, d] = v.split('|').map(Number);
    const c = cart[i];
    if (!c)
      return;
    if (d > 0 && inCart(c.pid) >= (products.find(p => p.id === c.pid)?.stock || 0))
      return toast('No more stock available', 'e');
    c.q += d;
    if (c.q <= 0)
      cart.splice(i, 1);
    renderCart();
    render();
  },
  addP: () => { $('#pf').reset(); $('#pid').value = ''; $('#pmT').textContent = 'Add product'; $('#pm').showModal(); },
  editP: id => { const p = products.find(x => x.id === id); $('#pid').value = id; $('#pt').value = p.t; $('#pc').value = p.cat; $('#pp').value = p.price; $('#pw').value = p.types.join(', '); $('#ps').value = p.swap; $('#pk').value = p.stock; $('#pd').value = p.d; $('#pmT').textContent = 'Edit product'; $('#pm').showModal(); },
  closePm: () => $('#pm').close()
};
/* ---------- About us (organizational chart) and coverage ---------- */
const person = (m, big) => `<div class="pcard${big ? ' big' : ''}">${avatar(m.name, big ? 84 : 64, m.photo || "")}<div><b>${esc(m.name)}</b><div class="mu">${esc(m.role)}</div></div></div>`;
function vAbout() {
  const fix = [['Low market penetration', 'Only about 3 in 5 homes in the target areas are served, and riders canvass without a map or route plan.', 'The Coverage map shows every household we serve, by area and distance from the station, so riders and staff know where to canvass next.'],
    ['Asset loss and revenue leakage', 'Reusable containers stay at customers’ homes and unpaid balances get forgotten.', 'Every container loan, empty collection and unpaid balance is tracked in real time, with a checklist for riders.'],
    ['Inefficient route planning', 'Riders choose their paths by hand, causing overlaps, extra fuel and longer waits.', 'Orders are grouped by area, assigned to riders, and routed on real roads in the best order, with a printable dispatch list.'],
    ['Billing mistakes and clerical errors', 'Handwritten orders lead to wrong bills, missed payments and mismatched money.', 'Orders, receipts, payments and balances are recorded automatically, with a reconciliation report for the owner.']];
  return `<div class="card" style="margin-bottom:14px"><h2 style="margin:0 0 4px">Meet the AquaMega team</h2><p class="mu" style="margin:0 0 14px">Organizational chart</p>
    <div class="org"><div class="org-top">${person(TEAM.owner, true)}</div><div class="org-line"></div>
    <div class="org-cols">${TEAM.groups.map(g => `<div class="org-col"><div class="org-head">${esc(g.title)}</div>${g.members.map(m => person(m)).join('')}</div>`).join('')}</div></div></div>
    <div class="card"><h2 style="margin:0 0 4px">Why AquaMega went digital</h2><p class="mu" style="margin:0 0 12px">Manual workflows were slowing growth, delaying deliveries and reducing profit. This system answers the four problems the station faced:</p>
    <ol style="margin:0;padding-left:20px">${fix.map(f => `<li style="margin-bottom:12px"><b>${f[0]}.</b> <span class="mu">${f[1]}</span><br>✅ ${f[2]}</li>`).join('')}</ol></div>`;
}
function vCoverage() {
  return `<div class="card"><div class="row sp"><div><b>Coverage map</b><div class="mu">Every household we serve, with 500 m, 1 km and 2 km rings around the station. Drag any pin to fix its exact spot.</div></div></div><div id="cvph" style="margin-top:10px"></div><div id="cvinfo" class="mu" style="margin-top:10px">Loading…</div></div>`;
}
const resizePhoto = file => new Promise((ok, no) => {   // square 240px JPEG, small enough to upload
  const fr = new FileReader(); fr.onerror = () => no(new Error('Couldn’t read that picture.'));
  fr.onload = () => { const im = new Image(); im.onerror = () => no(new Error('That file is not a picture.')); im.onload = () => {
    const c = document.createElement('canvas'), n = 240, s = Math.min(im.width, im.height); c.width = c.height = n;
    c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, n, n);
    let q = .85, d = c.toDataURL('image/jpeg', q); while (d.length > 100000 && q > .4) d = c.toDataURL('image/jpeg', q -= .1); ok(d);
  }; im.src = fr.result; }; fr.readAsDataURL(file);
});
document.addEventListener('change', async e => {
  const n = e.target.dataset && e.target.dataset.rphoto; if (!n || !e.target.files[0]) return;
  try { await act('riderPhoto', { name: n, data: await resizePhoto(e.target.files[0]) }, `Photo saved for ${n}`); } catch (er) { toast(er.message, 'e'); }
  e.target.value = '';
});
/* ---------- Assets & balances, reports, printing ---------- */
const row = (...c) => `<tr>${c.map(x => `<td>${x}</td>`).join('')}</tr>`;
function vAssets() {
  const L = Biz.ledger(orders), K = L.kpi, m = Biz.money, kc = (l, v) => `<div class="card"><span class="mu">${l}</span><b>${v}</b></div>`;
  const unpaidCust = L.customers.filter(c => c.unpaid > 0).sort((a, b) => b.unpaid - a.unpaid);
  let h = `<div class="led"><div class="stats">${kc('Containers on loan', K.containersOut)}${kc('Empties waiting to be collected', K.emptiesPending)}${kc('On account (Pay Later)', m(K.onAccount))}${kc('Awaiting payment / verification', m(K.awaiting))}${kc('COD cash still with riders', m(K.codWithRiders))}</div>
  <h3>Container loans</h3><p class="mu">A container is lent when a customer orders a refill without handing in an empty. It counts once the order is delivered. Enter how many came back and tick them off.</p>
  <div class="scroll"><table><thead><tr><th>Customer</th><th>Mobile</th><th>Borrowed</th><th>Returned</th><th>On loan</th><th></th></tr></thead><tbody>${L.loans.length ? L.loans.map(c => row(`<b>${esc(c.name)}</b>`, esc(c.phone), c.loaned, c.returned, `<b>${c.out}</b>`, c.out ? `<input type="number" min="1" max="${c.out}" value="1" id="rl-${esc(c.phone)}" aria-label="Containers returned by ${esc(c.name)}"> <button class="btn sm" data-a="retLoan" data-v="${esc(c.phone)}">Mark returned</button>` : '<span class="mu">All returned ✓</span>')).join('') : '<tr><td colspan="6" class="mu">No containers have been lent yet.</td></tr>'}</tbody></table></div>
  <h3>Empties collection checklist</h3><div class="scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Collected where</th><th>Empties</th><th>Status</th><th></th></tr></thead><tbody>${L.empties.length ? L.empties.slice(0, 40).map(e => row(`<b>${esc(e.o.id)}</b>`, esc(e.o.name), e.mode === 'store' ? 'Customer brings to store' : 'Rider collects at home', e.n, e.done ? '☑ Collected' : '☐ Waiting', e.done ? '' : `<button class="btn alt sm" data-a="${e.mode === 'store' ? 'eIn' : 'collect'}" data-v="${esc(e.o.id)}">Mark collected</button>`)).join('') : '<tr><td colspan="6" class="mu">No gallon swaps yet.</td></tr>'}</tbody></table></div>
  <h3>Unpaid balances by customer</h3><div class="scroll"><table><thead><tr><th>Customer</th><th>Mobile</th><th>On account</th><th>Awaiting payment</th><th>Total unpaid</th><th></th></tr></thead><tbody>${unpaidCust.length ? unpaidCust.map(c => row(`<b>${esc(c.name)}</b>`, esc(c.phone), m(c.onAccount), m(c.awaiting), `<b>${m(c.unpaid)}</b>`, `<button class="btn alt sm" data-a="statement" data-v="${esc(c.phone)}">Print statement</button>`)).join('') : '<tr><td colspan="6" class="mu">Nothing unpaid. 🎉</td></tr>'}</tbody></table></div>
  <h3>Unpaid orders</h3><div class="scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Delivery</th><th>Method</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>${L.unpaid.length ? L.unpaid.map(o => row(`<b>${esc(o.id)}</b>`, esc(o.name), esc(o.date), esc(o.pay), esc(o.status), m(Biz.cents(o.total)), o.pay === 'Credit' ? `<button class="btn ok sm" data-a="receive" data-v="${esc(o.id)}">Record payment</button>` : o.pay === 'COD' ? '<span class="mu">Paid on delivery</span>' : `<button class="btn ok sm" data-a="verify" data-v="${esc(o.id)}">Verify payment</button>`)).join('') : '<tr><td colspan="7" class="mu">No unpaid orders.</td></tr>'}</tbody></table></div></div>`;
  return h;
}
function vReports() {
  if (!rFrom) { rFrom = firstOfMonth(); rTo = today(); }
  const rep = Biz.buildReport(orders, rFrom, rTo);
  return `<div class="rep"><div class="row sp" style="margin-bottom:8px"><div class="row"><label for="rf">From</label><input id="rf" type="date" value="${esc(rFrom)}" style="max-width:160px"><label for="rt">To</label><input id="rt" type="date" value="${esc(rTo)}" style="max-width:160px"></div>
  <div class="row"><button class="btn sm" data-a="repPrint">🖨 Print report</button><button class="btn alt sm" data-a="repCsv">Export summary CSV</button><button class="btn alt sm" data-a="txCsv">Export all transactions CSV</button></div></div>
  <p class="mu">Sales are counted when an order is <b>Delivered</b>, by its delivery date. Every figure is added up in whole centavos.</p>${Biz.reportBody(rep)}</div>`;
}
const openDoc = html => {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups for this site to print.', 'e');
  w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
};
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); };
Object.assign(A, {
  receipt: id => { const o = orders.find(x => x.id === id); if (o) openDoc(Biz.receiptHTML(o, payNums.name)); },
  statement: ph => { const c = Biz.ledger(orders).customers.find(x => x.phone === ph); if (c) openDoc(Biz.statementHTML(c, payNums.name)); },
  repPrint: () => openDoc(Biz.reportHTML(Biz.buildReport(orders, rFrom, rTo), payNums.name)),
  repCsv: () => download(`aquamega-report-${rFrom}-to-${rTo}.csv`, Biz.reportCSV(Biz.buildReport(orders, rFrom, rTo))),
  txCsv: () => download('aquamega-transactions.csv', Biz.transactionsCSV(orders)),
  csv: () => download('aquamega-orders.csv', Biz.transactionsCSV(orders)),
  printDispatch: () => {
    const r = window.lastRoute && lastRoute.rider === rider ? lastRoute : null;
    const stops = r ? r.order : stopsFor(orders.filter(o => o.rider === rider && o.status !== 'Cancelled'));
    openDoc(Biz.dispatchHTML(rider, stops, payNums.name, r ? r.meta : 'time-slot order'));
  },
  autoAssign: async () => {
    try { const r = await api('admin/autoAssign', {}); await refresh(); toast(r.assigned ? `Assigned ${r.assigned} order(s), grouped by area and balanced across riders.` : 'No unassigned orders to assign.', 'k'); }
    catch (e) { fail(e); }
  },
  collect: id => act('collect', { id }, 'Empties collected'),
  receive: id => act('receive', { id }, 'Payment recorded'),
  retLoan: ph => act('returnLoan', { phone: ph, n: parseInt($('#rl-' + ph)?.value) || 1 }, 'Containers marked returned')
});
document.addEventListener('change', e => { if (e.target.id === 'rf' || e.target.id === 'rt') { if (e.target.value) { if (e.target.id === 'rf') rFrom = e.target.value; else rTo = e.target.value; render(); } } });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (b && A[b.dataset.a])
    A[b.dataset.a](b.dataset.v);
});
document.addEventListener('input', e => {
  if (e.target.id === 'aq') {
    aQ = e.target.value;
    render();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'lp')
    A.login(); if (e.key === 'Enter' && e.target.id === 'chatIn')
    A.send();
});
document.addEventListener('change', e => {
  if (e.target.id === 'cm' || e.target.id === 'ce')
    syncCheckout();
});
$('#cd').value = today();
$('#cd').min = today();