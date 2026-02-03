/* ============================================================
   PM2.5 EWS — App Logic (All Cities Combined)
   ============================================================ */

let stations = [];
let citiesInfo = {};
let map = null;
let mapMarkers = [];
let lastResults = null;

// DOM refs
const tableBody = document.getElementById("table-body");
const statusEl = document.getElementById("status");
const btnFetch = document.getElementById("btn-fetch");
const statsRow = document.getElementById("stats-row");
const stationCount = document.getElementById("station-count");
const mapStatus = document.getElementById("map-status");
const mapBtnFetch = document.getElementById("map-btn-fetch");

// ---- Tab switching ----
document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
        document.querySelector(".tab-active").classList.remove("tab-active");
        t.classList.add("tab-active");
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("tab-visible"));
        document.getElementById("tab-" + t.dataset.tab).classList.add("tab-visible");
        if (t.dataset.tab === "map") initMap();
    });
});

// ---- Research nav ----
document.querySelectorAll(".rnav").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelector(".rnav-active").classList.remove("rnav-active");
        btn.classList.add("rnav-active");
        document.querySelectorAll(".research-section").forEach(s => s.classList.remove("research-visible"));
        document.getElementById("sec-" + btn.dataset.section).classList.add("research-visible");
    });
});

// ---- Dashboard functions ----
async function loadStations() {
    try {
        const resp = await fetch("/api/stations/");
        const data = await resp.json();
        stations = data.stations;
        citiesInfo = data.cities || {};
        stationCount.textContent = `${stations.length} stations across ${Object.keys(citiesInfo).length} cities`;
        document.getElementById("stat-total").textContent = stations.length;
        renderTable(null);
        if (map) updateMapMarkers(null);
    } catch (e) {
        statusEl.textContent = `Error loading stations: ${e}`;
    }
}

function renderTable(results) {
    const resultMap = {};
    if (results) results.forEach(r => { resultMap[r.id + (r.target_city || "")] = r; });

    let html = "";
    let currentCity = null;

    stations.forEach(st => {
        const city = st.target_city || "";
        if (city !== currentCity) {
            currentCity = city;
            html += `<div class="tier-sep" style="color:#3b82f6;font-size:13px;padding:12px 20px 6px;">${city}</div>`;
        }

        // Match by id + target_city, or just id
        const r = resultMap[st.id + city] || (results ? results.find(x => x.id === st.id && x.target_city === city) : null);
        const hasData = !!r;
        const pm = hasData ? r.pm25.toFixed(1) : "—";
        const pred = hasData ? r.predicted.toFixed(1) : "—";
        const lead = hasData ? r.lead : "";
        let badge = "";
        if (hasData) {
            badge = `<span class="badge" style="background:${r.level_hex};color:${r.level_text_color}">${r.level_name}</span>`;
        }

        html += `<div class="row${hasData ? "" : " no-data"}">
            <span class="td-city">${city}</span>
            <span class="td-station">${st.city_name}</span>
            <span class="td-dist">${st.distance.toFixed(0)} km</span>
            <span class="td-dir">${st.direction}</span>
            <span class="td-tier">T${st.tier}</span>
            <span class="td-pm">${pm}</span>
            <span class="td-pred">${pred}</span>
            <span class="td-level">${badge}</span>
            <span class="td-lead">${lead}</span>
        </div>`;
    });

    tableBody.innerHTML = html || `<div class="empty-state">
        <div class="empty-icon">📡</div>
        <div class="empty-text">No stations loaded</div>
    </div>`;
}

function updateCityCards(results) {
    const cityNames = Object.keys(citiesInfo);

    cityNames.forEach(city => {
        const card = document.getElementById("card-" + city);
        if (!card) return;
        const levelEl = card.querySelector(".city-card-level");
        const detailEl = card.querySelector(".city-card-detail");

        if (!results || results.length === 0) {
            card.style.setProperty("--card-color", "#3b82f6");
            card.style.borderColor = "#27272a";
            levelEl.textContent = "Waiting for data";
            levelEl.style.color = "#fafafa";
            detailEl.textContent = "";
            return;
        }

        const cityResults = results.filter(r => r.target_city === city);
        if (cityResults.length === 0) {
            card.style.setProperty("--card-color", "#3b82f6");
            card.style.borderColor = "#27272a";
            levelEl.textContent = "No data";
            levelEl.style.color = "#71717a";
            detailEl.textContent = "";
            return;
        }

        const worst = cityResults[0]; // already sorted by predicted desc
        card.style.setProperty("--card-color", worst.level_hex);
        card.style.borderColor = worst.level_hex + "44";
        levelEl.textContent = `${worst.level_name}  ·  ${worst.predicted.toFixed(1)} µg/m³`;
        levelEl.style.color = worst.level_hex;
        detailEl.textContent = `via ${worst.station} · ${cityResults.length} stations`;
    });

    // Update stats row
    if (results && results.length > 0) {
        statsRow.style.display = "grid";
        const worst = results[0];
        document.getElementById("stat-worst").textContent = worst.predicted.toFixed(1);
        document.getElementById("stat-worst").style.color = worst.level_hex;
        document.getElementById("stat-reporting").textContent = results.length;
        const tier1 = results.filter(r => r.tier === 1);
        document.getElementById("stat-lead").textContent = tier1.length > 0 ? tier1[0].lead : results[0].lead;
    } else {
        statsRow.style.display = "none";
    }
}

