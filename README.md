# LAX Mission Control — v2

A daily to-do calendar, played as a game. You are the CEO of Los Angeles World Airports.
Every day you log opens a new real LAX route — 122 days, 122 routes, from a quiet ski hop
to the busiest flights on earth — and every kept plan grows the airport: passengers,
satisfaction, economic impact, flights and jobs. Keep it up and LAX overtakes Atlanta
as the busiest airport in the world.

Runs entirely in the browser. No build step, no server, no account, no tracking.

---

## What is new in v2

| | |
| --- | --- |
| **24-hour planner** | A Google-Calendar-style day from 00.00 to 24.00. Drag blocks to move them, pull the top or bottom edge to resize, drag on empty space to draw a new block, drag unscheduled tasks in from the tray. Hours *and* minutes are editable in the task editor (± 5-minute steppers, duration chips, “Start now”). |
| **Plan revisions cost 4 points** | Plan freely, then **Push back** (or tick your first task) and the day is *in operation*. From then on every change to the plan — add, delete, rename, re-time — costs 4 points and dents reliability. A revision ledger lists every charge. |
| **Animated route maps** | New **Route Map** tab: a world map and a U.S. map drawn from TopoJSON files, with every open route arcing out of LAX, planes flying the network, a *Replay my season* animation, and a detail card for each route. |
| **Five airport indicators** | New **Performance** tab: passengers, service & satisfaction, economic impact, aircraft operations and employees — tiny on day one, world-beating only with consistent play. Every number has its formula and a chart over the season, plus a live world ranking against the real 2025 top 20. |
| **Keep Flying tab** | Optimism, comeback maths (“how many days to repair a bad one”), the pilot’s creed, and the full game briefing. |
| **Zoomable images** | Every photo, logo and the airport diagram opens full screen — fit-to-screen first so nothing is cropped, then zoom to 800% with the wheel, pinch, double-click or buttons, and pan around. |
| **Boarding passes** | Routes are now boarding passes with the airline logo, terminal photo, aircraft, distance, block time and daily flights. Each new route arrives with an animated mini-map and the indicator gains it brought. |

Your old progress carries over automatically — v2 reads the same save.

---

## Put it online with GitHub Pages

**1. Make a repository** — go to <https://github.com/new>, name it (e.g. `lax-mission-control`),
choose **Public**, click **Create repository**.

**2. Upload the files** — on the new repo page click **uploading an existing file** and drag in
**the contents of this folder** (not the folder itself). Then **Commit changes**.

Your repository must look exactly like this:

```
index.html              <-- must be at the top level
README.md
.nojekyll
assets/
  css/style.css
  js/data.js  js/sim.js  js/planner.js  js/maps.js  js/viewer.js  js/app.js
  vendor/d3.v7.9.0.min.js  vendor/topojson-client.v3.1.0.min.js
  data/airports.json
  data/world-countries-50m.json  data/world-countries-110m.json
  data/us-states-albers-10m.json
  img/  (photos, airline logos, LAX logos, airport diagram)
  audio/ (8 sound effects)
```

> `.nojekyll` starts with a dot, so some computers hide it. If it gets left behind, create it on
> GitHub: **Add file → Create new file**, name it `.nojekyll`, leave it empty, commit.
>
> If the web uploader struggles with the number of files, upload `assets` in a second commit.

**3. Turn on Pages** — **Settings → Pages**: Source **Deploy from a branch**, Branch `main`,
Folder `/ (root)`, **Save**.

**4. Open it** after a minute or two at `https://YOUR-USERNAME.github.io/lax-mission-control/`.

### Trying it on your own computer first

The maps load JSON files with `fetch()`, which browsers block for pages opened straight from
disk (`file://`). Everything else works, but to see the maps locally run a tiny server in this
folder and open the address it prints:

```
python3 -m http.server 8000      →  http://localhost:8000
```

On GitHub Pages none of this is needed.

---

## How the game works

1. **File the plan** on the Schedule tab — type tasks, drag them onto the 24-hour planner.
2. **Push back** to lock it (or tick your first task).
3. **Tick tasks off** as you go. Ticking is always free.
4. **Changing a running plan costs 4 points** per change.
5. **Log the day.** Points are scored, the indicators update, and a new route opens whatever
   the score.

