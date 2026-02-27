/* ============================================================
   PM2.5 EWS — Billing / subscriptions
   ============================================================ */

let billingPeriod = "monthly";

function toggleBillingPeriod() {
    billingPeriod = billingPeriod === "monthly" ? "yearly" : "monthly";
    const isYearly = billingPeriod === "yearly";

    const knob = document.getElementById("billing-toggle-knob");
    if (knob) knob.style.transform = isYearly ? "translateX(22px)" : "translateX(0)";

    const labelM = document.getElementById("billing-label-monthly");
    const labelY = document.getElementById("billing-label-yearly");
    if (labelM) labelM.style.color = isYearly ? "#71717a" : "#fff";
    if (labelY) labelY.style.color = isYearly ? "#fff" : "#71717a";

    const badge = document.getElementById("billing-save-badge");
    if (badge) badge.style.display = isYearly ? "inline-block" : "none";

    document.querySelectorAll(".billing-price-monthly").forEach(el => {
        el.style.display = isYearly ? "none" : "flex";
    });
    document.querySelectorAll(".billing-price-yearly").forEach(el => {
        el.style.display = isYearly ? "block" : "none";
    });
}

async function subscribeToPlan(plan, btnEl) {
    const btn = btnEl;
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creating invoice...";

    // Open blank window immediately (within user gesture) so mobile browsers don't block it
    const payWindow = window.open("", "_blank");

    try {
        const resp = await fetch("/api/v1/subscribe/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan, period: billingPeriod }),
        });

        let data;
        const text = await resp.text();
        try { data = JSON.parse(text); } catch (e) {
            if (payWindow) payWindow.close();
            showBillingMsg("error", `Server error (${resp.status}). Please try again.`);
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        if (resp.ok && data.invoice_url) {
            btn.textContent = "Redirecting...";
            if (payWindow) {
                payWindow.location.href = data.invoice_url;
            } else {
                window.location.href = data.invoice_url;
            }
            btn.disabled = false;
            btn.textContent = originalText;
        } else {
            if (payWindow) payWindow.close();
            showBillingMsg("error", data.error || "Failed to create payment. Please try again.");
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (err) {
        if (payWindow) payWindow.close();
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

        if (status) window.history.replaceState({}, "", "/dashboard/");
    }
})();