function handleResults(results, label) {
    lastResults = results;
    renderTable(results);
    updateCityCards(results);
    if (map) updateMapMarkers(results);
    const count = results ? results.length : 0;
    statusEl.textContent = `${label} · ${count} stations reporting`;
    mapStatus.textContent = `${label} · ${count} stations`;
}

async function runDemo() {
    statusEl.textContent = "Loading demo scenario...";
    try {
        const resp = await fetch("/api/demo/");
        const data = await resp.json();
        handleResults(data.results, "Demo: All cities wildfire scenario");
    } catch (e) {
        statusEl.textContent = `Error: ${e}`;
    }
}

const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
let progressInterval = null;

function showProgress(label) {
    progressWrap.style.display = "block";
    progressLabel.textContent = label || "Fetching live data...";
    progressFill.style.width = "0%";
    let pct = 0;
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        pct += (100 - pct) * 0.08;
        if (pct > 95) pct = 95;
        progressFill.style.width = pct + "%";
    }, 200);
}

function hideProgress() {
    clearInterval(progressInterval);
    progressFill.style.width = "100%";
    setTimeout(() => { progressWrap.style.display = "none"; }, 400);
}

const svgRefresh = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;

async function fetchLive() {
    btnFetch.disabled = true;
    btnFetch.innerHTML = svgRefresh + " Fetching...";
    statusEl.textContent = "Connecting to PurpleAir...";
    showProgress("Fetching live data from PurpleAir...");
    try {
        const resp = await fetch("/api/fetch/", { method: "POST" });
        const data = await resp.json();
        if (data.error) {
            statusEl.textContent = data.error;
        } else {
            const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
            handleResults(data.results, `Live data · ${now}`);
        }
    } catch (e) {
        statusEl.textContent = `Error: ${e}`;
    } finally {
        hideProgress();
        btnFetch.disabled = false;
        btnFetch.innerHTML = svgRefresh + " Fetch Live Data";
    }
}

// ---- Map functions ----
function initMap() {
    if (map) { map.invalidateSize(); return; }
    map = L.map("map-container", { zoomControl: false, attributionControl: true }).setView([52, -96], 4);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 18,
    }).addTo(map);
    updateMapMarkers(lastResults);
}

