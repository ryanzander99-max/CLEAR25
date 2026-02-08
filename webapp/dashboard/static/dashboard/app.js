/* ============================================================
   PM2.5 EWS — App Logic (All Cities Combined)
   ============================================================ */

let stations = [];
let citiesInfo = {};
let map = null;
let mapMarkers = [];
let lastResults = null;
let lastCityAlerts = null;

// ═══════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS (Capacitor)
// ═══════════════════════════════════════════════════════════════════════════

async function initPushNotifications() {
    // Only run in Capacitor app context
    if (typeof Capacitor === "undefined" || !Capacitor.isNativePlatform()) {
        console.log("[Push] Not running in Capacitor, skipping push setup");
        return;
    }

    try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        // Request permission
        const permStatus = await PushNotifications.requestPermissions();
        if (permStatus.receive !== "granted") {
            console.log("[Push] Permission not granted");
            return;
        }

        // Register with APNs
        await PushNotifications.register();

        // Handle registration success
        PushNotifications.addListener("registration", async (token) => {
            console.log("[Push] Registered with token:", token.value.substring(0, 20) + "...");

            // Send token to our backend
            try {
                await fetch("/api/push/register/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        token: token.value,
                        platform: "ios",
                        cities: [], // Empty = all cities
                    }),
                });
                console.log("[Push] Token registered with server");
            } catch (e) {
                console.error("[Push] Failed to register token:", e);
            }
        });

        // Handle registration error
        PushNotifications.addListener("registrationError", (error) => {
            console.error("[Push] Registration error:", error);
        });

        // Handle incoming notification while app is open
        PushNotifications.addListener("pushNotificationReceived", (notification) => {
            console.log("[Push] Notification received:", notification);
            // Show in-app toast
            if (notification.title) {
                showPushToast(notification.title, notification.body);
            }
        });

        // Handle notification tap
        PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            console.log("[Push] Notification tapped:", action);
            // Navigate to dashboard if needed
            const data = action.notification.data;
            if (data && data.city) {
                // Could scroll to city or show details
            }
        });

        console.log("[Push] Push notifications initialized");
    } catch (e) {
        console.log("[Push] Not available:", e.message);
    }
}