### Points

| Tasks finished | Points |
| --- | --- |
| 50% or more | 4 |
| 75% or more | 8 |
| 100% | 16 |
| each revision after push back | −4 |

122 × 16 = **1,952** for a perfect season. Points set your title, from *Incoming CEO* to
*Legend of LAX*.

### The maths behind the indicators

All five are recomputed from your saved days (`assets/js/sim.js`).

* **Day quality** `q = done ÷ planned − 0.04 × revisions`, kept in 0–1. A gap between logged days counts as 0.
* **Reliability** `R ← R + 0.05 × (q − R)`, starting at 20%. A slow moving average: one bad day
  barely dents it; consistency builds it.
* **Network** — each route carries its real daily departures and seats per flight (`OPS` in
  `data.js`). Annual seats = Σ flights × 2 × 365 × seats, plus a skeleton schedule of 6 regional flights a day.
* **Passengers** `= seats × (1 + 0.3 R²) × (38% + 52% R)` — airline growth × load factor.
* **Satisfaction** `= 380 + 500 × (0.5 R + 0.3 recent-7-day quality + 0.2 streak) − 10 × recent revisions` (out of 1,000),
  with on-time %, ASQ score, security wait, NPS and bag delivery derived from it.
* **Aircraft operations** `= departures × 2 × 365 × growth × (90% + 9.5% R) + cargo & GA`.
* **Economic impact** `= passengers × ($1,050 domestic / $2,450 international) × satisfaction factor + capital program`;
  jobs, labor income and taxes use the ratios from LAWA’s economic-impact study.
* **Employees** — airlines (0.031 per operation), concessions, federal agencies, contractors and LAWA staff.

Typical season endings:

| How you play | Passengers / yr | World rank |
| --- | --- | --- |
| Day one | 0.16M | ~#2,100 |
| Every day logged, nothing done | ~37M | ~#63 |
| Every day at 67% | ~80M | #11 |
| Every day at 83% | ~95M | #2 |
| Every day at 100% | ~113M | **#1** |

**#1 is reserved** for a season with every day logged. World ranking uses ACI World’s 2025 traffic
table (real LAX removed so yours takes its place); outside the top 20 it is an estimate.

---

## Where your progress is saved

In your browser’s storage, on this device only. Nothing is uploaded. Use
**Settings → Download progress** to back up or move a season, and **Load progress** on the other device.

Started late? **Settings → Season start** moves the 122-day season to any date.

---

## Editing it yourself

* **Routes** — `ROUTES` in `assets/js/data.js` (`c` city · `r` region · `a` airport code ·
  `k` D/I · `al` airline logo file · `t` terminal · `mi` miles · `fn` flight · `b` blurb).
  Keep 122 entries. Add a matching line to `OPS` (daily flights, seats) and the airport’s
  coordinates to `assets/data/airports.json`.
* **Tasks** are stored as `{ x, d, s, e }` — `s`/`e` are minutes past midnight (0–1440), or `null`.
* **Model constants** — the `C` object at the top of `assets/js/sim.js`.
* **Colours and fonts** — CSS variables at the top of `assets/css/style.css`.

---

## Credits

A personal fan project, **not affiliated with, endorsed by, or connected to** Los Angeles World
Airports or Los Angeles International Airport. Airline names and logos belong to their owners
and appear only to identify real routes. Photographs of LAX and the airport diagram were
supplied by the site owner; the LAX fan logo is by Billy Christopher.

World traffic: ACI World, *World’s Busiest Airports* (2025 data, published July 2026).
Map data: Natural Earth via `world-atlas` and `us-atlas` (ISC). Maps drawn with D3 (ISC) and
topojson-client (ISC) — licence files are in `assets/vendor` and `assets/data`.
Airport coordinates: OurAirports via `airportsdata` (MIT).
Sound effects were generated as plain tones for this project.
Fonts: Barlow Condensed, Archivo and JetBrains Mono from Google Fonts.
