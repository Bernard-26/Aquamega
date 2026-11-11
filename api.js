// AquaMega client data layer + HCI behaviour. Loaded after index.js; talks to server.js.
async function api(path, body) {
  const r = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Please try again.'), { status: r.status, fields: j.fields });
  return j;
}
const fail = e => {
  if (e.status === 401 && authed) { authed = false; render(); }
  toast(e instanceof TypeError ? 'Can’t reach the server. Check your connection and try again.' : e.message, 'e');
};
const busy = (b, on, t) => { if (!b) return; if (on) { b.dataset.t = b.textContent; b.textContent = t; } else if (b.dataset.t) b.textContent = b.dataset.t; b.disabled = on; };
async function act(op, body, ok) {
  try { await api('admin/' + op, body || {}); await refresh(); if (ok) toast(ok, 'k'); return true; }
  catch (e) { fail(e); refresh().catch(() => { }); return false; }
}
const sure = (title, msg, label) => new Promise(res => {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h3 style="margin:0 0 6px">${esc(title)}</h3><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn alt" value="0" autofocus>Keep it</button><button class="btn bad" value="1">${esc(label)}</button></div></form>`;
  d.addEventListener('close', () => { res(d.returnValue === '1'); d.remove(); });
  document.body.appendChild(d); d.showModal();
});

/* ---------- Data sync ---------- */
let snap = '', me = null, pinLL = null, lastSync = null;
async function refresh(quiet) {
  const s = await api('state'); me = s.me || null;
  const o = s.admin ? s.orders : s.mine;   // the server only ever returns the signed-in customer's own orders (or everything, for the admin)
  lastSync = new Date(); syncBar();
  const j = JSON.stringify([s, o]); if (quiet && j === snap) return; snap = j;
  authed = s.admin; products = s.products; payNums = s.pay; riders = s.riders || []; riderPhotos = s.riderPhotos || {}; orders = o;
  cart = cart.map(c => { const p = products.find(x => x.id === c.pid); return p && { ...c, t: p.t, u: p.price, sw: c.sw > 0 ? p.swap : 0, q: Math.min(c.q, p.stock) }; }).filter(c => c && c.q > 0);
  render(); renderCart();
  if (me) [['#cn', me.name], ['#cp', me.phone], ['#ca', me.addr]].forEach(([q, v]) => { if (v && $(q) && !$(q).value) $(q).value = v; });
}
setInterval(() => {   // live status updates, without interrupting typing or open dialogs
  const a = document.activeElement;
  if (document.hidden || /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) || $('#pm').open || $('#drawer').classList.contains('open') || document.querySelector('dialog[open]')) return;
  refresh(true).catch(() => { });
}, 15000);

/* ---------- Accessibility ---------- */
function a11y() {
  document.querySelectorAll('#roles button, .pill[data-a=cat], .pill[data-a=afilter]').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on')));
  document.querySelectorAll('.sub button').forEach(b => b.setAttribute('aria-current', b.classList.contains('on') ? 'page' : 'false'));
  document.querySelectorAll('label').forEach(l => { const c = l.nextElementSibling; if (c && c.id && /^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName) && !l.htmlFor) l.htmlFor = c.id; });
  const ab = $('#acctBtn'); ab.textContent = me ? '👤 ' + me.name.split(' ')[0] : 'Sign in'; ab.classList.toggle('hide', role !== 'customer');
  ab.setAttribute('aria-label', me ? `Signed in as ${me.name}. Sign out` : 'Sign in or create an account');
  $('#cartBtn').setAttribute('aria-label', `Open basket, ${$('#cartN').textContent} items`);
}
{ const r = render, c = renderCart; render = () => { r(); a11y(); syncBar(); }; renderCart = () => { c(); a11y(); reviewLine(); }; }

/* ---------- HCI: visible data freshness + manual refresh (visibility of system status) ---------- */
function syncBar() {
  let b = $('#syncBar');
  if (role !== 'customer' || cTab !== 'track' || !me) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'syncBar'; b.className = 'row sp mu'; b.style.marginBottom = '10px'; b.setAttribute('role', 'status'); const sub = document.querySelector('#app .sub'); if (!sub) return; sub.insertAdjacentElement('afterend', b); }
  const t = lastSync ? lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '…';
  b.innerHTML = `<span>Updated ${t}. Statuses refresh automatically.</span><button class="btn alt sm" data-a="manual">↻ Refresh now</button>`;
}
A.manual = async e => {
  const b = document.querySelector('[data-a=manual]'); busy(b, true, 'Refreshing…');
  try { await refresh(); toast('Orders are up to date', 'k'); } catch (err) { fail(err); } finally { busy(document.querySelector('[data-a=manual]'), false); }
};

