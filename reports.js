// AquaMega billing, ledgers and reports. Pure functions (no DOM) so the same maths runs in the browser and in tests.
(function (root) {
  'use strict';
  const cents = n => Math.round(Number(n || 0) * 100);                 // all money is added up in centavos, never floats
  const money = k => '₱' + (k / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const phoneKey = p => String(p || '').replace(/[\s-]/g, '').replace(/^\+63/, '0');
  const OPEN = ['Pending', 'Confirmed', 'Out for Delivery'];
  const mode = o => o.items.some(i => i.sw > 0) ? (o.empty || 'home') : 'none';
  const nEmpties = o => o.items.reduce((s, i) => s + (i.sw > 0 ? i.q : 0), 0);
  const gross = o => o.items.reduce((s, i) => s + cents(i.u) * i.q, 0);
  const disc = o => o.items.reduce((s, i) => s + cents(i.sw) * i.q, 0);
  const isUnpaid = o => !o.paid && o.status !== 'Cancelled';

  /* ---------- Customer ledgers: container loans, empties checklist, unpaid balances ---------- */
  function ledger(orders) {
    const cust = {};
    const C = o => cust[phoneKey(o.phone)] ??= { phone: phoneKey(o.phone), name: o.name, loaned: 0, returned: 0, out: 0, unpaid: 0, onAccount: 0, awaiting: 0, orders: [] };
    orders.forEach(o => {
      if (o.status === 'Cancelled') return;
      const c = C(o); c.name = o.name; c.orders.push(o);
      if (o.status === 'Delivered') { c.loaned += o.loan || 0; c.returned += o.ret || 0; }
      if (isUnpaid(o)) { const t = cents(o.total); c.unpaid += t; if (o.pay === 'Credit') c.onAccount += t; else c.awaiting += t; }
    });
    Object.values(cust).forEach(c => { c.out = c.loaned - c.returned; });
    const list = Object.values(cust);
    const empties = orders.filter(o => o.status !== 'Cancelled' && mode(o) !== 'none').map(o => {
      const m = mode(o), done = m === 'store' ? !!o.eIn : !!o.collected;
      return { o, mode: m, n: nEmpties(o), done };
    }).sort((a, b) => (a.done - b.done) || (a.o.at < b.o.at ? 1 : -1));
    const unpaid = orders.filter(isUnpaid).sort((a, b) => a.at < b.at ? -1 : 1);
    const cod = orders.filter(o => o.pay === 'COD' && o.status === 'Delivered' && !o.settled).reduce((s, o) => s + cents(o.total), 0);
    return {
      loans: list.filter(c => c.loaned > 0).sort((a, b) => b.out - a.out), customers: list, empties, unpaid,
      kpi: {
        containersOut: list.reduce((s, c) => s + c.out, 0),
        emptiesPending: empties.filter(e => !e.done).reduce((s, e) => s + e.n, 0),
        onAccount: list.reduce((s, c) => s + c.onAccount, 0),
        awaiting: list.reduce((s, c) => s + c.awaiting, 0),
        codWithRiders: cod
      }
    };
  }

  /* ---------- Sales & reconciliation report ---------- */
  function buildReport(orders, from, to) {
    const inR = orders.filter(o => o.date >= from && o.date <= to);
    const sales = inR.filter(o => o.status === 'Delivered');
    const r = { from, to, count: sales.length, gross: 0, disc: 0, fee: 0, net: 0, byPay: {}, byProduct: {}, byRider: {}, bad: [],
      open: { n: 0, v: 0 }, cancelled: { n: 0, v: 0 }, collected: { codSettled: 0, codRiders: 0, ewallet: 0, credit: 0 }, outstanding: { credit: 0, ewallet: 0, other: 0 } };
    inR.forEach(o => {
      if (OPEN.includes(o.status)) { r.open.n++; r.open.v += cents(o.total); }
      if (o.status === 'Cancelled') { r.cancelled.n++; r.cancelled.v += cents(o.total); }
    });
    sales.forEach(o => {
      const g = gross(o), d = disc(o), f = cents(o.fee), t = cents(o.total);
      if (g - d + f !== t) r.bad.push(o.id);                          // saved total disagrees with its own lines: flag, don't hide
      r.gross += g; r.disc += d; r.fee += f; r.net += t;
      const p = r.byPay[o.pay] ??= { n: 0, net: 0, collected: 0, outstanding: 0 }; p.n++; p.net += t;
      if (o.paid) p.collected += t; else p.outstanding += t;
      if (o.paid) {
        if (o.pay === 'COD') r.collected[o.settled ? 'codSettled' : 'codRiders'] += t;
        else if (o.pay === 'Credit') r.collected.credit += t; else r.collected.ewallet += t;
      } else if (o.pay === 'Credit') r.outstanding.credit += t; else if (o.pay === 'COD') r.outstanding.other += t; else r.outstanding.ewallet += t;
      o.items.forEach(i => { const x = r.byProduct[i.t] ??= { q: 0, gross: 0, disc: 0 }; x.q += i.q; x.gross += cents(i.u) * i.q; x.disc += cents(i.sw) * i.q; });
      const k = o.rider && o.rider !== 'Unassigned' ? o.rider : 'Unassigned', y = r.byRider[k] ??= { n: 0, cod: 0, turned: 0, toTurn: 0 };
      y.n++; if (o.pay === 'COD') { y.cod += t; if (o.settled) y.turned += t; else y.toTurn += t; }
    });
    r.collectedTotal = Object.values(r.collected).reduce((a, b) => a + b, 0);
    r.outstandingTotal = Object.values(r.outstanding).reduce((a, b) => a + b, 0);
    r.diff = r.net - (r.collectedTotal + r.outstandingTotal);          // must be exactly 0
    r.balanced = r.diff === 0 && !r.bad.length;
    return r;
  }

  /* ---------- Printable documents ---------- */
  const CSS = 'body{font:13px/1.45 system-ui,Segoe UI,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top}th{background:#eee}.r{text-align:right}.m{color:#555}.ok{color:#047857;font-weight:700}.bad{color:#be123c;font-weight:700}.box{display:inline-block;width:14px;height:14px;border:1.5px solid #111;vertical-align:middle}@media print{body{margin:10mm}}';
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  const itemsTxt = o => o.items.map(i => `${i.q}× ${h(i.t)}${i.w && i.w !== 'Standard' ? ' (' + h(i.w) + ')' : ''}${i.sw ? ' · swap' : ''}`).join('<br>');
  const payTxt = o => o.paid ? 'PAID' : o.pay === 'Credit' ? 'ON ACCOUNT (unpaid)' : o.pay === 'COD' ? 'COLLECT ' + money(cents(o.total)) + ' (COD)' : 'Awaiting ' + h(o.pay) + ' verification';

  function receiptHTML(o, station) {
    const rows = o.items.map(i => `<tr><td>${h(i.t)}${i.w && i.w !== 'Standard' ? ' (' + h(i.w) + ')' : ''}</td><td class="r">${i.q}</td><td class="r">${money(cents(i.u))}</td><td class="r">${money(cents(i.u) * i.q)}</td></tr>`).join('');
    return page('Receipt ' + o.id, `<h1>${h(station || 'AquaMega Station')}</h1><div class="m">Official order receipt</div>
      <h2>Order ${h(o.id)}</h2><div>Placed ${h(new Date(o.at).toLocaleString())} · Delivery ${h(o.date)}, ${h(o.slot)}<br>Customer: <b>${h(o.name)}</b> · ${h(o.phone)}<br>Address: ${h(o.addr)}</div>
      <table><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>${rows}
      <tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(gross(o))}</td></tr>
      <tr><td colspan="3" class="r">Swap discount</td><td class="r">-${money(disc(o))}</td></tr>
      <tr><td colspan="3" class="r">Delivery fee</td><td class="r">${cents(o.fee) ? money(cents(o.fee)) : 'FREE'}</td></tr>
      <tr><th colspan="3" class="r">TOTAL</th><th class="r">${money(cents(o.total))}</th></tr></table>
      <div>Payment: ${h(o.pay)} · <b class="${o.paid ? 'ok' : 'bad'}">${o.paid ? 'PAID' + (o.paidAt ? ' on ' + h(new Date(o.paidAt).toLocaleDateString()) : '') : 'UNPAID'}</b>${o.ref ? ' · Ref ' + h(o.ref) : ''}</div>
      ${o.loan ? `<div>Containers lent to customer: <b>${o.loan}</b> (returned: ${o.ret || 0})</div>` : ''}<p class="m">Thank you for choosing ${h(station || 'AquaMega Station')}.</p>`);
  }

  function statementHTML(c, station) {
    const rows = c.orders.filter(isUnpaid).map(o => `<tr><td>${h(o.id)}</td><td>${h(o.date)}</td><td>${itemsTxt(o)}</td><td>${h(o.pay)}</td><td class="r">${money(cents(o.total))}</td></tr>`).join('');
    return page('Statement ' + c.name, `<h1>${h(station || 'AquaMega Station')}</h1><div class="m">Statement of account · printed ${h(new Date().toLocaleString())}</div>
      <h2>${h(c.name)} · ${h(c.phone)}</h2>
      <table><tr><th>Order</th><th>Date</th><th>Items</th><th>Payment</th><th class="r">Amount</th></tr>${rows || '<tr><td colspan="5">No unpaid orders.</td></tr>'}
      <tr><th colspan="4" class="r">Total unpaid</th><th class="r">${money(c.unpaid)}</th></tr></table>
      <div>Containers currently on loan: <b>${c.out}</b> (borrowed ${c.loaned}, returned ${c.returned})</div>`);
  }

  function reportBody(rep) {
    const row = (a, b, cls = '') => `<tr><td>${a}</td><td class="r ${cls}">${b}</td></tr>`;
    const pay = Object.entries(rep.byPay).map(([k, p]) => `<tr><td>${h(k)}</td><td class="r">${p.n}</td><td class="r">${money(p.net)}</td><td class="r">${money(p.collected)}</td><td class="r">${money(p.outstanding)}</td></tr>`).join('');
    const prod = Object.entries(rep.byProduct).sort((a, b) => (b[1].gross - b[1].disc) - (a[1].gross - a[1].disc)).map(([k, x]) => `<tr><td>${h(k)}</td><td class="r">${x.q}</td><td class="r">${money(x.gross)}</td><td class="r">-${money(x.disc)}</td><td class="r">${money(x.gross - x.disc)}</td></tr>`).join('');
    const rid = Object.entries(rep.byRider).map(([k, y]) => `<tr><td>${h(k)}</td><td class="r">${y.n}</td><td class="r">${money(y.cod)}</td><td class="r">${money(y.turned)}</td><td class="r">${money(y.toTurn)}</td></tr>`).join('');
    return `      <h2>Sales summary (delivered orders)</h2><table>${row('Delivered orders', rep.count)}${row('Gross sales', money(rep.gross))}${row('Less: swap discounts', '-' + money(rep.disc))}${row('Add: delivery fees', money(rep.fee))}${row('<b>Net sales</b>', '<b>' + money(rep.net) + '</b>')}</table>
      <h2>By payment method</h2><table><tr><th>Method</th><th class="r">Orders</th><th class="r">Net sales</th><th class="r">Collected</th><th class="r">Outstanding</th></tr>${pay || '<tr><td colspan="5">No sales.</td></tr>'}</table>
      <h2>Reconciliation</h2><table>${row('Net sales', money(rep.net))}
        ${row('Cash received and turned over to the station (COD)', money(rep.collected.codSettled))}${row('Cash collected, still with riders (COD)', money(rep.collected.codRiders))}${row('GCash / Maya verified', money(rep.collected.ewallet))}${row('Pay Later payments received', money(rep.collected.credit))}
        ${row('Unpaid: charged to customer accounts', money(rep.outstanding.credit))}${row('Unpaid: GCash / Maya not yet verified', money(rep.outstanding.ewallet))}${row('Unpaid: other', money(rep.outstanding.other))}
        ${row('<b>Collected + outstanding</b>', '<b>' + money(rep.collectedTotal + rep.outstandingTotal) + '</b>')}${row('<b>Difference</b>', rep.balanced ? '<b>₱0.00 · BALANCED</b>' : '<b>' + money(rep.diff) + (rep.bad.length ? ' · check ' + rep.bad.map(h).join(', ') : '') + '</b>', rep.balanced ? 'ok' : 'bad')}</table>
      <h2>Sales by product</h2><table><tr><th>Product</th><th class="r">Qty</th><th class="r">Gross</th><th class="r">Discount</th><th class="r">Net of discount</th></tr>${prod || '<tr><td colspan="5">No sales.</td></tr>'}</table>
      <h2>Rider cash</h2><table><tr><th>Rider</th><th class="r">Deliveries</th><th class="r">COD collected</th><th class="r">Turned over</th><th class="r">Still to turn over</th></tr>${rid || '<tr><td colspan="5">No deliveries.</td></tr>'}</table>
      <div class="m">Not yet sales: ${rep.open.n} open order(s) worth ${money(rep.open.v)} · ${rep.cancelled.n} cancelled worth ${money(rep.cancelled.v)}.</div>`;
  }
  const reportHTML = (rep, station) => page('Sales report', `<h1>${h(station || 'AquaMega Station')}</h1><div class="m">Sales &amp; financial reconciliation report · ${h(rep.from)} to ${h(rep.to)} · printed ${h(new Date().toLocaleString())}</div>${reportBody(rep)}<p style="margin-top:36px">Prepared by: ____________________ &nbsp;&nbsp; Checked by: ____________________</p>`);

  function dispatchHTML(rider, stops, station, meta) {
    const rows = stops.map((o, i) => `<tr><td class="r">${i + 1}</td><td><b>${h(o.id)}</b><br>${h(o.slot)}</td><td><b>${h(o.name)}</b><br>${h(o.phone)}</td>
      <td>${h(o.addr)}${o.lat != null ? `<br><span class="m">GPS ${h(o.lat)}, ${h(o.lng)}</span>` : ''}${o.notes && o.notes !== 'None' ? `<br><i>${h(o.notes)}</i>` : ''}</td><td>${itemsTxt(o)}${mode(o) === 'home' ? `<br><b>Collect ${nEmpties(o)} empty</b>` : ''}${o.loan ? `<br><b>Lend ${o.loan} container(s)</b>` : ''}</td>
      <td>${payTxt(o)}</td><td><span class="box"></span> Delivered<br><span class="box"></span> Empties<br><span class="box"></span> Paid</td></tr>`).join('');
    return page('Dispatch list ' + rider, `<h1>${h(station || 'AquaMega Station')} · Dispatch list</h1>
      <div>Rider: <b>${h(rider)}</b> · ${h(new Date().toLocaleDateString())} · ${stops.length} stop(s)${meta ? ' · ' + h(meta) : ''}</div>
      <table><tr><th>#</th><th>Order / slot</th><th>Customer</th><th>Address</th><th>Items</th><th>Payment</th><th>Checklist</th></tr>${rows || '<tr><td colspan="7">No deliveries.</td></tr>'}</table>
      <p>Rider signature: ____________________ &nbsp;&nbsp; Cash turned over: ₱ ____________</p>`);
  }

  /* ---------- CSV ---------- */
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv = rows => rows.map(r => r.map(q).join(',')).join('\n');
  const f2 = k => (k / 100).toFixed(2);
  const transactionsCSV = orders => csv([['Order', 'Delivery date', 'Placed', 'Customer', 'Phone', 'Address', 'Items', 'Subtotal', 'Swap discount', 'Delivery fee', 'Total', 'Payment', 'Paid', 'Paid at', 'Status', 'Rider', 'Containers lent', 'Containers returned', 'Notes'],
    ...orders.map(o => [o.id, o.date, o.at, o.name, o.phone, o.addr, o.items.map(i => i.q + 'x ' + i.t).join('; '), f2(gross(o)), f2(disc(o)), f2(cents(o.fee)), f2(cents(o.total)), o.pay, o.paid ? 'Yes' : 'No', o.paidAt || '', o.status, o.rider, o.loan || 0, o.ret || 0, o.notes])]);
  const reportCSV = rep => csv([['Sales report', rep.from, rep.to], [], ['Delivered orders', rep.count], ['Gross sales', f2(rep.gross)], ['Swap discounts', f2(rep.disc)], ['Delivery fees', f2(rep.fee)], ['Net sales', f2(rep.net)], [],
    ['Collected: COD turned over', f2(rep.collected.codSettled)], ['Collected: COD with riders', f2(rep.collected.codRiders)], ['Collected: GCash/Maya', f2(rep.collected.ewallet)], ['Collected: Pay Later received', f2(rep.collected.credit)],
    ['Outstanding: customer accounts', f2(rep.outstanding.credit)], ['Outstanding: GCash/Maya unverified', f2(rep.outstanding.ewallet)], ['Outstanding: other', f2(rep.outstanding.other)], ['Difference', f2(rep.diff)], [],
    ['Product', 'Qty', 'Gross', 'Discount'], ...Object.entries(rep.byProduct).map(([k, x]) => [k, x.q, f2(x.gross), f2(x.disc)])]);

  const API = { cents, money, ledger, buildReport, receiptHTML, statementHTML, reportHTML, reportBody, dispatchHTML, transactionsCSV, reportCSV, phoneKey, isUnpaid, mode, nEmpties };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Biz = API;
})(typeof window !== 'undefined' ? window : globalThis);
