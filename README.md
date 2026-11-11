> **Demo build.** All names, addresses and data are fictional. On the free host the database resets on every restart.

# AquaMega – Water Refilling Station System

Full-stack web app: browser UI, REST API and SQLite database. No `npm install` needed.

## Run
    node server.js          (or: npm start)
Open http://localhost:3000. On first run the terminal prints the admin passcode.
Needs Node.js 22.13 or newer. File names are lower-case (`db.js`, `package.json`) so it also runs on Linux hosts. Optional settings: `PORT`, `ADMIN_PASSCODE`, `DB_FILE`, `UTC_OFFSET` (default 8).

## Structure
| Layer    | Files                         | Job |
|----------|-------------------------------|-----|
| Frontend | `index.html`, `index.css`, `index.js`, `api.js` | Screens, forms, accessibility, calls the API |
| Backend  | `server.js`                   | REST API, validation, pricing, sessions, static files |
| Database | `db.js` → `aquamega.db`       | SQLite tables: products, orders, order_items, riders, settings |

## API (all under /api)
Public: `GET state`, `GET track?ids=`, `POST orders`, `POST orders/:id/cancel`
Customer accounts: `POST customer/register`, `POST customer/login`, `POST customer/logout` (30-day session cookie)
Admin login: `POST login`, `POST logout`
Admin (session cookie): `POST admin/<status|rider|verify|eIn|settle|restock|saveProduct|delProduct|delOrder|addRider|delRider|setPay|setPin>`

## Customer accounts
Customers register with a mobile number, password (hashed with scrypt) and a **required delivery address** (house/unit, street, barangay, city). Signed-in customers get their details prefilled at checkout and see all their orders on any device. Guests can still order and track by order number.

## HTTPS
Local (trusted certificate): install mkcert, then
    mkcert -install
    mkcert localhost
    set TLS_KEY=localhost-key.pem
    set TLS_CERT=localhost.pem
    node server.js            -> https://localhost:3000
Online: put the app behind a host or proxy that provides HTTPS (Caddy, Nginx, Cloudflare, Render, Railway) and set `TRUST_PROXY=1`.
With HTTPS on, session cookies get the `Secure` flag and the server sends an HSTS header.

## Delivery rules
- A delivery address is mandatory for every order and every account (checked in the browser and again on the server).
- An order can't go *Out for Delivery* until a rider is assigned (and, for gallon swaps dropped at the store, until the empties are received).

## Rider routes (Google Maps)
- **Navigate:** every open delivery in the Dispatch tab has a *Navigate in Google Maps* button. It opens turn-by-turn directions that start at the station and end at the customer's delivery address (no API key needed).
- **Full route:** *Open full route in Google Maps* chains up to 10 stops in delivery order (in-progress first, then by date and time slot).
- **Exact destination:** customers can tap *Pin my exact location* at checkout (browser GPS; needs HTTPS or localhost). Pinned orders show a GPS pin badge and navigate to the coordinates instead of the typed address. The typed address is still required.
- **Live route map (free, no key or card):** the Dispatch tab shows an OpenStreetMap map with the real road route, numbered stops, distance and driving time per leg, the trip total and a blue dot for the device's live position. Addresses are found with Nominatim, roads are routed with OSRM (both free public services; they need internet). Every route starts (and ends) at the station, the demo station address. To move it, edit the `STATION` line in `db.js`.
- **Accuracy:** a customer's GPS pin gives an exact blue marker. Addresses without a pin are searched by text; if only the barangay/city can be matched the marker is orange and flagged as approximate. Addresses the map can't find are listed with a Navigate button instead.
- **Stop order:** stops stay in time-slot order by default. If every stop is in the same slot the app re-orders them for the shortest trip; the checkbox under the map lets you switch this either way.

## About AquaMega
Demo team: a fictional owner, two delivery boys and two station staff appear on the customer *About us* tab. Riders can get a profile picture under Admin → Riders & Settings → *📷 Photo*.

## Statement of the problem → what the system does
| Problem | Answer in this system |
|---|---|
| 1. Low market penetration (only 3 of 5 homes served, riders canvass without a map) | **Coverage map** tab: every served household on a map with 500 m / 1 km / 2 km rings from the station and a households-by-area table, to plan canvassing. |
| 2. Asset loss and revenue leakage (containers and balances forgotten) | **Assets & Balances** tab: container loans, empties checklist, unpaid balances, COD cash still with riders, and a rider checklist. |
| 3. Inefficient route planning (hand-picked paths, overlaps, fuel, waits) | **Auto-assign** by area, road routing in the best order, and a printable **dispatch list**. |
| 4. Billing mistakes and clerical errors | Orders, receipts, payments and statements recorded automatically; **Reports** tab with a reconciliation that must balance to ₱0.00. |

## Specific objectives → where to find them
1. **Ordering portal:** 1-gallon, 4 L, 10 L, 15 L and 5-gallon refills, custom refills (per liter), ice blocks, containers and dispensers; customers choose a delivery date and time slot.
2. **Route optimization and scheduling:** Dispatch tab → *Auto-assign*, the route map, *Print dispatch list*.
3. **Asset tracking and checklist:** Assets & Balances tab.
4. **Billing and reports:** Reports tab (sales summary, payment methods, reconciliation, products, rider cash), receipts, customer statements, CSV exports.

## Map accuracy
- A customer's pin is exact. At checkout, *Pin my exact location* opens a map: GPS first, then drag the pin onto the gate or door. (Needs HTTPS or localhost.)
- Typed addresses are cleaned up (Brgy → Barangay, St → Street…), searched near the station, saved on the order, and marked **approximate** (orange) unless they matched the actual house. Matches far from the station are flagged too.
- Staff can **drag any pin** (route map or coverage map) onto the exact doorstep. It is saved for good and used by every rider's route and by Google Maps navigation.
- Drag the **S** pin to set the exact station location; every route starts there.
- Addresses the map can't find show as a red **?** pin you can drag into place.

## Container loans, billing rules
- A container is *lent* when a customer orders a refill without handing in an empty. It counts once the order is delivered and is cleared with *Mark returned*.
- **Pay later** (charged to the customer's account) is available to signed-in customers; the station records the payment later.
- Every figure in reports is added up in whole centavos, and a report is flagged if an order's saved total disagrees with its own lines.

## Usability (HCI) improvements
- **Last updated + Refresh now** on *My Orders*: shows when statuses were last checked, with a manual refresh button.
- **Copy number** button for GCash/Maya payments. If the station has not set a number, customers are told clearly instead of seeing a blank.
- **Review line** above *Confirm & Place Order* restates the delivery address, date, time slot and payment method before ordering.
- AquaBot's fallback reply now points to *About us* for anything it cannot answer.
