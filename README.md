# Ikeja Electric Realignment Dashboard

**IE Network Monitoring Dashboard** — a spatial command view for Ikeja Electric’s Business Unit (BU) and Undertaking (UT) realignment. Planners compare the previous franchise footprint with the realigned network using interactive maps, charts, tables, live industry feeds, and export tools.

**Live site:** [ikeja-electric-realignment-dashboard.vercel.app](https://ikeja-electric-realignment-dashboard.vercel.app)

**Repository:** [collins-geodev/ikeja-electric-realignment-dashboard](https://github.com/collins-geodev/ikeja-electric-realignment-dashboard)

---

## Highlights

| Capability | What you get |
| --- | --- |
| Franchise map | Hybrid satellite basemap with Lagos boundary, 5 BUs, UTs, MV feeders, DTs, ISS, TCN |
| Filter-driven zoom | Click charts, tables, or map features to filter and zoom (BU → UT → feeder → DT) |
| Cross-view sync | Operational Dashboard, Dashboard Summary, and Story map share the same filters |
| Live feeds | Ikeja Electric, NERC, LASERC, Nairametrics, and Google News topic feeds (5‑minute refresh) |
| Exports | Excel workbooks, CSV slices, GeoJSON / KML, PDF snapshots |

---

## Product surfaces

The app has three main surfaces (chrome navigation):

| Surface | Role |
| --- | --- |
| **Operational Dashboard** | Day-to-day analytics: KPIs, network geography, DT register, feeders, live feeds rail |
| **Dashboard Summary** | Coverage-style executive view: BU chips, insight cards, summary map, charts |
| **Story map** | Narrative briefing with franchise overview map, before/after, method, and explore CTAs |

### Operational Dashboard tabs

| Tab | Charts & tables | Purpose |
| --- | --- | --- |
| **At a glance** | BU DT stacked bars, density, before→after, UT agreement table, franchise map | Overview of workload and geography |
| **DT register** | Ownership doughnut, install position, capacity bins, reassignment bars | Transformer register analytics |
| **Feeders** | Feeders by BU, length vs DT scatter, fidelity bands, feeder ranking table | MV corridor performance |

---

## Key metrics (indicative)

Figures are loaded from `data/dashboard.json` at runtime (values update when the data package is regenerated).

| Metric | Typical value | Notes |
| --- | --- | --- |
| Business Units | 5 | Realigned from 6 previous |
| Undertakings | 38 | Realigned from 54 previous |
| Distribution transformers | ~20,789 | Public + private register |
| Mean register agreement | ~97.6% | DT points vs UT polygons |
| Feeders | ~418 | Mix of 11 kV and 33 kV |
| Injection substations (ISS) | ~65 | With 33 kV TOC loads |
| TCN stations | ~17 | Transmission interfaces |

### Chart catalogue

| Chart / widget | Type | Filter behaviour |
| --- | --- | --- |
| Workload by Business Unit | Stacked bar (public / private DTs) | Click bar → filter that BU |
| DT density | Bar (DTs / km²) | Click → BU filter |
| Before → after | Comparison block | Context only |
| UT agreement table | Sortable table | Click row → UT + BU filter (click again clears) |
| Ownership / install / capacity | Doughnut & bars | Click slice/bar → DT attribute filter |
| Feeder scatter | Scatter (km vs DT count) | Click point → feeder focus |
| Fidelity bands | Bar | Click band → feeder fidelity filter |
| Coverage / Story BU charts | Doughnut & bars | Click → shared BU focus across views |

---

## Map layers

| Layer | Default | Notes |
| --- | --- | --- |
| Hybrid satellite | On | Esri imagery + labels (progressive load) |
| Lagos boundary | On | Franchise context |
| Business Units | On | Filled polygons + labels |
| Undertakings | On | Dashed outlines |
| Feeders 11 kV / 33 kV | On | Selectable lines with attribute popups |
| Public / Private DTs | On | Canvas markers for performance |
| ISS | On | Injection substations |
| TCN stations | On | Transmission stations |
| Uploaded layers | On | Owner-only GeoJSON / KML / shapefile ZIP / CSV (see Owner-only upload) |

Use **Filter Layers** in each map title bar to toggle overlays. Default framing is the Lagos franchise overview (Ota→Epe, coast→Shagamu).

---

## Tech stack

### Frontend

| Tool | Use |
| --- | --- |
| HTML5 / CSS3 / vanilla JavaScript | App shell (`index.html`, `css/styles.css`, `js/*`) |
| [Leaflet](https://leafletjs.com/) 1.9 | Interactive maps |
| [Chart.js](https://www.chartjs.org/) 4 | Interactive analytics charts |
| Esri ArcGIS Online tiles | Hybrid satellite, light/dark canvas basemaps |
| Web Audio API | Quiet gapless ambient instrumental (`js/audio.js`) |

### Data & GIS

| Tool | Use |
| --- | --- |
| QGIS / ArcGIS Pro | Source geometry, TOC attribution, export pipeline |
| GeoJSON / JSON | Runtime data under `data/` |
| Curated `dashboard.json` | KPIs, BU/UT stats, analytics aggregates |
| `dt_register.json` | Every DT (ownership, capacity, feeder, old/new BU & UT, connection, metering, location) — rebuild with `python scripts/build_dt_register.py IE_DT_Public.kmz IE_DT_Private.kmz` |
| `feeders.geojson` | MV corridor geometries |
| `lagos_boundary.geojson` | State context |
| `map_labels.json` | BU / UT label anchors |

### Backend (Vercel serverless)

| Tool | Use |
| --- | --- |
| Node.js serverless functions | `api/feeds.js`, `api/article.js` |
| RSS / Atom + Google News RSS | Live industry pulse |
| WordPress REST / search helpers | Resolve publisher article URLs for feed opens |

### Libraries (CDN)

| Library | Use |
| --- | --- |
| SheetJS (xlsx) | Excel export |
| JSZip + shpjs + togeojson | Upload shapefile ZIP / KML |
| html2canvas + jsPDF | PDF report snapshots |

### Hosting & delivery

| Platform | Use |
| --- | --- |
| [Vercel](https://vercel.com/) | Static site + serverless APIs |
| GitHub | Source control |

---

## Repository layout

```text
.
├── index.html          # App shell (all three surfaces)
├── css/styles.css      # Theme, layout, motion
├── js/
│   ├── app.js          # Operational Dashboard, map, filters, exports
│   ├── experience.js   # Coverage, story, theme, PDF
│   ├── feeds.js        # Live feeds client
│   └── audio.js        # Ambient audio
├── api/
│   ├── feeds.js        # Aggregated live feeds API
│   └── article.js      # Article URL resolve / redirect
├── data/               # Preprocessed JSON / GeoJSON package
├── assets/             # Brand, favicon, audio
└── vercel.json         # Vercel project config
```

---

## Data source

Metrics and geometries are prepared from the Ikeja Electric realignment GIS workspace (QGIS / ArcGIS Pro TOC), including:

- BU / UT boundaries (realigned and lineage to previous structure)
- Public and private distribution transformers (DTs)
- 11 kV and 33 kV feeders
- Injection substations (ISS) and TCN assets

Preprocessed files under `data/` are loaded by the dashboard at runtime. Customer account identifiers are excluded from published layers.

---

## Local preview

Serve the folder over HTTP (the app fetches JSON and APIs; opening `index.html` as a file will not work):

```bash
npx --yes serve .
```

Open the URL printed in the terminal (typically `http://localhost:3000`).

For feed/article APIs locally, use the [Vercel CLI](https://vercel.com/docs/cli):

```bash
npx --yes vercel@latest dev
```

---

## Deploy

Production is hosted on Vercel:

**https://ikeja-electric-realignment-dashboard.vercel.app**

```bash
npx --yes vercel@latest --prod
```

Pushes to `main` can also publish when the GitHub project is linked in the Vercel dashboard.

---

## Interaction notes

- **Click again to clear** — selecting the same chart bar, table row, or map focus a second time resets the filter.
- **Live feeds** — open in a responsive in-dashboard news window with publisher preview, Reader view, Retry, and Open publisher controls. Google News destinations are resolved server-side. Publishers that require sign-in or block previews can be opened directly. Escape closes the window and returns focus to the story.
- **Reset** — clears filters across Operational Dashboard and Dashboard Summary and restores franchise map framing.
- **Theme** — launches in light mode; the theme button switches between light and dark for the current visit.
- **Mobile and tablet** — touch-sized controls, wrapping navigation, adaptive filter/chart grids, contained table scrolling, and a news window that fits the viewport.
- **StoryMap** — starts with the full franchise overview ahead of the narrative. The on-map expand/collapse icon fills the screen and restores the map card; Escape also collapses the map.

Run regression checks with `node tests/regressions.cjs` (Node.js 24). These cover RSS/Atom article URLs, Google destination responses, invalid links and dates, publisher response handling, private-address rejection, and the launch theme.

---

## Credits

Designed & Developed by **Collins Anyanwu**

Powered by the Ikeja Electric GIS Team.

## Owner-only upload

The **Upload** button is hidden for all visitors. To unlock it on a browser, open the dashboard with
`?owner` added to the address (for example `https://ikeja-electric-realignment-dashboard.vercel.app/?owner#intelligence`)
or press **Ctrl+Shift+U**, then enter the owner passcode. `/api/owner` checks the passcode against a salted
PBKDF2 hash, so the passcode itself is not stored in this repository. The browser then remembers it until
`?owner=signout` (or Ctrl+Shift+U again) locks it. To change the passcode, set `OWNER_UPLOAD_KEY_HASH` in the
Vercel project (format `pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>`).
