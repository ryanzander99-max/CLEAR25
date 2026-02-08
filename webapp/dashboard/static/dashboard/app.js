/* ============================================================
   PM2.5 EWS — App Logic (All Cities Combined)
   ============================================================ */

let stations = [];
let citiesInfo = {};
let map = null;
let mapMarkers = [];
let lastResults = null;
let lastCityAlerts = null;

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

        // Fetch user's API keys
        const keysResp = await fetch("/api/v1/keys/create/", { method: "GET" });
        if (!keysResp.ok) {
            if (emptyEl) emptyEl.textContent = "Failed to load API keys";
            return;
        }

        const data = await keysResp.json();
        const keys = data.keys || [];

        if (keys.length === 0) {
            if (emptyEl) emptyEl.textContent = "No API keys yet. Create one to get started.";
            return;
        }

        listEl.innerHTML = keys.map(k => `
            <div class="api-key-item" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#18181b;border:1px solid #27272a;border-radius:8px;margin-bottom:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:500;color:#fafafa;margin-bottom:4px;">${escapeHtml(k.name || 'Unnamed key')}</div>
                    <code style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#71717a;word-break:break-all;">${k.key.substring(0, 16)}...${k.key.substring(k.key.length - 8)}</code>
                    <div style="font-size:11px;color:#52525b;margin-top:4px;">Created ${timeAgo(k.created_at)}${k.last_used ? ' · Last used ' + timeAgo(k.last_used) : ''}</div>
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
        `).join("");
    } catch (e) {
        console.error("Failed to load API keys:", e);
        if (emptyEl) emptyEl.textContent = "Failed to load API keys";
    }
}

async function createApiKey() {
    const name = prompt("Enter a name for this API key (optional):", "");
    if (name === null) return; // User cancelled

    try {
        const resp = await fetch("/api/v1/keys/create/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name || "" }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            alert(data.error || "Failed to create API key");
            return;
        }

        // Show the new key (only shown once!)
        const key = data.key;
        const copyPrompt = `Your new API key:\n\n${key}\n\nCopy this key now — you won't be able to see it again!`;

        if (navigator.clipboard) {
            await navigator.clipboard.writeText(key);
            alert(copyPrompt + "\n\n✓ Key copied to clipboard!");
        } else {
            alert(copyPrompt);
        }

        loadApiKeys(); // Refresh list
    } catch (e) {
        console.error("Failed to create API key:", e);
        alert("Failed to create API key");
    }
}

async function copyApiKey(key) {
    try {
        await navigator.clipboard.writeText(key);
        // Brief visual feedback
        const btn = event.target.closest("button");
        const originalText = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        setTimeout(() => { btn.innerHTML = originalText; }, 1500);
    } catch (e) {
        alert("Failed to copy to clipboard");
    }
}

async function revokeApiKey(key) {
    if (!confirm("Are you sure you want to revoke this API key? This cannot be undone.")) {
        return;
    }

    try {
        const resp = await fetch("/api/v1/keys/revoke/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            alert(data.error || "Failed to revoke API key");
            return;
        }

        loadApiKeys(); // Refresh list
    } catch (e) {
        console.error("Failed to revoke API key:", e);
        alert("Failed to revoke API key");
    }
}

// Load API keys when switching to API tab
document.querySelectorAll(".sidebar-tab").forEach(t => {
    t.addEventListener("click", () => {
        if (t.dataset.tab === "api" && !apiKeysLoaded) {
            apiKeysLoaded = true;
            loadApiKeys();
        }
    });
});