function showPushToast(title, body) {
    const container = document.getElementById("toast-container") || document.body;
    const toast = document.createElement("div");
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #1e3a5f; border: 1px solid #3b82f6; color: #fff;
        padding: 16px 20px; border-radius: 12px; z-index: 10000;
        max-width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        animation: slideIn 0.3s ease;
    `;
    toast.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;">${title}</div>
        <div style="font-size:13px;color:#a1a1aa;">${body || ""}</div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "slideOut 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// DOM refs
const tableBody = document.getElementById("table-body");
const statusEl = document.getElementById("status");
const statsRow = document.getElementById("stats-row");
const stationCount = document.getElementById("station-count");
const mapStatus = document.getElementById("map-status");

// ---- Tab switching (sidebar) ----
document.querySelectorAll(".sidebar-tab").forEach(t => {
    t.addEventListener("click", () => {
        document.querySelector(".sidebar-tab.tab-active")?.classList.remove("tab-active");
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

// ---- Account dropdown ----
const accountToggle = document.getElementById("account-toggle");
const accountMenu = document.getElementById("account-menu");

if (accountToggle && accountMenu) {
    accountToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        accountMenu.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
        if (!accountMenu.contains(e.target) && !accountToggle.contains(e.target)) {
            accountMenu.classList.remove("open");
        }
    });
}

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
            html += `<div class="tier-sep" style="color:var(--accent-color, #71717a);font-size:13px;padding:12px 20px 6px;">${city}</div>`;
        }

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

function updateCityCards(results, cityAlerts) {
    const cityNames = Object.keys(citiesInfo);

    cityNames.forEach(city => {
        const card = document.getElementById("card-" + city);
        if (!card) return;
        const levelEl = card.querySelector(".city-card-level");
        const detailEl = card.querySelector(".city-card-detail");

        if (!results || results.length === 0) {
            card.style.setProperty("--card-color", "#fff");
            card.style.borderColor = "#27272a";
            levelEl.textContent = "Waiting for data";
            levelEl.style.color = "#fafafa";
            detailEl.textContent = "";
            return;
        }

        const cityResults = results.filter(r => r.target_city === city);
        if (cityResults.length === 0) {
            card.style.setProperty("--card-color", "#fff");
            card.style.borderColor = "#27272a";
            levelEl.textContent = "No data";
            levelEl.style.color = "#71717a";
            detailEl.textContent = "";
            return;
        }

        // Use city-level alert if available
        const alert = cityAlerts && cityAlerts[city];
        if (alert) {
            card.style.setProperty("--card-color", alert.level_hex);
            card.style.borderColor = alert.level_hex + "44";
            if (alert.alert) {
                const ruleLabel = alert.rule === "rule1" ? "Single station ≥55" : "Dual station sustained";
                levelEl.textContent = `${alert.level_name}  ·  ${alert.predicted_pm25} µg/m³`;
                levelEl.style.color = alert.level_hex;
                detailEl.textContent = `${ruleLabel} · ${cityResults.length} stations`;
            } else {
                levelEl.textContent = `No Alert  ·  ${alert.predicted_pm25} µg/m³`;
                levelEl.style.color = alert.level_hex;
                detailEl.textContent = `${cityResults.length} stations reporting`;
            }
        } else {
            // Fallback: use worst station prediction
            const worst = cityResults[0];
            card.style.setProperty("--card-color", worst.level_hex);
            card.style.borderColor = worst.level_hex + "44";
            levelEl.textContent = `${worst.level_name}  ·  ${worst.predicted.toFixed(1)} µg/m³`;
            levelEl.style.color = worst.level_hex;
            detailEl.textContent = `via ${worst.station} · ${cityResults.length} stations`;
        }
    });

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

function updateAccentColor(results) {
    // Set accent color based on worst predicted PM2.5 level
    const root = document.documentElement;

    if (!results || results.length === 0) {
        // Default neutral accent when no data
        root.style.setProperty("--accent-color", "#71717a");
        root.style.setProperty("--accent-text", "#fff");
        return;
    }

    // Results are sorted by predicted PM2.5, worst first
    const worst = results[0];
    root.style.setProperty("--accent-color", worst.level_hex);
    root.style.setProperty("--accent-text", worst.level_text_color);
}

function handleResults(results, label, cityAlerts) {
    lastResults = results;
    lastCityAlerts = cityAlerts || null;
    updateAccentColor(results);
    renderTable(results);
    updateCityCards(results, cityAlerts);
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
        handleResults(data.results, "Demo: All cities wildfire scenario", data.city_alerts);
    } catch (e) {
        statusEl.textContent = `Error: ${e}`;
    }
}

async function loadLiveData() {
    statusEl.textContent = "Loading live data...";
    try {
        const resp = await fetch("/api/live/");
        const data = await resp.json();
        if (data.results && data.results.length > 0) {
            const age = data.age_seconds || 0;
            const mins = Math.floor(age / 60);
            let label;
            if (mins < 1) label = "Live data · just updated";
            else if (mins < 60) label = `Live data · updated ${mins} min ago`;
            else label = `Live data · updated ${Math.floor(mins / 60)}h ${mins % 60}m ago`;
            handleResults(data.results, label, data.city_alerts);
            return true;
        }
    } catch (e) { /* ignore */ }
    return false;
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
    if (!results) return { color: "#fff", level: "No Data", predicted: null, hex: "#fff" };
    const cityResults = results.filter(r => r.target_city === cityName);
    if (cityResults.length === 0) return { color: "#fff", level: "No Data", predicted: null, hex: "#fff" };

    // Use city-level alert if available
    const alert = lastCityAlerts && lastCityAlerts[cityName];
    if (alert) {
        return {
            color: alert.level_hex, level: alert.level_name,
            predicted: alert.predicted_pm25, hex: alert.level_hex,
            textColor: alert.level_text_color,
            lead: cityResults[0].lead, station: cityResults[0].station,
            count: cityResults.length, isAlert: alert.alert, rule: alert.rule,
        };
    }
    const worst = cityResults[0];
    return { color: worst.level_hex, level: worst.level_name, predicted: worst.predicted, hex: worst.level_hex, textColor: worst.level_text_color, lead: worst.lead, station: worst.station, count: cityResults.length };
}

function updateMapMarkers(results) {
    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    const resultMap = {};
    if (results) results.forEach(r => { resultMap[r.id + (r.target_city || "")] = r; });

    // City prediction bubbles
    for (const [name, info] of Object.entries(citiesInfo)) {
        const alert = getCityAlertInfo(results, name);
        const radiusKm = 60000;
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
        const dotColor = hasData ? alert.color : "#fff";

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
            popupContent += `<div style="color:#71717a;font-size:12px;margin-top:4px;">No data available yet</div>`;
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
            shouldPulse = r.level_name === "EXTREME" || r.level_name === "VERY HIGH";
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

        if (r && citiesInfo[city]) {
            const ci = citiesInfo[city];
            const line = L.polyline([[st.lat, st.lon], [ci.lat, ci.lon]], {
                color: r.level_hex, weight: 1.5, opacity: 0.25, dashArray: "4 6",
            }).addTo(map);
            mapMarkers.push(line);
        }

        mapMarkers.push(marker);
    });

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

// Map demo button
async function mapRunDemo() {
    mapStatus.textContent = "Loading demo...";
    try {
        const resp = await fetch("/api/demo/");
        const data = await resp.json();
        handleResults(data.results, "Demo: All cities", data.city_alerts);
    } catch (e) {
        mapStatus.textContent = `Error: ${e}`;
    }
}

// Init
async function init() {
    await loadStations();
    const hasLive = await loadLiveData();
    if (!hasLive) {
        statusEl.textContent = "No live data yet — run demo or wait for next refresh";
    }
    initFeedbackBoard();
    initPushNotifications();
}
init();

// ═══════════════════════════════════════════════════════════════════════════
// FEEDBACK BOARD
// ═══════════════════════════════════════════════════════════════════════════

let feedbackAuth = { authenticated: false, username: "" };
let currentSort = "hot";
let currentSuggestionId = null;

function initFeedbackBoard() {
    // Check auth status
    fetch("/api/auth-status/")
        .then(r => r.json())
        .then(data => { feedbackAuth = data; })
        .catch(() => {});

    // Sort buttons
    document.querySelectorAll(".sort-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("sort-active"));
            btn.classList.add("sort-active");
            currentSort = btn.dataset.sort;
            loadSuggestions();
        });
    });

    // New suggestion button
    document.getElementById("btn-new-suggestion")?.addEventListener("click", () => {
        if (!feedbackAuth.authenticated) {
            document.getElementById("modal-login").style.display = "flex";
            return;
        }
        document.getElementById("suggestion-title").value = "";
        document.getElementById("suggestion-body").value = "";
        document.getElementById("suggestion-error").style.display = "none";
        document.getElementById("modal-suggestion").style.display = "flex";
    });

    // Modal closes
    document.getElementById("modal-suggestion-close")?.addEventListener("click", () => {
        document.getElementById("modal-suggestion").style.display = "none";
    });
    document.getElementById("modal-suggestion-cancel")?.addEventListener("click", () => {
        document.getElementById("modal-suggestion").style.display = "none";
    });
    document.getElementById("modal-detail-close")?.addEventListener("click", () => {
        document.getElementById("modal-detail").style.display = "none";
    });
    document.getElementById("modal-login-close")?.addEventListener("click", () => {
        document.getElementById("modal-login").style.display = "none";
    });

    // Close modals on overlay click
    ["modal-suggestion", "modal-detail", "modal-login"].forEach(id => {
        document.getElementById(id)?.addEventListener("click", (e) => {
            if (e.target.classList.contains("modal-overlay")) {
                e.target.style.display = "none";
            }
        });
    });

    // Submit suggestion
    document.getElementById("modal-suggestion-submit")?.addEventListener("click", submitSuggestion);

    // Vote buttons in detail modal
    document.getElementById("detail-upvote")?.addEventListener("click", () => voteSuggestion(1));
    document.getElementById("detail-downvote")?.addEventListener("click", () => voteSuggestion(-1));

    // Add comment
    document.getElementById("btn-add-comment")?.addEventListener("click", addComment);

    // Delete suggestion
    document.getElementById("btn-delete-suggestion")?.addEventListener("click", deleteSuggestion);

    // Load initial suggestions
    loadSuggestions();
}

async function loadSuggestions() {
    const list = document.getElementById("suggestions-list");
    if (!list) return;

    try {
        const resp = await fetch(`/api/suggestions/?sort=${currentSort}`);
        const data = await resp.json();

        if (!data.suggestions || data.suggestions.length === 0) {
            list.innerHTML = `<div class="suggestions-empty">No suggestions yet. Be the first to share an idea!</div>`;
            return;
        }

        list.innerHTML = data.suggestions.map(s => `
            <div class="suggestion-card" data-id="${s.id}">
                <div class="suggestion-votes">
                    <button class="vote-btn vote-up ${s.user_vote === 1 ? 'voted-up' : ''}" data-id="${s.id}" data-vote="1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <span class="suggestion-score">${s.score}</span>
                    <button class="vote-btn vote-down ${s.user_vote === -1 ? 'voted-down' : ''}" data-id="${s.id}" data-vote="-1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                </div>
                <img src="${s.author_avatar}" alt="" class="suggestion-avatar">
                <div class="suggestion-content">
                    <div class="suggestion-title">${escapeHtml(s.title)}</div>
                    <div class="suggestion-meta">
                        <span class="suggestion-author">${escapeHtml(s.author)}</span>
                        <span>${timeAgo(s.created_at)}</span>
                        <span>${s.comment_count} comment${s.comment_count !== 1 ? 's' : ''}</span>
                    </div>
                </div>
            </div>
        `).join("");

        // Click handlers for cards
        list.querySelectorAll(".suggestion-card").forEach(card => {
            card.addEventListener("click", (e) => {
                if (e.target.closest(".vote-btn")) return;
                openSuggestionDetail(parseInt(card.dataset.id));
            });
        });

        // Vote button handlers
        list.querySelectorAll(".vote-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const vote = parseInt(btn.dataset.vote);
                quickVote(id, vote, btn);
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="suggestions-empty">Failed to load suggestions</div>`;
    }
}

