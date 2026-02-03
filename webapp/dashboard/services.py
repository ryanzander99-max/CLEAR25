"""
Core logic for the PM2.5 Early Warning System.
Loads Excel data, runs regression predictions, fetches live PM2.5 from PurpleAir.
"""

import json
import math
import os

import openpyxl
import requests
from django.conf import settings

DATA_DIR = settings.DATA_DIR
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")

# ---------------------------------------------------------------------------
# Alert levels & colors
# ---------------------------------------------------------------------------
ALERT_LEVELS = [
    {"name": "LOW",       "min": 0,   "max": 20,    "hex": "#A8D5A0", "text_color": "black",
     "health": "No precautions needed."},
    {"name": "MODERATE",  "min": 20,  "max": 60,    "hex": "#D2CC9A", "text_color": "black",
     "health": "Sensitive groups (children/elderly) avoid strenuous activities."},
    {"name": "HIGH",      "min": 60,  "max": 80,    "hex": "#F0BFA0", "text_color": "black",
     "health": "Everyone should reduce physical exertion. N95 or KN95 mask. Keep doors and windows closed. HVAC to recirculate. Run HEPA filter."},
    {"name": "VERY HIGH", "min": 80,  "max": 120,   "hex": "#E8988A", "text_color": "white",
     "health": "Avoid all outdoor activity. Keep hydrated."},
    {"name": "EXTREME",   "min": 120, "max": 1e9,   "hex": "#E65C50", "text_color": "white",
     "health": "Halt indoor pollution. No frying or sauteing. No vacuuming. No candles. No wood-burning stoves."},
]

CITIES = {
    "Toronto":   {"label": "Toronto",   "lat": 43.7479, "lon": -79.2741},
    "Montreal":  {"label": "Montréal",  "lat": 45.5027, "lon": -73.6639},
    "Edmonton":  {"label": "Edmonton",  "lat": 53.5482, "lon": -113.3681},
    "Vancouver": {"label": "Vancouver", "lat": 49.3686, "lon": -123.2767},
}

DEMO_DATA = {
    "Toronto": {
        "60106": 85.0, "66201": 78.0, "65701": 72.0, "61201": 90.0,
        "60302": 65.0, "65401": 55.0, "60609": 30.0, "360291007": 20.0, "61502": 18.0,
    },
    "Montreal": {
        "54801": 80.0, "52001": 75.0, "50801": 68.0, "500070012": 55.0,
        "500070014": 50.0, "500070007": 45.0, "60106": 70.0, "60302": 40.0,
    },
    "Edmonton": {
        "92801": 90.0, "90302": 75.0, "94401": 65.0, "90304": 70.0,
        "91901": 55.0, "92901": 80.0,
    },
    "Vancouver": {
        "100316": 60.0, "100313": 55.0, "102301": 85.0, "102302": 80.0,
        "100304": 50.0, "100308": 45.0,
    },
}

# ---------------------------------------------------------------------------
# Excel loading
# ---------------------------------------------------------------------------

def _find_col(headers, *candidates):
    for i, h in enumerate(headers):
        if h is None:
            continue
        hl = str(h).lower().strip()
        for c in candidates:
            if c.lower() in hl:
                return i
    return None


# Cache loaded stations so we don't re-read Excel on every request
_station_cache = {}