/* ---------- HCI: copy the payment number instead of retyping it (recognition over recall) ---------- */
A.copyPay = async () => {
  const m = $('#cm').value, n = payNums[m] || '';
  if (!n) return toast('The station has not set a ' + m + ' number yet. Please choose Cash on Delivery or contact the station.', 'e');
  try { await navigator.clipboard.writeText(n); toast(m + ' number copied: ' + n, 'k'); }
  catch { toast('Copy is not available here. The number is ' + n, 'e'); }
};

/* ---------- HCI: plain-language review line right above the Confirm button (error prevention) ---------- */
function reviewLine() {
  const r = $('#reviewLine'); if (!r || !cart.length) return;
  const a = ($('#ca')?.value || '').trim(), d = $('#cd')?.value, m = $('#cm')?.selectedOptions[0]?.text || '';
  r.textContent = `Please check: deliver to ${a || '(address not entered yet)'}${d ? ' on ' + d : ''}, ${$('#ct')?.value || ''}. Payment: ${m}.`;
}
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#checkout')) reviewLine(); });
document.addEventListener('change', e => { if (e.target.closest && e.target.closest('#checkout')) reviewLine(); });

function showErrs(er) {
  document.querySelectorAll('.err[id^="e-"]').forEach(x => x.remove());
  document.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
  const ks = Object.keys(er).filter(k => $('#' + k));
  ks.forEach(k => { const i = $('#' + k); i.setAttribute('aria-invalid', 'true'); i.setAttribute('aria-describedby', 'e-' + k); i.insertAdjacentHTML('afterend', `<div class="err" id="e-${k}">${esc(er[k])}</div>`); });
  if (ks.length) $('#' + ks[0]).focus();
  return ks.length;
}
document.addEventListener('input', e => {
  const t = e.target; if (!t.hasAttribute('aria-invalid')) return;
  t.removeAttribute('aria-invalid'); const m = $('#e-' + t.id); if (m) m.remove();
});

