/* ============================================================
   PM2.5 EWS — Rendering: table, city cards, accent, results
   ============================================================ */

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
            <span class="td-id">${st.id}</span>
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
    const root = document.documentElement;
    if (!results || results.length === 0) {
        root.style.setProperty("--accent-color", "#71717a");
        root.style.setProperty("--accent-text", "#fff");
        return;
    }
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