async function quickVote(suggestionId, value, btn) {
    if (!feedbackAuth.authenticated) {
        document.getElementById("modal-login").style.display = "flex";
        return;
    }

    const card = btn.closest(".suggestion-card");
    const scoreEl = card.querySelector(".suggestion-score");
    const upBtn = card.querySelector(".vote-up");
    const downBtn = card.querySelector(".vote-down");

    // Toggle vote
    const wasVoted = btn.classList.contains(value === 1 ? "voted-up" : "voted-down");
    const newValue = wasVoted ? 0 : value;

    try {
        const resp = await fetch(`/api/suggestions/${suggestionId}/vote/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: newValue }),
        });
        const data = await resp.json();
        if (resp.ok) {
            scoreEl.textContent = data.score;
            upBtn.classList.toggle("voted-up", data.user_vote === 1);
            downBtn.classList.toggle("voted-down", data.user_vote === -1);
        }
    } catch (e) {
        console.error("Vote failed:", e);
    }
}

async function openSuggestionDetail(id) {
    currentSuggestionId = id;
    const modal = document.getElementById("modal-detail");

    try {
        const resp = await fetch(`/api/suggestions/${id}/`);
        const s = await resp.json();

        document.getElementById("detail-title").textContent = s.title;
        document.getElementById("detail-avatar").src = s.author_avatar;
        document.getElementById("detail-author").textContent = s.author;
        document.getElementById("detail-date").textContent = timeAgo(s.created_at);
        document.getElementById("detail-body").textContent = s.body;
        document.getElementById("detail-score").textContent = s.score;

        const upBtn = document.getElementById("detail-upvote");
        const downBtn = document.getElementById("detail-downvote");
        upBtn.classList.toggle("voted-up", s.user_vote === 1);
        downBtn.classList.toggle("voted-down", s.user_vote === -1);

        const commentsEl = document.getElementById("detail-comments");
        if (s.comments.length === 0) {
            commentsEl.innerHTML = `<div class="comments-empty">No comments yet</div>`;
        } else {
            commentsEl.innerHTML = s.comments.map(c => `
                <div class="comment-item">
                    <img src="${c.author_avatar}" alt="" class="comment-avatar">
                    <div class="comment-content">
                        <div class="comment-header">
                            <span class="comment-author">${escapeHtml(c.author)}</span>
                            <span class="comment-date">${timeAgo(c.created_at)}</span>
                        </div>
                        <div class="comment-body">${escapeHtml(c.body)}</div>
                    </div>
                </div>
            `).join("");
        }

        document.getElementById("comment-input").value = "";
        document.getElementById("comment-error").style.display = "none";

        // Show/hide delete button based on ownership
        const deleteBtn = document.getElementById("btn-delete-suggestion");
        if (s.is_owner) {
            deleteBtn.classList.remove("hidden");
        } else {
            deleteBtn.classList.add("hidden");
        }

        modal.style.display = "flex";
    } catch (e) {
        console.error("Failed to load suggestion:", e);
    }
}

async function voteSuggestion(value) {
    if (!feedbackAuth.authenticated) {
        document.getElementById("modal-login").style.display = "flex";
        return;
    }
    if (!currentSuggestionId) return;

    const upBtn = document.getElementById("detail-upvote");
    const downBtn = document.getElementById("detail-downvote");
    const scoreEl = document.getElementById("detail-score");

    const wasVoted = (value === 1 && upBtn.classList.contains("voted-up")) ||
                     (value === -1 && downBtn.classList.contains("voted-down"));
    const newValue = wasVoted ? 0 : value;

    try {
        const resp = await fetch(`/api/suggestions/${currentSuggestionId}/vote/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: newValue }),
        });
        const data = await resp.json();
        if (resp.ok) {
            scoreEl.textContent = data.score;
            upBtn.classList.toggle("voted-up", data.user_vote === 1);
            downBtn.classList.toggle("voted-down", data.user_vote === -1);
            loadSuggestions(); // Refresh list
        }
    } catch (e) {
        console.error("Vote failed:", e);
    }
}

