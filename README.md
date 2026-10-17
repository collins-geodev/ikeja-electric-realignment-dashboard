# IKEDC 2026 Realignment Command Dashboard

Static web dashboard for reviewing Ikeja Electric’s 2026 Business Unit (BU) and Undertaking (UT) realignment. It summarizes spatial and operational metrics so planners can compare the existing network footprint with the 2026 realignment proposal.

**Repository:** [collins-geodev/ikedc-2026-realignment-dashboard](https://github.com/collins-geodev/ikedc-2026-realignment-dashboard)

## Data source

Metrics are aggregated from the QGIS project `IKEDC_UT_BU_Realignment_2026` table of contents (TOC), including:

- BU / UT boundaries (2026 proposal and existing)
- Public and private distribution transformers (DTs)
- 11 kV and 33 kV feeders
- Injection substations (ISS) and TCN assets

Preprocessed JSON under `data/` is loaded by the dashboard at runtime.

## Views

The UI has three tabs:

| Tab | Purpose |
| --- | --- |
| **At a glance** | Map overview, BU workload charts, before→after comparison, UT agreement table |
| **DT register** | Metering, connection, capacity, ownership, and reassignment views |
| **Feeders** | Feeder length vs DT load, in-own-BU fidelity, and top-feeder rankings |

## Stack

- Static HTML / CSS / JavaScript (`index.html` at repo root)
- [Chart.js](https://www.chartjs.org/) for charts
- [Leaflet](https://leafletjs.com/) for the map
- Hosted on [Vercel](https://vercel.com/) as a static site

## Local preview

Serve the folder over HTTP (the app fetches JSON, so a local file open will not work):

```bash
npx --yes serve .
```

Open the URL printed in the terminal (typically `http://localhost:3000`).

## Deploy

The GitHub repo is connected to Vercel. Pushes to `main` publish the static site from the repository root.