def load_stations(city_key):
    if city_key in _station_cache:
        return _station_cache[city_key]

    fn = os.path.join(DATA_DIR, f"{city_key}_PM25_EWS_Regression.xlsx")
    if not os.path.exists(fn):
        return []

    wb = openpyxl.load_workbook(fn, read_only=True, data_only=True)
    ws = wb["Included Stations"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if len(rows) < 3:
        return []

    headers = [str(h).strip() if h else "" for h in rows[1]]

    col_id    = _find_col(headers, "station id")
    col_city  = _find_col(headers, "city")
    col_dist  = _find_col(headers, "distance")
    col_dir   = _find_col(headers, "direction")
    col_tier  = _find_col(headers, "tier")
    col_slope = _find_col(headers, "slope")
    col_int   = _find_col(headers, "intercept")
    col_dtype = _find_col(headers, "data type")

    col_r = None
    for i, h in enumerate(headers):
        if h.strip() == "R":
            col_r = i
            break

    stations = []
    for row in rows[2:]:
        if row[col_id] is None:
            continue
        sid = str(row[col_id]).strip()
        if not sid:
            continue
        try:
            stations.append({
                "id": sid,
                "city_name": str(row[col_city] or ""),
                "distance": float(row[col_dist]) if row[col_dist] else 0,
                "direction": str(row[col_dir] or ""),
                "tier": int(str(row[col_tier]).replace("Tier", "").strip()) if row[col_tier] else 1,
                "R": float(row[col_r]) if col_r is not None and row[col_r] else 0,
                "slope": float(row[col_slope]) if row[col_slope] else 0,
                "intercept": float(row[col_int]) if row[col_int] else 0,
                "data_type": str(row[col_dtype] or "") if col_dtype is not None else "",
            })
        except (ValueError, TypeError):
            continue

    # Load lat/lon from All Stations Data sheet
    coord_map = _load_coords(city_key)
    for st in stations:
        c = coord_map.get(st["id"])
        if c:
            st["lat"] = c[0]
            st["lon"] = c[1]
        else:
            st["lat"] = None
            st["lon"] = None

    stations.sort(key=lambda s: (s["tier"], -s["distance"]))
    _station_cache[city_key] = stations
    return stations


def load_all_stations():
    """Load stations from all cities, tagging each with its target city."""
    if "_all" in _station_cache:
        return _station_cache["_all"]
    all_stations = []
    for city_key in CITIES:
        for st in load_stations(city_key):
            st_copy = dict(st)
            st_copy["target_city"] = city_key
            all_stations.append(st_copy)
    all_stations.sort(key=lambda s: (s["target_city"], s["tier"], -s["distance"]))
    _station_cache["_all"] = all_stations
    return all_stations


def get_all_demo_data():
    """Merge demo data from all cities into one dict."""
    merged = {}
    for city_data in DEMO_DATA.values():
        merged.update(city_data)
    return merged


def _load_coords(city_key):
    """Load lat/lon from 'All Stations Data' sheet. Returns {station_id: (lat, lon)}."""
    fn = os.path.join(DATA_DIR, f"{city_key}_PM25_EWS_Regression.xlsx")
    if not os.path.exists(fn):
        return {}
    wb = openpyxl.load_workbook(fn, read_only=True, data_only=True)
    ws = wb["All Stations Data"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if len(rows) < 3:
        return {}

    headers = [str(h).strip() if h else "" for h in rows[1]]
    col_id = _find_col(headers, "station id")
    col_lat = _find_col(headers, "lat")
    col_lon = _find_col(headers, "lon")

    coords = {}
    for row in rows[2:]:
        if row[col_id] is None:
            continue
        sid = str(row[col_id]).strip()
        try:
            lat = float(row[col_lat])
            lon = float(row[col_lon])
            coords[sid] = (lat, lon)
        except (ValueError, TypeError):
            continue
    return coords


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def get_alert_level(pm25):
    for lvl in reversed(ALERT_LEVELS):
        if pm25 >= lvl["min"]:
            return lvl
    return ALERT_LEVELS[0]


def lead_time_str(tier, dist):
    if tier == 1:
        if dist > 500:  return "24-48 hrs"
        if dist > 350:  return "18-36 hrs"
        return "12-24 hrs"
    if dist > 150:  return "8-18 hrs"
    return "6-12 hrs"


def evaluate(stations, readings):
    results = []
    for st in stations:
        sid = st["id"]
        if sid not in readings:
            continue
        pm = readings[sid]
        pred = st["slope"] * pm + st["intercept"]
        lvl = get_alert_level(pred)
        results.append({
            "station": st["city_name"], "id": sid,
            "dist": st["distance"], "dir": st["direction"],
            "tier": st["tier"], "R": st["R"], "pm25": pm,
            "predicted": round(pred, 1),
            "level_name": lvl["name"], "level_hex": lvl["hex"],
            "level_text_color": lvl["text_color"], "health": lvl["health"],
            "lead": lead_time_str(st["tier"], st["distance"]),
            "target_city": st.get("target_city", ""),
        })
    results.sort(key=lambda x: x["predicted"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# PurpleAir
# ---------------------------------------------------------------------------

PURPLEAIR_BASE = "https://api.purpleair.com/v1"


def load_config():
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    cfg = {}
    if os.environ.get("PURPLEAIR_API_KEY"):
        cfg["api_key"] = os.environ["PURPLEAIR_API_KEY"]
    return cfg


def _haversine(lat1, lon1, lat2, lon2):
    """Distance in km between two lat/lon points."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_latest_pm25(api_key, stations):
    """Fetch PM2.5 for stations using PurpleAir bulk bounding-box query.

    Instead of one request per station, we compute a bounding box around all
    stations, fetch every PurpleAir sensor in that area in one call, then
    match each station to the nearest sensor within 30 km.
    """
    headers = {"X-API-Key": api_key}

    # Only stations with coordinates
    with_coords = [s for s in stations if s.get("lat") and s.get("lon")]
    if not with_coords:
        return {}

    # Compute bounding box with 0.5° padding (~55 km)
    lats = [s["lat"] for s in with_coords]
    lons = [s["lon"] for s in with_coords]
    pad = 0.5
    nwlat = max(lats) + pad
    selat = min(lats) - pad
    nwlng = min(lons) - pad
    selng = max(lons) + pad

    # Fetch all PurpleAir sensors in bounding box (single request)
    try:
        resp = requests.get(
            f"{PURPLEAIR_BASE}/sensors",
            headers=headers,
            params={
                "fields": "name,latitude,longitude,pm2.5_cf_1,last_seen",
                "location_type": "0",  # outdoor only
                "max_age": 3600,       # seen in last hour
                "nwlat": nwlat,
                "nwlng": nwlng,
                "selat": selat,
                "selng": selng,
            },
            timeout=30,
        )
        if resp.status_code != 200:
            return {}
        data = resp.json()
    except requests.RequestException:
        return {}

    fields = data.get("fields", [])
    sensors = data.get("data", [])
    if not fields or not sensors:
        return {}

    # Build list of sensor dicts
    fi = {f: i for i, f in enumerate(fields)}
    pa_sensors = []
    for row in sensors:
        try:
            pm = row[fi["pm2.5_cf_1"]]
            if pm is None or pm < 0:
                continue
            pa_sensors.append({
                "lat": row[fi["latitude"]],
                "lon": row[fi["longitude"]],
                "pm25": pm,
            })
        except (KeyError, IndexError, TypeError):
            continue

    if not pa_sensors:
        return {}

    # Match each station to nearest PurpleAir sensor within 30 km
    readings = {}
    for st in with_coords:
        best_dist = 30  # km max
        best_pm = None
        for pa in pa_sensors:
            d = _haversine(st["lat"], st["lon"], pa["lat"], pa["lon"])
            if d < best_dist:
                best_dist = d
                best_pm = pa["pm25"]
        if best_pm is not None:
            readings[st["id"]] = best_pm

    return readings
