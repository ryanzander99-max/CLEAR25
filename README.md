# C.L.E.A.R. — Canadian Lead-time Early Air Response

A PM2.5 wildfire smoke early warning system that uses existing air quality monitoring stations located 100–600+ km away to provide **6–48 hours of advance warning** before dangerous smoke arrives in major Canadian cities.

**Authors:** Hugo Bui & Ryan Zander — University of Toronto Schools

## Cities Covered

- Toronto
- Montreal
- Edmonton
- Vancouver

## How It Works

The system uses simple linear regression models between distant monitoring stations and target cities:

```
PM2.5_city = slope × PM2.5_station + intercept
```

When a remote station's PM2.5 reading exceeds a computed threshold, a colour-coded health alert is triggered hours before the smoke reaches the city.

### Alert Levels

| Level | PM2.5 (µg/m³) | Action |
|-------|---------------|--------|
| Low | < 20 | No precautions needed |
| Moderate | 21–60 | Sensitive groups avoid strenuous activities |
| High | 61–80 | Reduce exertion, wear N95, close windows, run HEPA |
| Very High | 81–120 | Avoid all outdoor activity |
| Extreme | > 120 | Halt indoor pollution sources |

### Station Selection Criteria

- R ≥ 0.30, P < 0.001, N ≥ 100 observations
- Tier 1: >250 km (12–48 hr lead time)
- Tier 2: 100–250 km (6–18 hr lead time)

## Validation

- **97.9% detection rate** (47/48 smoke events)
- **0% false alarm rate** (35/35 non-events)
- Study period: 2003–2023, wildfire season (May–September)
- 36M+ hourly observations from NAPS and U.S. EPA networks

## Setup

```bash
pip install django openpyxl requests
cd webapp
python manage.py runserver
```

Open http://127.0.0.1:8000/

## Configuration

Create `data/config.json` with your OpenAQ API key:

```json
{
    "api_key": "YOUR_OPENAQ_API_KEY",
    "location_mapping": {
        "STATION_ID": OPENAQ_LOCATION_ID
    }
}
```

## Features

- **Dashboard** — Real-time alert banner, station table, stats cards
- **Live Map** — Interactive Leaflet map with station markers and alert colours
- **Research** — Full research content including methodology, validation, and confusion matrix
- **Demo Mode** — Simulated wildfire scenarios for each city
- **Auto-fetch** — Live data fetched automatically on load and every 15 minutes
- **Feedback** — Contact form for user feedback

## Data Sources

- **NAPS** — National Air Pollution Surveillance Program (Environment Canada)
- **U.S. EPA AQS / AirNow** — Border station data
- **OpenAQ** — Live PM2.5 data API