let lastFocus;
A.cart = () => { lastFocus = document.activeElement; renderCart(); $('#drawer').classList.add('open'); $('#drawer aside').focus(); };
A.closeCart = () => { $('#drawer').classList.remove('open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); };
$('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') A.closeCart(); });
document.addEventListener('keydown', e => {
  const open = $('#drawer').classList.contains('open');
  if (e.key === 'Escape') { if (open) A.closeCart(); else if ($('#chat').classList.contains('open')) A.chat(); }
  if (e.key === 'Tab' && open) {   // keep keyboard focus inside the basket
    const f = [...$('#drawer').querySelectorAll('button,input,select,textarea,a[href]')].filter(x => !x.disabled && x.offsetParent);
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === $('#drawer aside'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
});

/* ---------- Customer actions ---------- */
A.place = async () => {
  if (!me) { toast('Sign in or create an account to place your order.', 'e'); A.closeCart(); return authDlg('in'); }
  const f = { cn: $('#cn').value.trim(), cp: $('#cp').value.replace(/[\s-]/g, ''), ca: $('#ca').value.trim(), cd: $('#cd').value, cref: $('#cref').value.trim() };
  const pay = $('#cm').value, er = {};
  if (!f.cn) er.cn = 'Enter your full name.';
  if (!/^(09|\+639)\d{9}$/.test(f.cp)) er.cp = 'Use a PH mobile number like 0917 123 4567.';
  if (!validAddr(f.ca)) er.ca = ADDR_MSG;
  if (!f.cd || f.cd < today()) er.cd = 'Pick today or a later date.';
  if (pay !== 'COD' && pay !== 'Credit' && f.cref.length < 6) er.cref = 'Enter the reference number from your payment receipt.';
  if (showErrs(er)) return;
  const b = $('[data-a=place]'); busy(b, true, 'Placing order…');
  try {
    const o = await api('orders', { name: f.cn, phone: f.cp, addr: f.ca, date: f.cd, slot: $('#ct').value, pay, ref: f.cref, notes: $('#cx').value.trim(), empty: $('#ce').value,
      lat: pinLL?.lat, lng: pinLL?.lng, geoSrc: pinLL?.src, items: cart.map(c => ({ pid: c.pid, w: c.w, q: c.q, swap: c.sw > 0 })) });
    cart = []; pinLL = null; pcur = null; $('#pinInfo').textContent = ' Helps the rider find you. Your typed address is still required.'; ['#cn', '#cp', '#ca', '#cx', '#cref'].forEach(s => $(s).value = '');
    A.closeCart(); cTab = 'track'; tq = ''; await refresh(); toast(`Order ${o.id} placed. Track it under My Orders.`, 'k');
  } catch (e) { fail(e); if (e.fields) showErrs(e.fields); refresh().catch(() => { }); }
  finally { busy(b, false); }
};
A.trackId = async () => {
  if (!me) { toast('Sign in to look up your orders.', 'e'); return authDlg('in'); }
  const id = $('#trk').value.trim().toUpperCase();
  if (!/^AQ-\d{6}$/.test(id)) return toast('Order numbers look like AQ-123456.', 'e');
  try {
    if (!(await api('track?ids=' + id)).length) return toast('None of your orders has that number. Check it and try again.', 'e');
    tq = id; render();
  } catch (e) { fail(e); }
};
A.clearTrack = () => { tq = ''; render(); };
A.cancel = async id => {
  if (!(await sure(`Cancel order ${id}?`, 'This can’t be undone. Your items go back into stock.', 'Cancel order'))) return;
  try { await api(`orders/${id}/cancel`, {}); await refresh(); toast('Order cancelled'); } catch (e) { fail(e); refresh().catch(() => { }); }
};
A.ask = v => {
  say(v, 'u'); const m = v.match(/aq-?\s?(\d{6})/i);
  if (!m) return setTimeout(() => say(botReply(v), 'b'), 300);
  if (!me && !authed) return say('For your privacy, orders are only visible to their owner. Please sign in (top right) and open My Orders.', 'b');
  api('track?ids=AQ-' + m[1]).then(r => { const o = r[0];
    say(o ? `Order ${o.id} is "${o.status}". Total ${peso(o.total)} (${payState(o).toLowerCase()}). Rider: ${o.rider}.` : 'I can’t find that order number on your account. Please check it and try again.', 'b');
  }).catch(() => say('I can’t reach the server right now. Please try again.', 'b'));
};

/* ---------- Customer accounts ---------- */
function authDlg(mode = 'in') {
  const reg = mode === 'up', d = document.createElement('dialog');
  d.innerHTML = `<form novalidate><h3 style="margin:0 0 4px">${reg ? 'Create account' : 'Sign in'}</h3><p class="mu">${reg ? 'See every order in one place and skip retyping your details.' : 'Use the mobile number and password you registered with.'}</p>
  ${reg ? '<label>Full name</label><input id="an" autocomplete="name">' : ''}<label>Mobile number</label><input id="ap" type="tel" inputmode="tel" autocomplete="tel" placeholder="0917 123 4567">
  <label>Password${reg ? ' (min 8 characters)' : ''}</label><input id="aw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}">
  ${reg ? '<label>Delivery address *</label><textarea id="aa" rows="2" required aria-required="true" autocomplete="street-address" placeholder="House/Unit #, Street, Barangay, City"></textarea>' : ''}<p class="err" id="aerr" role="alert"></p>
  <div class="row sp"><button type="button" class="btn alt" data-x="sw">${reg ? 'I have an account' : 'Create account'}</button><span class="row"><button type="button" class="btn alt" data-x="no">Cancel</button><button class="btn">${reg ? 'Create account' : 'Sign in'}</button></span></div></form>`;
  d.addEventListener('click', e => { const x = e.target.dataset.x; if (x === 'no') d.close(); if (x === 'sw') { d.close(); authDlg(reg ? 'in' : 'up'); } });
  d.addEventListener('close', () => d.remove());
  d.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true, 'Please wait…');
    try {
      if (reg && !validAddr($('#aa').value.trim().replace(/\s+/g, ' '))) { busy(b, false); showErrs({ aa: ADDR_MSG }); return; }
      await api('customer/' + (reg ? 'register' : 'login'), { name: $('#an')?.value, phone: $('#ap').value, password: $('#aw').value, addr: $('#aa')?.value });
      d.close(); await refresh(); toast(reg ? 'Account created. Welcome!' : 'Signed in', 'k');
    } catch (err) { busy(b, false); if (err.fields) showErrs(err.fields); else $('#aerr').textContent = err instanceof TypeError ? 'Can’t reach the server. Try again.' : err.message; }
  });
  document.body.appendChild(d); a11y(); d.showModal();
}
A.acct = async () => {
  if (!me) return authDlg();
  if (await sure('Sign out?', 'You can sign back in anytime to see your orders.', 'Sign out')) { await api('customer/logout', {}).catch(() => { }); await refresh(); toast('Signed out'); }
};

