/* ============================================================
   PM2.5 EWS — API key management
   ============================================================ */

let apiKeysLoaded = false;
let apiKeyTimers = {};
let apiKeyTimerInterval = null;

const API_KEY_COLORS = [
    { border: "#3b82f6", bg: "#0a0a0a" },
    { border: "#8b5cf6", bg: "#0a0a0a" },
    { border: "#06b6d4", bg: "#0a0a0a" },
    { border: "#10b981", bg: "#0a0a0a" },
    { border: "#f59e0b", bg: "#0a0a0a" },
];

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

        if (emptyEl) emptyEl.style.display = "none";

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
        logger.error("Failed to load API keys:", e);
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

        document.getElementById("modal-create-key").style.display = "none";
        document.getElementById("new-key-display").textContent = data.key;
        document.getElementById("modal-new-key").style.display = "flex";
        loadApiKeys();
    } catch (e) {
        logger.error("Failed to create API key:", e);
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
    const confirmed = await new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.display = "flex";
        overlay.innerHTML = `
            <div class="modal-box modal-box-sm">
                <div class="modal-header"><h3>Revoke API Key?</h3></div>
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
        logger.error("Failed to revoke API key:", e);
        showToast("Failed to revoke API key", "error");
    }
}

function initApiKeyModals() {
    document.getElementById("btn-create-api-key")?.addEventListener("click", openCreateKeyModal);
    document.getElementById("modal-create-key-close")?.addEventListener("click", () => {
        document.getElementById("modal-create-key").style.display = "none";
    });
    document.getElementById("modal-create-key-cancel")?.addEventListener("click", () => {
        document.getElementById("modal-create-key").style.display = "none";
    });
    document.getElementById("modal-create-key-submit")?.addEventListener("click", submitCreateKey);

    document.getElementById("copy-new-key")?.addEventListener("click", copyNewKey);
    document.getElementById("modal-new-key-done")?.addEventListener("click", () => {
        document.getElementById("modal-new-key").style.display = "none";
    });

    document.getElementById("modal-create-key")?.addEventListener("click", (e) => {
        if (e.target.classList.contains("modal-overlay")) e.target.style.display = "none";
    });

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