function createCircleIcon(color, size, pulse) {
    const pulseRing = pulse
        ? `<div class="marker-pulse" style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};opacity:0.5;animation:markerPulse 2s ease-out infinite;"></div>`
        : "";
    return L.divIcon({
        className: "marker-icon",
        html: `<div style="position:relative;width:${size}px;height:${size}px;">
            ${pulseRing}
            <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.4);box-shadow:0 0 10px ${color}88;transition:all 0.3s;"></div>
        </div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

function getCityAlertInfo(results, cityName) {
    if (!results) return { color: "#3b82f6", level: "No Data", predicted: null, hex: "#3b82f6" };
    const cityResults = results.filter(r => r.target_city === cityName);
    if (cityResults.length === 0) return { color: "#3b82f6", level: "No Data", predicted: null, hex: "#3b82f6" };
    // worst (highest predicted) is first since results are sorted
    const worst = cityResults[0];
    return { color: worst.level_hex, level: worst.level_name, predicted: worst.predicted, hex: worst.level_hex, textColor: worst.level_text_color, lead: worst.lead, station: worst.station, count: cityResults.length };
}

function updateMapMarkers(results) {
    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    const resultMap = {};
    if (results) results.forEach(r => { resultMap[r.id + (r.target_city || "")] = r; });

    // City prediction bubbles (radius circles) — drawn first so they're behind everything
    for (const [name, info] of Object.entries(citiesInfo)) {
        const alert = getCityAlertInfo(results, name);
        const radiusKm = 60000; // 60km visual radius
        const bubble = L.circle([info.lat, info.lon], {
            radius: radiusKm,
            color: alert.color,
            weight: 2,
            opacity: 0.6,
            fillColor: alert.color,
            fillOpacity: 0.12,
            dashArray: results ? null : "6 4",
            interactive: false,
        }).addTo(map);
        mapMarkers.push(bubble);
    }

    // City center markers
    for (const [name, info] of Object.entries(citiesInfo)) {
        const alert = getCityAlertInfo(results, name);
        const hasData = alert.predicted !== null;
        const dotColor = hasData ? alert.color : "#3b82f6";

        const m = L.marker([info.lat, info.lon], {
            icon: L.divIcon({
                className: "marker-icon",
                html: `<div style="position:relative;width:22px;height:22px;">
                    <div class="marker-pulse" style="position:absolute;inset:-8px;border-radius:50%;border:2px solid ${dotColor};opacity:0.4;animation:markerPulse 3s ease-out infinite;"></div>
                    <div style="width:22px;height:22px;border-radius:50%;background:${dotColor};border:3px solid white;box-shadow:0 0 16px ${dotColor}88;transition:all 0.4s;"></div>
                </div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11],
            }),
            zIndexOffset: 1000,
        }).addTo(map);

        let popupContent = `<div class="popup-name">${info.label || name}</div><div class="popup-divider"></div>`;
        if (hasData) {
            popupContent += `
                <div class="popup-row"><span class="popup-label">Predicted PM2.5</span><span class="popup-val" style="color:${alert.hex};font-size:16px;">${alert.predicted.toFixed(1)} µg/m³</span></div>
                <div class="popup-row"><span class="popup-label">Alert Level</span><span class="popup-val"><span class="badge" style="background:${alert.hex};color:${alert.textColor};font-size:9px;padding:2px 8px">${alert.level}</span></span></div>
                <div class="popup-row"><span class="popup-label">Earliest Warning</span><span class="popup-val">${alert.lead || "—"}</span></div>
                <div class="popup-row"><span class="popup-label">Stations</span><span class="popup-val">${alert.count} reporting</span></div>
            `;
        } else {
            popupContent += `<div style="color:#71717a;font-size:12px;margin-top:4px;">No data — fetch live data or run demo</div>`;
        }
        m.bindPopup(popupContent);
        mapMarkers.push(m);
    }

    // Station markers
    stations.forEach(st => {
        if (st.lat == null || st.lon == null) return;
        const city = st.target_city || "";
        const r = resultMap[st.id + city];
        let color = "#52525b";
        let size = 8;
        let popupExtra = "";
        let shouldPulse = false;

        if (r) {
            color = r.level_hex;
            size = 12;
            shouldPulse = r.level_name === "Extreme" || r.level_name === "Very High";
            popupExtra = `
                <div class="popup-divider"></div>
                <div class="popup-row"><span class="popup-label">PM2.5</span><span class="popup-val">${r.pm25.toFixed(1)} µg/m³</span></div>
                <div class="popup-row"><span class="popup-label">Predicted</span><span class="popup-val" style="color:${r.level_hex}">${r.predicted.toFixed(1)} µg/m³</span></div>
                <div class="popup-row"><span class="popup-label">Level</span><span class="popup-val"><span class="badge" style="background:${r.level_hex};color:${r.level_text_color};font-size:9px;padding:2px 8px">${r.level_name}</span></span></div>
                <div class="popup-row"><span class="popup-label">Lead Time</span><span class="popup-val">${r.lead}</span></div>
            `;
        }

        const marker = L.marker([st.lat, st.lon], { icon: createCircleIcon(color, size, shouldPulse) }).addTo(map);
        marker.bindPopup(`
            <div class="popup-name">${st.city_name}</div>
            <div class="popup-meta">${city} · ${st.distance.toFixed(0)} km ${st.direction} · Tier ${st.tier}</div>
            ${popupExtra}
        `);

        // Draw line to target city
        if (r && citiesInfo[city]) {
            const ci = citiesInfo[city];
            const line = L.polyline([[st.lat, st.lon], [ci.lat, ci.lon]], {
                color: r.level_hex, weight: 1.5, opacity: 0.25, dashArray: "4 6",
            }).addTo(map);
            mapMarkers.push(line);
        }

        mapMarkers.push(marker);
    });

    // Fit Canada bounds
    if (stations.length > 0) {
        const lats = stations.filter(s => s.lat).map(s => s.lat);
        const lons = stations.filter(s => s.lon).map(s => s.lon);
        if (lats.length) {
            map.fitBounds([
                [Math.min(...lats) - 1, Math.min(...lons) - 1],
                [Math.max(...lats) + 1, Math.max(...lons) + 1],
            ], { padding: [20, 20] });
        }
    }
}

// Map buttons
async function mapRunDemo() {
    mapStatus.textContent = "Loading demo...";
    try {
        const resp = await fetch("/api/demo/");
        const data = await resp.json();
        handleResults(data.results, "Demo: All cities");
    } catch (e) {
        mapStatus.textContent = `Error: ${e}`;
    }
}

async function mapFetchLive() {
    mapBtnFetch.disabled = true;
    mapStatus.textContent = "Fetching live data...";
    try {
        const resp = await fetch("/api/fetch/", { method: "POST" });
        const data = await resp.json();
        if (data.error) {
            mapStatus.textContent = data.error;
        } else {
            handleResults(data.results, `Live data · ${data.results.length} stations`);
        }
    } catch (e) {
        mapStatus.textContent = `Error: ${e}`;
    } finally {
        mapBtnFetch.disabled = false;
    }
}

// Init — load all stations then auto-fetch
const AUTO_REFRESH_MS = 15 * 60 * 1000;

async function init() {
    await loadStations();
    fetchLive();
}
init();

setInterval(() => { fetchLive(); }, AUTO_REFRESH_MS);
