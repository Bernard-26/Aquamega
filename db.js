'use strict';
// AquaMega database layer: SQLite via Node's built-in node:sqlite (no npm install needed).
const { DatabaseSync } = require('node:sqlite'), fs = require('fs'), path = require('path');
const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'aquamega.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS riders(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, t TEXT NOT NULL, cat TEXT NOT NULL, price REAL NOT NULL, swap REAL NOT NULL DEFAULT 0,
  types TEXT NOT NULL DEFAULT '[]', stock INTEGER NOT NULL DEFAULT 0, e TEXT, d TEXT);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, name TEXT, phone TEXT, addr TEXT, date TEXT, slot TEXT, pay TEXT, notes TEXT,
  sub REAL, dis REAL, fee REAL, total REAL, status TEXT, rider TEXT, at TEXT, paid INTEGER, empty TEXT, ref TEXT, eIn INTEGER, settled INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_items(oid TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, pid TEXT, t TEXT, w TEXT, q INTEGER, u REAL, sw REAL, cat TEXT);
CREATE INDEX IF NOT EXISTS ix_items ON order_items(oid);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, addr TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);`);
try { db.exec('ALTER TABLE orders ADD COLUMN cid INTEGER'); } catch { }   // links an order to a customer account
try { db.exec('ALTER TABLE orders ADD COLUMN lat REAL'); } catch { }      // pinned delivery location (optional, makes the route exact)
try { db.exec('ALTER TABLE orders ADD COLUMN lng REAL'); } catch { }
try { db.exec('ALTER TABLE orders ADD COLUMN geoSrc TEXT'); } catch { }     // where lat/lng came from: gps | pin | staff | search | approx
try { db.exec('ALTER TABLE riders ADD COLUMN photo TEXT'); } catch { }     // rider profile picture (file name inside /photos)
for (const c of ['loan INTEGER DEFAULT 0', 'ret INTEGER DEFAULT 0', 'collected INTEGER DEFAULT 0', 'paidAt TEXT'])   // container loans, empties checklist, payment record
  try { db.exec('ALTER TABLE orders ADD COLUMN ' + c); } catch { }

const get = (s, ...a) => db.prepare(s).get(...a), all = (s, ...a) => db.prepare(s).all(...a), run = (s, ...a) => db.prepare(s).run(...a);
const fix = r => ({ ...r, paid: !!r.paid, eIn: !!r.eIn, settled: !!r.settled, collected: !!r.collected, loan: r.loan || 0, ret: r.ret || 0, paidAt: r.paidAt || null });
const prodRow = r => r && { ...r, types: JSON.parse(r.types) };
const attach = rows => {
  const by = {}; if (rows.length) all(`SELECT pid,t,w,q,u,sw,cat,oid FROM order_items WHERE oid IN (${rows.map(() => '?').join()})`, ...rows.map(r => r.id)).forEach(i => (by[i.oid] ??= []).push({ pid: i.pid, t: i.t, w: i.w, q: i.q, u: i.u, sw: i.sw, cat: i.cat }));
  return rows.map(r => ({ ...fix(r), items: by[r.id] || [] }));
};
// Every delivery route starts at the station. Change this one line if the station ever moves.
const STATION = 'AquaMega Demo Station, Manila, Philippines';
const D = {
  tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  setting: k => get('SELECT v FROM settings WHERE k=?', k)?.v,
  setSetting: (k, v) => run('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v)),
  pay() { return { name: D.setting('pay_name') || 'AquaMega Station', GCash: D.setting('GCash') || '', Maya: D.setting('Maya') || '', station: STATION, stationLL: (() => { const [la, ln] = (D.setting('station_ll') || '').split(',').map(Number); return la && ln ? { lat: la, lng: ln } : null; })() }; },
  setPay(p) { D.setSetting('pay_name', p.name); D.setSetting('GCash', p.GCash); D.setSetting('Maya', p.Maya); },
  riders: () => all('SELECT name FROM riders ORDER BY rowid').map(r => r.name),
  addRider: n => run('INSERT INTO riders(name) VALUES(?)', n),
  riderPhotos: () => Object.fromEntries(all('SELECT name,photo FROM riders WHERE photo IS NOT NULL').map(r => [r.name, '/photos/' + r.photo])),
  riderPhotoFile: n => get('SELECT photo FROM riders WHERE name=?', n)?.photo || null,
  setRiderPhoto: (n, f) => run('UPDATE riders SET photo=? WHERE name=?', f, n),
  delRider(n) { run('DELETE FROM riders WHERE name=?', n); run("UPDATE orders SET rider='Unassigned' WHERE rider=?", n); },
  products: () => all('SELECT * FROM products ORDER BY rowid').map(prodRow),
  product: id => prodRow(get('SELECT * FROM products WHERE id=?', id)),
  saveProduct: p => run(`INSERT INTO products(id,t,cat,price,swap,types,stock,e,d) VALUES(:id,:t,:cat,:price,:swap,:types,:stock,:e,:d)
    ON CONFLICT(id) DO UPDATE SET t=:t,cat=:cat,price=:price,swap=:swap,types=:types,stock=:stock,d=:d`, { ...p, types: JSON.stringify(p.types), e: p.e ?? '💧', d: p.d ?? '' }),
  delProduct: id => run('DELETE FROM products WHERE id=?', id),
  addStock: (id, n) => run('UPDATE products SET stock=MAX(0,stock+?) WHERE id=?', n, id),
  customer: id => get('SELECT * FROM customers WHERE id=?', id),
  customerByPhone: p => get('SELECT * FROM customers WHERE phone=?', p),
  fillCustomerAddr: (id, a) => run("UPDATE customers SET addr=? WHERE id=? AND addr=''", a, id),
  addCustomer: c => Number(run('INSERT INTO customers(name,phone,pass,addr,created) VALUES(?,?,?,?,?)', c.name, c.phone, c.pass, c.addr, new Date().toISOString()).lastInsertRowid),
  ordersOf: cid => attach(all('SELECT * FROM orders WHERE cid=? ORDER BY at DESC', cid)),
  orders: () => attach(all('SELECT * FROM orders ORDER BY at DESC')),
  ordersByIds: ids => attach(ids.length ? all(`SELECT * FROM orders WHERE id IN (${ids.map(() => '?').join()})`, ...ids) : []),
  order: id => D.ordersByIds([id])[0],
  saveOrder({ items, ...o }) {   // upsert the order row; line items are written once, when the order is created
    run(`INSERT INTO orders(id,name,phone,addr,date,slot,pay,notes,sub,dis,fee,total,status,rider,at,paid,empty,ref,eIn,settled,cid,lat,lng,geoSrc,loan,ret,collected,paidAt)
      VALUES(:id,:name,:phone,:addr,:date,:slot,:pay,:notes,:sub,:dis,:fee,:total,:status,:rider,:at,:paid,:empty,:ref,:eIn,:settled,:cid,:lat,:lng,:geoSrc,:loan,:ret,:collected,:paidAt)
      ON CONFLICT(id) DO UPDATE SET status=:status,rider=:rider,paid=:paid,eIn=:eIn,settled=:settled,ret=:ret,collected=:collected,paidAt=:paidAt,lat=:lat,lng=:lng,geoSrc=:geoSrc`,
      { ...o, paid: +!!o.paid, eIn: +!!o.eIn, settled: +!!o.settled, ref: o.ref ?? '', cid: o.cid ?? null, lat: o.lat ?? null, lng: o.lng ?? null, geoSrc: o.geoSrc ?? null,
        loan: o.loan ?? 0, ret: o.ret ?? 0, collected: +!!o.collected, paidAt: o.paidAt ?? null });
  },
  addItems: o => o.items.forEach(i => run('INSERT INTO order_items(oid,pid,t,w,q,u,sw,cat) VALUES(?,?,?,?,?,?,?,?)', o.id, i.pid, i.t, i.w, i.q, i.u, i.sw, i.cat)),
  delOrder: id => run('DELETE FROM orders WHERE id=?', id),
  settle: rider => run("UPDATE orders SET settled=1 WHERE rider=? AND pay='COD' AND status='Delivered'", rider)
};

/* ---------- First run: import old data.json if present, else seed the catalog ---------- */
if (!D.setting('seeded')) D.tx(() => {
  const P = (id, t, cat, price, swap, types, stock, e, d) => ({ id, t, cat, price, swap, types, stock, e, d });
  let old = null; try { old = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8')); } catch { }
  const prods = old?.products || [
    P('p1', '5-Gallon Round Refill', 'refill', 50, 15, ['Purified', 'Alkaline', 'Mineral'], 120, '💧', 'Standard 5-gallon round bottle refill for top-load dispensers.'),
    P('p2', '5-Gallon Slim w/ Faucet Refill', 'refill', 55, 15, ['Purified', 'Alkaline', 'Mineral'], 85, '🚰', 'Slim space-saver container with built-in spigot.'),
    P('p3', 'New 5-Gallon Container', 'container', 280, 0, ['Purified', 'Alkaline'], 40, '🫙', 'Food-grade container, first full refill included.'),
    P('p4', 'Manual Pump Dispenser', 'dispenser', 350, 0, [], 25, '🧴', 'BPA-free manual pump stand for 5-gallon bottles.'),
    P('p5', 'Hot & Cold Water Cooler', 'dispenser', 1850, 0, [], 10, '🧊', 'Electric countertop dispenser with hot and cold taps.')];
  prods.forEach(D.saveProduct);
  if (old) {
    if (old.pin) D.setSetting('pin', old.pin);
    if (old.pay) D.setPay({ ...old.pay, name: old.pay.name === 'AquaFlow Station' ? 'AquaMega Station' : old.pay.name });
    (old.riders || []).forEach(D.addRider);
    (old.orders || []).forEach(o => { D.saveOrder(o); D.addItems(o); });
  }
  D.setSetting('seeded', '1');
});
if (!D.setting('catalog_v2')) D.tx(() => {   // 1-gallon / 4L / 10L / 15L refills, custom refills and ice blocks
  const W = ['Purified', 'Alkaline', 'Mineral'];
  [['p6', '1-Gallon Refill', 'refill', 15, 5, W, 200, '💧', 'Single 1-gallon (3.8 L) bottle refill.'],
   ['p7', '4-Liter Refill', 'refill', 20, 5, W, 150, '💧', 'Handy 4-liter container refill.'],
   ['p8', '10-Liter Refill', 'refill', 35, 10, W, 120, '🚰', '10-liter container refill for small dispensers.'],
   ['p9', '15-Liter Refill', 'refill', 45, 12, W, 100, '🚰', '15-liter container refill.'],
   ['p10', 'Custom Refill (per liter)', 'custom', 3, 0, W, 500, '🧪', 'Any amount you need. 1 unit = 1 liter. Put your container size in the order notes.'],
   ['p11', 'Ice Block', 'ice', 60, 0, [], 60, '❄️', 'Food-grade ice block for coolers and events.']]
    .forEach(([id, t, cat, price, swap, types, stock, e, d]) => {
      if (id === 'p11' && D.products().some(p => /\bice\b/i.test(p.t))) return;   // the station already sells its own ice product
      if (!D.product(id)) D.saveProduct({ id, t, cat, price, swap, types, stock, e, d });
    });
  D.products().filter(p => /\bice\b/i.test(p.t) && p.cat === 'refill').forEach(p => run("UPDATE products SET cat='ice', swap=0 WHERE id=?", p.id));
  D.setSetting('catalog_v2', '1');
});
module.exports = D;
// Rider profile pictures from the organizational chart (only fills riders that have no picture yet).
D.tx(() => D.riders().forEach(n => {
  const f = /reyes/i.test(n) ? 'angelito.jpg' : /sibayan/i.test(n) ? 'jonathan.jpg' : null;
  if (f && !D.riderPhotoFile(n)) D.setRiderPhoto(n, f);
}));