async function deleteSuggestion() {
    if (!currentSuggestionId) return;

    if (!confirm("Are you sure you want to delete this suggestion? This cannot be undone.")) {
        return;
    }

    try {
        const resp = await fetch(`/api/suggestions/${currentSuggestionId}/delete/`, {
            method: "DELETE",
        });
        const data = await resp.json();

        if (resp.ok) {
            document.getElementById("modal-detail").style.display = "none";
            loadSuggestions();
        } else {
            alert(data.error || "Failed to delete suggestion");
        }
    } catch (e) {
        console.error("Delete failed:", e);
        alert("Failed to delete suggestion");
    }
}

async function submitSuggestion() {
    const title = document.getElementById("suggestion-title").value.trim();
    const body = document.getElementById("suggestion-body").value.trim();
    const errorEl = document.getElementById("suggestion-error");

    if (!title || title.length < 5) {
        errorEl.textContent = "Title must be at least 5 characters";
        errorEl.style.display = "block";
        return;
    }
    if (!body || body.length < 10) {
        errorEl.textContent = "Description must be at least 10 characters";
        errorEl.style.display = "block";
        return;
    }

    try {
        const resp = await fetch("/api/suggestions/create/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, body }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            errorEl.textContent = data.error || "Failed to create suggestion";
            errorEl.style.display = "block";
            return;
        }

        document.getElementById("modal-suggestion").style.display = "none";
        loadSuggestions();
    } catch (e) {
        errorEl.textContent = "Network error";
        errorEl.style.display = "block";
    }
}

