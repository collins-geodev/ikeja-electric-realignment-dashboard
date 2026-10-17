# IKEDC 2026 Realignment Command Dashboard

Static HTML analytics dashboard for Ikeja Electric’s 2026 Business Unit / Undertaking realignment.

## Source

Data is aggregated from the QGIS project `IKEDC_UT_BU_Realignment_2026` (TOC layers: BU/UT 2026 + existing, public/private DTs, 11/33 kV feeders, ISS, TCN).

## Views

1. **At a glance** — map, BU workload, before→after, UT agreement table  
2. **DT register** — metering, connection, capacity, ownership, reassignments  
3. **Feeders** — length vs DT load, in-own-BU fidelity, top feeders  

## Local preview

Serve the folder over HTTP (fetch needs a local server):

```bash
npx --yes serve .
```

Then open the printed URL.

## Deploy

Connected to GitHub and Vercel as a static site (`index.html` at root).