/* ---------- Admin actions ---------- */
A.login = async () => {
  const b = $('[data-a=login]'), i = $('#lp'); busy(b, true, 'Checking…');
  try { await api('login', { passcode: i.value }); await refresh(); toast('Signed in', 'k'); }
  catch (e) { busy(b, false); $('#lerr').textContent = e.message; i.setAttribute('aria-invalid', 'true'); i.select(); }
};
A.logout = async () => { await api('logout', {}).catch(() => { }); authed = false; orders = []; role = 'customer'; await refresh(); };
Object.assign(A, {
  verify: id => act('verify', { id }, 'Payment verified'),
  eIn: id => act('eIn', { id }, 'Empties received'),
  rstat: v => { const [id, status] = v.split('|'); act('status', { id, status }, `Order ${id} → ${status}`); },
  settle: () => act('settle', { rider }, 'Cash turned over'),
  restock: id => act('restock', { id, n: 10 }, '+10 stock added'),
  setPay: () => act('setPay', { name: $('#payn').value, GCash: $('#payg').value, Maya: $('#paym').value }, 'Payment details saved'),
  addRider: () => { const n = $('#nr').value.trim(); if (!n) return toast('Enter a rider name.', 'e'); act('addRider', { name: n }, `${n} added`); },
  setPin: async () => { const v = $('#np').value; if (v.length < 8) return toast('Passcode needs at least 8 characters.', 'e'); if (await act('setPin', { pin: v }, 'Passcode updated')) $('#np').value = ''; },
  del: async id => { if (await sure(`Delete order ${id}?`, 'The order is removed for good. Stock is restored if it was still active.', 'Delete order')) act('delOrder', { id }, 'Order deleted'); },
  delP: async id => { if (await sure('Remove this product?', 'It disappears from the catalog and from customers’ baskets.', 'Remove product')) { cart = cart.filter(c => c.pid !== id); act('delProduct', { id }, 'Product removed'); } },
  delRider: async n => { if (await sure(`Remove ${n}?`, 'Their orders become Unassigned.', 'Remove rider')) act('delRider', { name: n }, `${n} removed`); }
});
document.addEventListener('change', e => {
  const t = e.target, c = t.dataset.c;
  if (c === 'status') act('status', { id: t.dataset.v, status: t.value }, `Order ${t.dataset.v} → ${t.value}`);
  else if (c === 'rider') act('rider', { id: t.dataset.v, rider: t.value }, `Assigned ${t.value}`);
  else if (t.id === 'rsel') { rider = t.value; render(); }
});
$('#pf').addEventListener('submit', async e => {
  e.preventDefault(); const c = $('#pc').value;
  const ok = await act('saveProduct', { id: $('#pid').value, t: $('#pt').value, cat: c, price: +$('#pp').value, d: $('#pd').value,
    types: $('#pw').value.split(',').map(s => s.trim()).filter(Boolean), swap: +$('#ps').value || 0, stock: parseInt($('#pk').value) || 0 }, 'Product saved');
  if (ok) $('#pm').close();
});

A.reload = () => location.reload();
/* ---------- Start ---------- */
refresh().catch(e => { $('#app').innerHTML = '<div class="card" role="alert"><b>We can’t load the station right now.</b><p class="mu">Check your connection, then <button class="btn sm" data-a="reload">Try again</button></p></div>'; });