async function addComment() {
    if (!feedbackAuth.authenticated) {
        document.getElementById("modal-login").style.display = "flex";
        return;
    }
    if (!currentSuggestionId) return;

    const input = document.getElementById("comment-input");
    const body = input.value.trim();
    const errorEl = document.getElementById("comment-error");

    if (!body || body.length < 2) {
        errorEl.textContent = "Comment must be at least 2 characters";
        errorEl.style.display = "block";
        return;
    }

    try {
        const resp = await fetch(`/api/suggestions/${currentSuggestionId}/comments/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            errorEl.textContent = data.error || "Failed to add comment";
            errorEl.style.display = "block";
            return;
        }

        // Add comment to list
        const commentsEl = document.getElementById("detail-comments");
        const emptyMsg = commentsEl.querySelector(".comments-empty");
        if (emptyMsg) emptyMsg.remove();

        commentsEl.insertAdjacentHTML("beforeend", `
            <div class="comment-item">
                <img src="${data.author_avatar}" alt="" class="comment-avatar">
                <div class="comment-content">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHtml(data.author)}</span>
                        <span class="comment-date">just now</span>
                    </div>
                    <div class="comment-body">${escapeHtml(data.body)}</div>
                </div>
            </div>
        `);

        input.value = "";
        errorEl.style.display = "none";
        loadSuggestions(); // Refresh comment count
    } catch (e) {
        errorEl.textContent = "Network error";
        errorEl.style.display = "block";
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function timeAgo(isoString) {
    const date = new Date(isoString);
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

// ═══════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

let apiKeysLoaded = false;
let apiKeyTimers = {};
let apiKeyTimerInterval = null;

// Accent colors for API keys (Vercel-style dark backgrounds)
const API_KEY_COLORS = [
    { border: "#3b82f6", bg: "#0a0a0a" },   // Blue
    { border: "#8b5cf6", bg: "#0a0a0a" },   // Purple
    { border: "#06b6d4", bg: "#0a0a0a" },   // Cyan
    { border: "#10b981", bg: "#0a0a0a" },   // Emerald
    { border: "#f59e0b", bg: "#0a0a0a" },   // Amber
];

// Toast notification helper
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    const bgColor = type === "error" ? "#7f1d1d" : type === "warning" ? "#78350f" : "#14532d";
    const borderColor = type === "error" ? "#991b1b" : type === "warning" ? "#92400e" : "#166534";
    toast.style.cssText = `background:${bgColor};border:1px solid ${borderColor};color:#fff;padding:12px 16px;border-radius:8px;margin-top:8px;font-size:13px;display:flex;align-items:center;gap:8px;animation:slideIn 0.2s ease;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
    toast.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === "error" ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
              type === "warning" ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' :
              '<polyline points="20 6 9 17 4 12"/>'}
        </svg>
        ${escapeHtml(message)}
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "slideOut 0.2s ease";
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}

async function loadApiKeys() {
    const listEl = document.getElementById("api-keys-list");
    const emptyEl = document.getElementById("api-keys-empty");
    if (!listEl) return;

    try {
        const resp = await fetch("/api/auth-status/");
        const auth = await resp.json();

        if (!auth.authenticated) {
            if (emptyEl) emptyEl.textContent = "Sign in to manage API keys";
            return;
        }

        const keysResp = await fetch("/api/v1/keys/create/");
        if (!keysResp.ok) {
            if (emptyEl) emptyEl.textContent = "Failed to load API keys";
            return;
        }

        const data = await keysResp.json();
        const keys = data.keys || [];

        // Show plan badge
        const planBadge = document.getElementById("api-plan-badge");
        if (planBadge && data.plan) {
            const planColors = { free: { bg: "rgba(113,113,122,0.15)", color: "#a1a1aa" }, pro: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" }, business: { bg: "rgba(168,85,247,0.15)", color: "#c084fc" } };
            const pc = planColors[data.plan] || planColors.free;
            planBadge.style.background = pc.bg;
            planBadge.style.color = pc.color;
            planBadge.textContent = data.plan;
            planBadge.style.display = "inline-block";
        }

        if (keys.length === 0) {
            if (emptyEl) {
                emptyEl.textContent = "No API keys yet. Create one to get started.";
                emptyEl.style.display = "block";
            }
            return;
        }

        // Hide empty message when we have keys
        if (emptyEl) emptyEl.style.display = "none";

        // Clear old timers
        if (apiKeyTimerInterval) { clearInterval(apiKeyTimerInterval); apiKeyTimerInterval = null; }
        apiKeyTimers = {};

        const now = Date.now();
        listEl.innerHTML = keys.map((k, idx) => {
            const accentColor = API_KEY_COLORS[idx % API_KEY_COLORS.length];
            const keyId = k.key.substring(0, 8);

            const hasActiveWindow = k.has_active_window && k.reset_seconds > 0;
            if (hasActiveWindow) {
                apiKeyTimers[keyId] = { resetTime: now + (k.reset_seconds * 1000), active: true, used: k.requests_used, limit: k.rate_limit };
            }
            const timerText = hasActiveWindow
                ? `Resets in ${Math.floor(k.reset_seconds / 60)}m ${k.reset_seconds % 60}s · ${k.requests_used}/${k.rate_limit} used`
                : "Ready · No active rate limit";
            const timerColor = hasActiveWindow ? "#71717a" : "#22c55e";

            return `
            <div class="api-key-item" style="background:${accentColor.bg};border:1px solid ${accentColor.border}40;border-left:3px solid ${accentColor.border};border-radius:8px;margin-bottom:12px;overflow:hidden;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:500;color:#fafafa;margin-bottom:4px;">${escapeHtml(k.name || 'Unnamed key')}</div>
                        <code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:${accentColor.border};word-break:break-all;">${k.key.substring(0, 12)}...${k.key.substring(k.key.length - 6)}</code>
                        <div style="font-size:11px;color:#71717a;margin-top:4px;">Created ${timeAgo(k.created_at)}${k.last_used ? ' · Last used ' + timeAgo(k.last_used) : ''} · ${k.total_requests || 0} total requests</div>
                        <div id="timer-${keyId}" style="font-size:11px;color:${timerColor};margin-top:4px;">${timerText}</div>
                    </div>
                    <div style="display:flex;gap:8px;margin-left:16px;">
                        <button onclick="copyApiKey('${k.key}')" class="action-btn action-secondary" style="padding:6px 12px;font-size:12px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Copy
                        </button>
                        <button onclick="revokeApiKey('${k.key}')" class="action-btn" style="padding:6px 12px;font-size:12px;background:#7f1d1d;border-color:#991b1b;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Revoke
                        </button>
                    </div>
                </div>
            </div>`;
        }).join("");

        // Start countdown timers
        const hasActiveTimers = Object.values(apiKeyTimers).some(t => t.active);
        if (hasActiveTimers) {
            apiKeyTimerInterval = setInterval(() => {
                const now = Date.now();
                let allDone = true;
                for (const [keyId, td] of Object.entries(apiKeyTimers)) {
                    if (!td.active) continue;
                    const el = document.getElementById(`timer-${keyId}`);
                    if (!el) continue;
                    const ms = td.resetTime - now;
                    if (ms <= 0) {
                        el.textContent = "Ready · Rate limit reset";
                        el.style.color = "#22c55e";
                        td.active = false;
                    } else {
                        allDone = false;
                        const s = Math.floor(ms / 1000);
                        el.textContent = `Resets in ${Math.floor(s / 60)}m ${s % 60}s · ${td.used}/${td.limit} used`;
                    }
                }
                if (allDone) { clearInterval(apiKeyTimerInterval); apiKeyTimerInterval = null; }
            }, 1000);
        }
    } catch (e) {
        console.error("Failed to load API keys:", e);
        if (emptyEl) emptyEl.textContent = "Failed to load API keys";
    }
}

function openCreateKeyModal() {
    document.getElementById("api-key-name").value = "";
    document.getElementById("create-key-error").style.display = "none";
    document.getElementById("modal-create-key").style.display = "flex";
    document.getElementById("api-key-name").focus();
}

async function submitCreateKey() {
    const name = document.getElementById("api-key-name").value.trim();
    const errorEl = document.getElementById("create-key-error");

    try {
        const resp = await fetch("/api/v1/keys/create/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            errorEl.textContent = data.error || "Failed to create API key";
            errorEl.style.display = "block";
            return;
        }

        // Close create modal
        document.getElementById("modal-create-key").style.display = "none";

        // Show new key modal
        document.getElementById("new-key-display").textContent = data.key;
        document.getElementById("modal-new-key").style.display = "flex";

        loadApiKeys();
    } catch (e) {
        console.error("Failed to create API key:", e);
        errorEl.textContent = "Network error";
        errorEl.style.display = "block";
    }
}

async function copyNewKey() {
    const key = document.getElementById("new-key-display").textContent;
    try {
        await navigator.clipboard.writeText(key);
        const btn = document.getElementById("copy-new-key");
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        btn.style.background = "#166534";
        setTimeout(() => {
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy to Clipboard';
            btn.style.background = "";
        }, 2000);
    } catch (e) {
        showToast("Failed to copy to clipboard", "error");
    }
}

async function copyApiKey(key) {
    try {
        await navigator.clipboard.writeText(key);
        showToast("API key copied to clipboard");
    } catch (e) {
        showToast("Failed to copy to clipboard", "error");
    }
}

async function revokeApiKey(key) {
    // Create a confirmation modal inline
    const confirmed = await new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.display = "flex";
        overlay.innerHTML = `
            <div class="modal-box modal-box-sm">
                <div class="modal-header">
                    <h3>Revoke API Key?</h3>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <p style="color:#a1a1aa;">This will permanently disable this API key. Any applications using it will stop working.</p>
                </div>
                <div class="modal-footer">
                    <button class="action-btn action-secondary" id="revoke-cancel">Cancel</button>
                    <button class="action-btn" style="background:#7f1d1d;border-color:#991b1b;" id="revoke-confirm">Revoke Key</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector("#revoke-cancel").onclick = () => { overlay.remove(); resolve(false); };
        overlay.querySelector("#revoke-confirm").onclick = () => { overlay.remove(); resolve(true); };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });

    if (!confirmed) return;

    try {
        const resp = await fetch("/api/v1/keys/revoke/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            showToast(data.error || "Failed to revoke API key", "error");
            return;
        }

        showToast("API key revoked");
        loadApiKeys();
    } catch (e) {
        console.error("Failed to revoke API key:", e);
        showToast("Failed to revoke API key", "error");
    }
}

// Initialize API key modal handlers
function initApiKeyModals() {
    // Create key modal
    document.getElementById("btn-create-api-key")?.addEventListener("click", openCreateKeyModal);
    document.getElementById("modal-create-key-close")?.addEventListener("click", () => {
        document.getElementById("modal-create-key").style.display = "none";
    });
    document.getElementById("modal-create-key-cancel")?.addEventListener("click", () => {
        document.getElementById("modal-create-key").style.display = "none";
    });
    document.getElementById("modal-create-key-submit")?.addEventListener("click", submitCreateKey);

    // New key modal
    document.getElementById("copy-new-key")?.addEventListener("click", copyNewKey);
    document.getElementById("modal-new-key-done")?.addEventListener("click", () => {
        document.getElementById("modal-new-key").style.display = "none";
    });

    // Close on overlay click
    document.getElementById("modal-create-key")?.addEventListener("click", (e) => {
        if (e.target.classList.contains("modal-overlay")) {
            e.target.style.display = "none";
        }
    });

    // Enter key submits
    document.getElementById("api-key-name")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitCreateKey();
    });
}

// Load API keys when switching to API tab
document.querySelectorAll(".sidebar-tab").forEach(t => {
    t.addEventListener("click", () => {
        if (t.dataset.tab === "api" && !apiKeysLoaded) {
            apiKeysLoaded = true;
            loadApiKeys();
            initApiKeyModals();
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// BILLING / SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════

let billingPeriod = "monthly";

function toggleBillingPeriod() {
    billingPeriod = billingPeriod === "monthly" ? "yearly" : "monthly";
    const isYearly = billingPeriod === "yearly";

    // Toggle knob position
    const knob = document.getElementById("billing-toggle-knob");
    if (knob) knob.style.transform = isYearly ? "translateX(22px)" : "translateX(0)";

    // Toggle label colors
    const labelM = document.getElementById("billing-label-monthly");
    const labelY = document.getElementById("billing-label-yearly");
    if (labelM) labelM.style.color = isYearly ? "#71717a" : "#fff";
    if (labelY) labelY.style.color = isYearly ? "#fff" : "#71717a";

    // Show/hide save badge
    const badge = document.getElementById("billing-save-badge");
    if (badge) badge.style.display = isYearly ? "inline-block" : "none";

    // Toggle price displays
    document.querySelectorAll(".billing-price-monthly").forEach(el => {
        el.style.display = isYearly ? "none" : "flex";
    });
    document.querySelectorAll(".billing-price-yearly").forEach(el => {
        el.style.display = isYearly ? "block" : "none";
    });
}

async function subscribeToPlan(plan, btnEl) {
    const btn = btnEl || (window.event && window.event.target);
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creating invoice...";

    try {
        const resp = await fetch("/api/v1/subscribe/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan, period: billingPeriod }),
        });

        let data;
        const text = await resp.text();
        try { data = JSON.parse(text); } catch (e) {
            showBillingMsg("error", `Server error (${resp.status}). Please try again.`);
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        if (resp.ok && data.invoice_url) {
            btn.textContent = "Redirecting...";
            window.open(data.invoice_url, "_blank");
            btn.disabled = false;
            btn.textContent = originalText;
        } else {
            showBillingMsg("error", data.error || "Failed to create payment. Please try again.");
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (err) {
        showBillingMsg("error", "Network error: " + err.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function showBillingMsg(type, text) {
    const el = document.getElementById("billing-msg");
    if (!el) return;
    const colors = {
        success: { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.2)", color: "#22c55e" },
        error: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)", color: "#ef4444" },
        info: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)", color: "#60a5fa" },
    };
    const c = colors[type] || colors.info;
    el.style.background = c.bg;
    el.style.border = `1px solid ${c.border}`;
    el.style.color = c.color;
    el.style.display = "block";
    el.textContent = text;
}

async function pollPlanStatus() {
    let attempts = 0;
    const maxAttempts = 60;
    const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) { clearInterval(interval); return; }

        try {
            const resp = await fetch("/api/v1/subscribe/status/");
            const data = await resp.json();

            if (data.plan && data.plan !== "free") {
                clearInterval(interval);
                showBillingMsg("success", `Your plan has been upgraded to ${data.plan.charAt(0).toUpperCase() + data.plan.slice(1)}!`);
                setTimeout(() => window.location.reload(), 2000);
            }
        } catch (err) { /* silently retry */ }
    }, 10000);
}

// Handle ?tab=billing&status=success/cancelled from payment redirect
(function checkBillingRedirect() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const status = params.get("status");

    if (tab === "billing") {
        // Switch to billing tab
        const billingBtn = document.querySelector('.sidebar-tab[data-tab="billing"]');
        if (billingBtn) billingBtn.click();

        if (status === "success") {
            setTimeout(() => {
                showBillingMsg("info", "Payment submitted! Your plan will be upgraded once the transaction is confirmed on the blockchain. This usually takes a few minutes.");
                pollPlanStatus();
            }, 100);
        } else if (status === "cancelled") {
            setTimeout(() => showBillingMsg("error", "Payment was cancelled. You can try again anytime."), 100);
        }

        // Clean URL
        if (status) {
            window.history.replaceState({}, "", "/dashboard/");
        }
    }
})();
