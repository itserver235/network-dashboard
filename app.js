// app.js - Logic for the Network Dashboard

window.pendingToggles = window.pendingToggles || {};

async function secureFetch(url, options = {}) {
    const token = localStorage.getItem("netdash_token");
    options.headers = options.headers || {};
    if (token) {
        options.headers["Authorization"] = `Bearer ${token}`;
    }
    
    try {
        const res = await fetch(url, options);
        if (res.status === 401 && !url.includes('/api/login')) {
            if (window.logout) {
                window.logout();
            } else {
                localStorage.removeItem("netdash_token");
                window.location.reload();
            }
            throw new Error("Sesi expired. Silakan login kembali.");
        }
        return res;
    } catch (e) {
        console.error("Fetch error:", e);
        throw e;
    }
}

window.toggleQueue = async function(host, id, enable) {
    try {
        const safeHost = host.replace(/\./g, '-');
        const safeId = id.replace(/\*/g, '');
        const spanId = `live-rate-${safeHost}-${safeId}`;
        window.pendingToggles[spanId] = Date.now();
        
        const statusTextElem = document.getElementById(`status-${spanId}`);
        if (statusTextElem) {
            statusTextElem.textContent = enable ? 'Aktif' : 'Non Aktif';
            statusTextElem.style.color = enable ? 'var(--success-color)' : 'var(--text-muted)';
        }

        const res = await secureFetch('/api/queue/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, id, enable })
        });
        const data = await res.json();
        if (!data.success) {
            alert('Failed to toggle queue: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error while toggling queue.');
    }
};

window.toggleFirewall = async function(host, id, enable) {
    try {
        const safeHost = host.replace(/\./g, '-');
        const safeId = id.replace(/\*/g, '');
        const spanId = `fw-${safeHost}-${safeId}`;
        window.pendingToggles[spanId] = Date.now();
        
        const statusTextElem = document.getElementById(`fw-status-${spanId}`);
        if (statusTextElem) {
            statusTextElem.textContent = enable ? 'Aktif' : 'Non Aktif';
            statusTextElem.style.color = enable ? 'var(--success-color)' : 'var(--text-muted)';
        }

        const res = await secureFetch('/api/firewall/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, id, enable })
        });
        const data = await res.json();
        if (!data.success) {
            alert('Failed to toggle firewall: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error while toggling firewall.');
    }
};

document.addEventListener("DOMContentLoaded", () => {
    // --- Live Date/Time Display ---
    let userDateFormat = localStorage.getItem("netdash_date_format") || "Default";

    function updateDateDisplay() {
        const dateElem = document.getElementById("current-date-display");
        if (dateElem) {
            const now = new Date();
            if (userDateFormat === "Default" || userDateFormat.toLowerCase() === "default") {
                const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                const dateStr = now.toLocaleDateString('id-ID', options);
                const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                dateElem.textContent = `${dateStr} ${timeStr}`;
            } else {
                const map = {
                    YYYY: now.getFullYear(),
                    YY: String(now.getFullYear()).slice(-2),
                    MM: String(now.getMonth() + 1).padStart(2, '0'),
                    M: now.getMonth() + 1,
                    DD: String(now.getDate()).padStart(2, '0'),
                    D: now.getDate(),
                    HH: String(now.getHours()).padStart(2, '0'),
                    hh: String(now.getHours() % 12 || 12).padStart(2, '0'),
                    mm: String(now.getMinutes()).padStart(2, '0'),
                    ss: String(now.getSeconds()).padStart(2, '0'),
                    A: now.getHours() >= 12 ? 'PM' : 'AM'
                };
                dateElem.textContent = userDateFormat.replace(/YYYY|YY|MM|M|DD|D|HH|hh|mm|ss|A/g, match => map[match]);
            }
        }
    }
    
    const dateElem = document.getElementById("current-date-display");
    if (dateElem) {
        dateElem.style.cursor = "pointer";
        dateElem.title = "Klik untuk mengubah format tanggal";
        dateElem.addEventListener("click", () => {
            const promptText = "Kustomisasi Format Waktu:\n\nKode Tersedia:\nYYYY (Tahun 4 digit)\nYY (Tahun 2 digit)\nMM (Bulan 01-12)\nDD (Hari 01-31)\nHH (Jam 24-format)\nhh (Jam 12-format)\nmm (Menit 00-59)\nss (Detik 00-59)\nA (AM/PM)\n\nContoh: DD/MM/YYYY HH:mm:ss\nKetik 'Default' untuk kembali ke awal.";
            const newFormat = prompt(promptText, userDateFormat);
            if (newFormat !== null && newFormat.trim() !== "") {
                userDateFormat = newFormat.trim();
                localStorage.setItem("netdash_date_format", userDateFormat);
                updateDateDisplay();
            }
        });
    }

    updateDateDisplay();
    setInterval(updateDateDisplay, 1000);

    // --- Chart Initialization ---
    function initTrafficChart() {
        const ctx = document.getElementById('trafficChart');
        if (!ctx) return;
        
        if (trafficChart) {
            trafficChart.destroy();
        }

        const isLightMode = document.body.classList.contains("light-mode");
        const gridColor = isLightMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
        const textColor = isLightMode ? '#64748b' : '#94a3b8';

        trafficChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [
                    {
                        label: 'RX (Download)',
                        data: rxData,
                        borderColor: '#34d399',
                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'TX (Upload)',
                        data: txData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 }, // prevent bouncy animation on every tick
                scales: {
                    x: {
                        grid: { display: false, color: gridColor },
                        ticks: { color: textColor, maxTicksLimit: 10 }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            callback: function(value) { return value + ' Mbps'; }
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    function initQueueChart() {
        const ctx = document.getElementById('queueChart');
        if (!ctx) return;
        
        if (queueChart) {
            queueChart.destroy();
        }

        const isLightMode = document.body.classList.contains("light-mode");
        const gridColor = isLightMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
        const textColor = isLightMode ? '#64748b' : '#94a3b8';

        queueChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: queueLabels,
                datasets: [
                    {
                        label: 'RX (Download)',
                        data: queueRxData,
                        borderColor: '#34d399',
                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'TX (Upload)',
                        data: queueTxData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                scales: {
                    x: { grid: { display: false, color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, callback: function(v) { return v + ' Mbps'; } }, beginAtZero: true }
                },
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    // --- Elements ---
    const loginContainer = document.getElementById("login-container");
    const appContainer = document.getElementById("app-container");
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const loginError = document.getElementById("login-error");
    const navLinks = document.querySelectorAll(".nav-links li");
    const viewSections = document.querySelectorAll(".view-section");
    const currentViewTitle = document.getElementById("current-view-title");
    
    // --- Initialization & State ---
    let dashboardInterval = null;
    let trafficInterval = null;
    let trafficChart = null;
    let queueChart = null;
    let queueInterval = null;
    const MAX_CHART_POINTS = 30;
    let chartLabels = Array(MAX_CHART_POINTS).fill('');
    let rxData = Array(MAX_CHART_POINTS).fill(0);
    let txData = Array(MAX_CHART_POINTS).fill(0);

    let queueLabels = Array(MAX_CHART_POINTS).fill('');
    let queueRxData = Array(MAX_CHART_POINTS).fill(0);
    let queueTxData = Array(MAX_CHART_POINTS).fill(0);

    // --- Theme Logic ---
    const themeToggleBtn = document.getElementById("theme-toggle");
    const themeIcon = document.getElementById("theme-icon");
    const themeText = document.getElementById("theme-text");
    const printBtn = document.getElementById("print-btn");

    if (printBtn) {
        printBtn.addEventListener("click", () => {
            window.print();
        });
    }
    
    // Load saved theme
    if (localStorage.getItem("netdash_theme") === "light") {
        document.body.classList.add("light-mode");
        themeIcon.textContent = "🌙";
        themeText.textContent = "Dark Mode";
    }

    themeToggleBtn.addEventListener("click", () => {
        document.body.classList.toggle("light-mode");
        if (document.body.classList.contains("light-mode")) {
            localStorage.setItem("netdash_theme", "light");
            themeIcon.textContent = "🌙";
            themeText.textContent = "Dark Mode";
        } else {
            localStorage.setItem("netdash_theme", "dark");
            themeIcon.textContent = "☀️";
            themeText.textContent = "Light Mode";
        }
    });

    // --- Restore Session on Startup ---
    function restoreSession() {
        const token = localStorage.getItem("netdash_token");
        if (token) {
            window.activeUser = "admin";
            loginContainer.style.display = "none";
            appContainer.style.display = "flex";
            initTrafficChart();
            renderDashboard();
            if (!dashboardInterval) dashboardInterval = setInterval(renderDashboard, 10000);
            if (!trafficInterval) trafficInterval = setInterval(updateTrafficChart, 2000);
        }
    }

    // --- License system removed, always show login screen ---
    const licenseContainer = document.getElementById("license-container");
    if (licenseContainer) licenseContainer.style.display = "none";
    loginContainer.style.display = "flex";

    // Run on startup
    restoreSession();

    // --- Authentication ---
    async function login() {
        const user = usernameInput.value.trim();
        const pass = passwordInput.value.trim();
        
        loginBtn.disabled = true;
        const originalBtnText = loginBtn.textContent;
        loginBtn.textContent = "Menghubungkan...";

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                // Success
                localStorage.setItem("netdash_token", data.token);
                window.activeUser = user;
                loginContainer.style.display = "none";
                appContainer.style.display = "flex";
                loginError.style.display = "none";
                usernameInput.value = "";
                passwordInput.value = "";
                initTrafficChart();
                renderDashboard(); // Initial render
                if (!dashboardInterval) dashboardInterval = setInterval(renderDashboard, 10000); // Auto-refresh every 10s
                if (!trafficInterval) trafficInterval = setInterval(updateTrafficChart, 2000); // Traffic every 2s
            } else {
                loginError.textContent = data.error || "Username atau password salah.";
                loginError.style.display = "block";
            }
        } catch (e) {
            loginError.textContent = "Koneksi server gagal.";
            loginError.style.display = "block";
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = originalBtnText;
        }
    }

    function logout() {
        localStorage.removeItem("netdash_token");
        appContainer.style.display = "none";
        loginContainer.style.display = "flex";
        if (dashboardInterval) clearInterval(dashboardInterval);
        if (trafficInterval) clearInterval(trafficInterval);
        if (queueInterval) clearInterval(queueInterval);
        dashboardInterval = null;
        trafficInterval = null;
        queueInterval = null;
        window.activeUser = null;
    }
    window.logout = logout;

    loginBtn.addEventListener("click", login);
    passwordInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") login();
    });

    logoutBtn.addEventListener("click", logout);

    // --- Navigation ---
    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            // Update active link
            navLinks.forEach(nav => nav.classList.remove("active"));
            link.classList.add("active");

            // Update title
            currentViewTitle.textContent = link.textContent;

            // Clear all intervals once before switching views
            if (dashboardInterval) clearInterval(dashboardInterval);
            if (trafficInterval) clearInterval(trafficInterval);
            if (queueInterval) clearInterval(queueInterval);
            dashboardInterval = null;
            trafficInterval = null;
            queueInterval = null;

            // Show target section
            const targetId = link.getAttribute("data-target");
            viewSections.forEach(section => {
                if (section.id === targetId) {
                    section.classList.add("active");
                } else {
                    section.classList.remove("active");
                }
            });

            // Render specific data
            if (targetId === "view-dashboard") {
                initTrafficChart();
                renderDashboard();
                updateTrafficChart();
                if (!dashboardInterval) dashboardInterval = setInterval(renderDashboard, 10000);
                if (!trafficInterval) trafficInterval = setInterval(updateTrafficChart, 2000);
            } else {
                if (targetId === "view-ip") renderIpList();
                if (targetId === "view-firewall") renderFirewallList();
                if (targetId === "view-queue") {
                    initQueueChart();
                    renderQueueList();
                    if (!queueInterval) queueInterval = setInterval(() => {
                        updateQueueChart();
                        updateQueueTableRates();
                    }, 2000);
                }
                if (targetId === "view-ping") renderPingView();
                if (targetId === "view-gps") renderGpsView();
                if (targetId === "view-speedtest") renderSpeedTest();
                if (targetId === "view-logs") renderLogs();
                if (targetId === "view-users") renderUserList();
                if (targetId === "view-reports") renderReports();
            }
        });
    });

    // --- Speed Test Logic ---
    async function renderSpeedTest() {
        const routerSelect = document.getElementById("speedtest-router-select");
        const btn = document.getElementById("run-speedtest-btn");
        const resultContainer = document.getElementById("speedtest-result-container");
        
        // Load routers if not loaded
        if (routerSelect.options.length <= 1) {
            routerSelect.innerHTML = "<option value=''>Memuat daftar router...</option>";
            const dashboardData = await fetchFromAPI('dashboard');
            routerSelect.innerHTML = "";
            if (dashboardData && dashboardData.length > 0) {
                dashboardData.forEach(r => {
                    const opt = document.createElement("option");
                    opt.value = r.ip;
                    opt.textContent = `${r.name} (${r.ip})`;
                    routerSelect.appendChild(opt);
                });
            } else {
                routerSelect.innerHTML = "<option value=''>Tidak ada router tersedia</option>";
            }
        }

        btn.onclick = async () => {
            const host = routerSelect.value;
            const targetIp = document.getElementById("speedtest-server-ip").value.trim();
            
            if (!host) {
                alert("Pilih router terlebih dahulu!");
                return;
            }

            const originalText = btn.innerHTML;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Sedang Menguji... (15-30s)`;
            btn.disabled = true;
            btn.style.opacity = "0.7";
            resultContainer.style.display = "none";

            try {
                const res = await secureFetch('/api/speedtest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ host, targetIp })
                });

                const data = await res.json();
                
                if (res.ok && data.success) {
                    document.getElementById("st-rx").textContent = data.rx || "0 Mbps";
                    document.getElementById("st-tx").textContent = data.tx || "0 Mbps";
                    document.getElementById("st-ping").textContent = data.ping || "-";
                    document.getElementById("st-loss").textContent = data.loss || "0%";
                    resultContainer.style.display = "block";
                } else {
                    alert("Speed Test Gagal: " + (data.error || "Unknown error"));
                }
            } catch (err) {
                alert("Koneksi ke server gagal.");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.opacity = "1";
            }
        };
    }

    // --- Rendering Logic ---

    function getStatusBadge(status) {
        if (status === "Online" || status === "Active") return `<span class="badge success">${status}</span>`;
        if (status === "Offline" || status === "Inactive" || status === "Drop") return `<span class="badge danger">${status}</span>`;
        if (status === "Free") return `<span class="badge success">${status}</span>`;
        return `<span class="badge warning">${status}</span>`;
    }

    function playWarningSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContext();
            
            function playBeep(time, freq) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'square';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.1, time);
                gain.gain.exponentialRampToValueAtTime(0.00001, time + 0.5);
                osc.start(time);
                osc.stop(time + 0.5);
            }
            // 3 quick warning beeps
            playBeep(ctx.currentTime, 400);
            playBeep(ctx.currentTime + 0.2, 400);
            playBeep(ctx.currentTime + 0.4, 400);
        } catch(e) {}
    }

    function playSuccessSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContext();
            
            function playBeep(time, freq, dur) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.1, time);
                gain.gain.exponentialRampToValueAtTime(0.00001, time + dur);
                osc.start(time);
                osc.stop(time + dur);
            }
            // Pleasant success chime
            playBeep(ctx.currentTime, 523.25, 0.2); // C5
            playBeep(ctx.currentTime + 0.15, 659.25, 0.3); // E5
        } catch(e) {}
    }

    function showSystemNotification(title, body) {
        // Disabled per user request
        return;
    }

    // (System Notification permission request removed per user request)

    let isOffline = false;
    function setOfflineState(offline) {
        if (isOffline === offline) return;
        isOffline = offline;
        
        // Banner UI disabled per user request
        
        // Sounds and system notifications disabled per user request
    }

    window.addEventListener('offline', () => setOfflineState(true));
    window.addEventListener('online', () => setOfflineState(false));

    async function fetchFromAPI(endpoint) {
        try {
            const res = await secureFetch(`/api/${endpoint}`);
            if (!res.ok) throw new Error('API Error');
            if (isOffline && navigator.onLine) setOfflineState(false);
            return await res.json();
        } catch (e) {
            console.error(e);
            setOfflineState(true);
            return null;
        }
    }

    // --- Global Router Health Monitoring ---
    let routerStates = {};

    async function checkRouterHealth() {
        if (isOffline) return; // If whole API is down, skip individual router checks

        try {
            const res = await secureFetch('/api/dashboard');
            if (!res.ok) return;
            const data = await res.json();
            
            data.forEach(router => {
                const host = router.ip;
                const name = router.name;
                const status = router.status; // "Online" or "Offline"
                
                if (routerStates[host] && routerStates[host] !== status) {
                    if (status === 'Offline') {
                        // Notifications disabled
                    } else if (status === 'Online') {
                        // Notifications disabled
                    }
                }
                routerStates[host] = status;
            });
        } catch(e) {}
    }

    // Run health check every 15 seconds in the background
    setInterval(checkRouterHealth, 15000);
    setTimeout(checkRouterHealth, 2000);

    // --- Dedicated Traffic Chart Updater ---
    async function updateTrafficChart() {
        if (document.getElementById("view-dashboard").classList.contains("active")) {
            const traffic = await fetchFromAPI('traffic');
            if (traffic && trafficChart) {
                let totalRx = 0;
                let totalTx = 0;
                
                const selector = document.getElementById("traffic-router-select");
                const selectedHost = selector ? selector.value : "all";

                traffic.forEach(t => {
                    if (selectedHost === "all" || t.routerHost === selectedHost) {
                        totalRx += t.rx;
                        totalTx += t.tx;
                    }
                });
                
                // Convert bps to Mbps
                const rxMbps = (totalRx / 1000000).toFixed(2);
                const txMbps = (totalTx / 1000000).toFixed(2);
                
                const rxElem = document.getElementById('chart-rx-text');
                const txElem = document.getElementById('chart-tx-text');
                if (rxElem) rxElem.textContent = rxMbps + " Mbps";
                if (txElem) txElem.textContent = txMbps + " Mbps";

                const now = new Date();
                const timeLabel = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');

                chartLabels.push(timeLabel);
                chartLabels.shift();
                
                rxData.push(rxMbps);
                rxData.shift();
                
                txData.push(txMbps);
                txData.shift();

                trafficChart.update();
            }
        }
    }

    // Clear chart memory when dropdown changes
    document.getElementById("traffic-router-select")?.addEventListener("change", () => {
        chartLabels.fill('');
        rxData.fill(0);
        txData.fill(0);
        if (trafficChart) trafficChart.update();
    });

    async function renderDashboard() {
        const grid = document.getElementById("dashboard-grid");
        
        const data = await fetchFromAPI('dashboard');

        // --- Handle Dashboard Grid ---
        if (!data) {
            grid.innerHTML = "<div style='grid-column: 1/-1; text-align: center; color: var(--danger-color);'>Failed to load data. Ensure backend is running and connected.</div>";
            return;
        }

        // Populate the traffic chart dropdown if it hasn't been populated
        const selector = document.getElementById("traffic-router-select");
        if (selector && selector.options.length <= 1) {
            data.forEach(dev => {
                const opt = document.createElement("option");
                opt.value = dev.ip;
                opt.textContent = `${dev.name} (${dev.ip})`;
                selector.appendChild(opt);
            });
        }

        let newHtml = "";
        let offlineTimes = JSON.parse(localStorage.getItem('netdash_downtime') || '{}');
        let timesChanged = false;

        data.forEach(dev => {
            const host = dev.ip;
            let uptimeDisplay = `<div><span style="color:var(--text-muted)">Uptime:</span> ${dev.uptime}</div>`;

            if (dev.status === "Offline" || dev.status === "Loss") {
                if (!offlineTimes[host]) {
                    offlineTimes[host] = Date.now();
                    timesChanged = true;
                }
                const diffSecs = Math.floor((Date.now() - offlineTimes[host]) / 1000);
                const h = Math.floor(diffSecs / 3600);
                const m = Math.floor((diffSecs % 3600) / 60);
                const s = diffSecs % 60;
                let downStr = "";
                if (h > 0) downStr += `${h}h `;
                if (m > 0 || h > 0) downStr += `${m}m `;
                downStr += `${s}s`;
                
                uptimeDisplay = `<div><span style="color:var(--danger-color); font-weight:600;">Downtime:</span> <span style="color:var(--danger-color); font-weight:600;">${downStr}</span></div>`;
            } else {
                if (offlineTimes[host]) {
                    delete offlineTimes[host];
                    timesChanged = true;
                }
            }

            newHtml += `
                <div class="glass stat-card">
                    <div class="stat-header">
                        <span class="stat-title">${dev.name} (${dev.id})</span>
                        ${getStatusBadge(dev.status)}
                    </div>
                    <div style="margin-top: 10px; display:flex; flex-direction:column; gap:5px; font-size:14px;">
                        <div><span style="color:var(--text-muted)">IP:</span> ${dev.ip}</div>
                        ${uptimeDisplay}
                        <div><span style="color:var(--text-muted)">CPU:</span> ${dev.cpu}</div>
                    </div>
                    <button class="restart-btn" data-host="${dev.ip}" style="margin-top: 15px; padding: 8px; font-size: 13px; background: var(--danger-color); border: none; border-radius: 6px; color: white; cursor: pointer;">Restart Router</button>
                </div>
            `;
        });
        
        if (timesChanged) {
            localStorage.setItem('netdash_downtime', JSON.stringify(offlineTimes));
        }
        
        grid.innerHTML = newHtml;
    }

    // --- Restart Logic (Event Delegation) ---
    document.getElementById("dashboard-grid").addEventListener("click", async (e) => {
        if (e.target.classList.contains("restart-btn")) {
            const host = e.target.getAttribute("data-host");
            if (confirm(`⚠️ Are you sure you want to RESTART the router at ${host}?\nThis will disconnect your session momentarily.`)) {
                const btn = e.target;
                const originalText = btn.innerText;
                btn.innerText = "Restarting...";
                btn.disabled = true;
                btn.style.opacity = 0.5;

                try {
                    const res = await secureFetch('/api/restart', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ host })
                    });
                    const data = await res.json();
                    
                    if (data.success) {
                        btn.innerText = "Restarted";
                        btn.style.background = "var(--success-color)";
                    } else {
                        alert("Error: " + data.error);
                    }
                } catch (error) {
                    alert("Failed to send restart command.");
                } finally {
                    btn.innerText = originalText;
                    btn.disabled = false;
                    btn.style.opacity = 1;
                }
            }
        }
    });

    async function renderIpList() {
        const container = document.getElementById("view-ip");
        container.innerHTML = "<div style='text-align: center; color: var(--text-muted); padding: 20px;'>Loading realtime IPs from all routers...</div>";

        const routers = await fetchFromAPI('ips');
        container.innerHTML = "";

        if (!routers || routers.length === 0) {
            container.innerHTML = "<div style='text-align: center; color: var(--danger-color); padding: 20px;'>Failed to load data or no active routers.</div>";
            return;
        }

        routers.forEach(router => {
            const section = document.createElement("div");
            section.className = "glass table-container";
            section.style.marginBottom = "24px";
            
            let tbodyHTML = "";
            if (router.data.length === 0) {
                tbodyHTML = "<tr><td colspan='4' style='text-align:center; color:var(--text-muted);'>No IPs found</td></tr>";
            } else {
                // Group IPs by VLAN / Interface
                const grouped = {};
                router.data.forEach(item => {
                    const vlan = item.device || "Unknown";
                    if (!grouped[vlan]) grouped[vlan] = [];
                    grouped[vlan].push(item);
                });

                // Generate table rows sorted by VLAN
                for (const vlan of Object.keys(grouped).sort()) {
                    // Group Header
                    tbodyHTML += `
                        <tr style="background: rgba(59, 130, 246, 0.08);">
                            <td colspan="4" style="font-weight: 600; color: var(--primary-color); border-bottom: 1px solid rgba(59, 130, 246, 0.3);">
                                📁 Interface / VLAN: ${vlan}
                                <span style="float:right; font-size: 12px; color: var(--text-muted);">${grouped[vlan].length} IP(s)</span>
                            </td>
                        </tr>
                    `;
                    // Rows for this group
                    grouped[vlan].forEach(item => {
                        tbodyHTML += `
                            <tr>
                                <td style="font-family: monospace; padding-left: 30px;">${item.ip}</td>
                                <td>${getStatusBadge(item.status)}</td>
                                <td>${item.device}</td>
                                <td style="font-family: monospace; color: var(--text-muted);">${item.mac}</td>
                            </tr>
                        `;
                    });
                }
            }

            section.innerHTML = `
                <h3 style="padding: 16px; border-bottom: 1px solid var(--card-border); color: var(--text-color);">${router.routerName}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>IP Address</th>
                            <th>Status</th>
                            <th>Device Name</th>
                            <th>MAC Address</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHTML}
                    </tbody>
                </table>
            `;
            container.appendChild(section);
        });
    }

    async function renderFirewallList() {
        const container = document.getElementById("view-firewall");
        container.innerHTML = "<div style='text-align: center; color: var(--text-muted); padding: 20px;'>Loading realtime firewalls from all routers...</div>";

        const routers = await fetchFromAPI('firewalls');
        container.innerHTML = "";

        if (!routers || routers.length === 0) {
            container.innerHTML = "<div style='text-align: center; color: var(--danger-color); padding: 20px;'>Failed to load data or no active routers.</div>";
            return;
        }

        routers.forEach(router => {
            const section = document.createElement("div");
            section.className = "glass table-container";
            section.style.marginBottom = "24px";
            
            let tbodyHTML = "";
            if (router.data.length === 0) {
                tbodyHTML = "<tr><td colspan='8' style='text-align:center; color:var(--text-muted);'>No firewall rules found</td></tr>";
            } else {
                router.data.forEach(fw => {
                    const safeHost = router.routerHost.replace(/\./g, '-');
                    const safeId = fw.id.replace(/\*/g, '');
                    const spanId = `fw-${safeHost}-${safeId}`;
                    const actionColor = fw.action === "Allow" || fw.action === "accept" ? "color: var(--success-color);" : "color: var(--danger-color);";
                    
                    tbodyHTML += `
                        <tr>
                            <td>${fw.id}</td>
                            <td>${fw.ruleName}</td>
                            <td><span class="badge" style="background: rgba(255,255,255,0.1); color: var(--text-color); border: 1px solid rgba(255,255,255,0.2);">${fw.interface}</span></td>
                            <td style="font-family: monospace;">${fw.source}</td>
                            <td style="font-family: monospace;">${fw.destination}</td>
                            <td>${fw.port}</td>
                            <td style="font-weight: 600; ${actionColor}">${fw.action}</td>
                            <td style="display: flex; align-items: center; gap: 8px;">
                                <label class="switch">
                                    <input type="checkbox" id="fw-switch-${spanId}" onchange="toggleFirewall('${router.routerHost}', '${fw.id}', this.checked)" ${fw.status === 'Active' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span id="fw-status-${spanId}" style="font-size: 13px; font-weight: 600; color: ${fw.status === 'Active' ? 'var(--success-color)' : 'var(--text-muted)'};">
                                    ${fw.status === 'Active' ? 'Aktif' : 'Non Aktif'}
                                </span>
                            </td>
                        </tr>
                    `;
                });
            }

            section.innerHTML = `
                <h3 style="padding: 16px; border-bottom: 1px solid var(--card-border); color: var(--text-color);">${router.routerName}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Rule ID</th>
                            <th>Rule Name</th>
                            <th>VLAN / Interface</th>
                            <th>Source IP</th>
                            <th>Dest IP</th>
                            <th>Port</th>
                            <th>Action</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHTML}
                    </tbody>
                </table>
            `;
            container.appendChild(section);
        });
    }
    let lastQueueData = [];

    async function renderQueueList() {
        const container = document.getElementById("queue-list-container");
        if (!container) return;
        container.innerHTML = "<div style='text-align: center; color: var(--text-muted); padding: 20px;'>Loading realtime Simple Queues from all routers...</div>";

        const routers = await fetchFromAPI('queue');
        container.innerHTML = "";
        lastQueueData = routers || [];

        if (!routers || routers.length === 0) {
            container.innerHTML = "<div style='text-align: center; color: var(--danger-color); padding: 20px;'>Failed to load data or no active routers.</div>";
            return;
        }

        const routerSelect = document.getElementById("queue-chart-router");
        if (routerSelect && routerSelect.options.length <= 1) {
            routers.forEach(r => {
                const opt = document.createElement("option");
                opt.value = r.routerHost;
                opt.textContent = `${r.routerName} (${r.routerHost})`;
                routerSelect.appendChild(opt);
            });
        }

        routers.forEach(router => {
            const section = document.createElement("div");
            section.className = "glass table-container";
            section.style.marginBottom = "24px";
            
            let tbodyHTML = "";
            if (router.data.length === 0) {
                tbodyHTML = "<tr><td colspan='7' style='text-align:center; color:var(--text-muted);'>No simple queues found</td></tr>";
            } else {
                router.data.forEach(q => {
                    // Current Live Rate formatting
                    const rxMbps = (q.rateRx / 1000000).toFixed(2);
                    const txMbps = (q.rateTx / 1000000).toFixed(2);
                    const currentRateStr = `▼ ${rxMbps} / ▲ ${txMbps} Mbps`;
                    const spanId = `live-rate-${router.routerHost.replace(/\./g, '-')}-${q.id.replace(/\*/g, '')}`;

                    function formatLimit(limitStr) {
                        if (!limitStr || limitStr === "0/0" || limitStr === "-") return '<span style="color:var(--success-color); font-size: 12px;">Unlimited</span>';
                        const parts = limitStr.split("/");
                        if (parts.length !== 2) return limitStr;
                        const tx = parseInt(parts[0]);
                        const rx = parseInt(parts[1]);
                        const formatBits = (b) => {
                            if (b >= 1000000) return (b / 1000000) + "M";
                            if (b >= 1000) return (b / 1000) + "k";
                            return b;
                        };
                        return `▲ ${formatBits(tx)} / ▼ ${formatBits(rx)}`;
                    }

                    tbodyHTML += `
                        <tr>
                            <td>${q.id}</td>
                            <td>${q.name}</td>
                            <td style="font-family: monospace; max-width: 250px; white-space: normal; word-break: break-word; line-height: 1.4;">${q.target}</td>
                            <td style="font-weight: 600; color: var(--warning-color); font-size: 13px;">${formatLimit(q.maxLimit)}</td>
                            <td><span id="${spanId}" style="font-size: 13px; color: var(--success-color); transition: color 0.3s;">${currentRateStr}</span></td>

                            <td style="color: var(--text-muted); font-size: 13px;">${formatLimit(q.burstLimit)}</td>
                            <td style="display: flex; align-items: center; gap: 8px;">
                                <label class="switch">
                                    <input type="checkbox" id="switch-${spanId}" onchange="toggleQueue('${router.routerHost}', '${q.id}', this.checked)" ${q.status === 'Active' ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                                <span id="status-${spanId}" style="font-size: 13px; font-weight: 600; color: ${q.status === 'Active' ? 'var(--success-color)' : 'var(--text-muted)'};">
                                    ${q.status === 'Active' ? 'Aktif' : 'Non Aktif'}
                                </span>
                            </td>
                        </tr>
                    `;
                });
            }

            section.innerHTML = `
                <h3 style="padding: 16px; border-bottom: 1px solid var(--card-border); color: var(--text-color);">${router.routerName}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Queue Name</th>
                            <th>Target IP</th>
                            <th>Max Limit (Up/Down)</th>
                            <th>Burst Limit</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHTML}
                    </tbody>
                </table>
            `;
            container.appendChild(section);
        });
    }

    // --- Render System Logs ---
    async function renderLogs() {
        const container = document.getElementById("view-logs");
        container.innerHTML = "<div style='text-align: center; color: var(--text-muted); padding: 20px;'>Loading system logs from all routers...</div>";

        let routers = await fetchFromAPI('logs');
        if (!routers) routers = [];

        container.innerHTML = "";

        if (routers.length === 0) {
            container.innerHTML = "<div style='text-align: center; color: var(--danger-color); padding: 20px;'>Failed to load logs or no active routers.</div>";
            return;
        }

        routers.forEach(router => {
            const section = document.createElement("div");
            section.className = "glass table-container";
            section.style.marginBottom = "24px";
            
            let tbodyHTML = "";
            let downtimeHTML = "";
            let offlineTimes = JSON.parse(localStorage.getItem('netdash_downtime') || '{}');
            
            if (offlineTimes[router.routerHost]) {
                const diffSecs = Math.floor((Date.now() - offlineTimes[router.routerHost]) / 1000);
                const h = Math.floor(diffSecs / 3600);
                const m = Math.floor((diffSecs % 3600) / 60);
                const s = diffSecs % 60;
                let downStr = "";
                if (h > 0) downStr += `${h}h `;
                if (m > 0 || h > 0) downStr += `${m}m `;
                downStr += `${s}s`;
                
                const now = new Date(offlineTimes[router.routerHost]);
                const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');

                downtimeHTML = `
                    <tr style="background: rgba(239, 68, 68, 0.1);">
                        <td style="white-space: nowrap; font-family: monospace; color: var(--danger-color); font-weight: bold;">${timeStr}</td>
                        <td><span class="badge danger">system, critical, downtime</span></td>
                        <td style="font-family: monospace; color: var(--danger-color); font-weight: bold;">ROUTER OFFLINE - Current Downtime: ${downStr}</td>
                    </tr>
                `;
            }

            if (router.data.length === 0 && !downtimeHTML) {
                tbodyHTML = "<tr><td colspan='3' style='text-align:center; color:var(--text-muted);'>No logs found</td></tr>";
            } else {
                tbodyHTML += downtimeHTML;
                router.data.forEach(item => {
                    let badgeClass = "badge";
                    let badgeStyle = "background: rgba(255,255,255,0.1); color: var(--text-muted);";
                    
                    if (item.topics.includes('error') || item.topics.includes('critical') || item.topics.includes('warning')) {
                        badgeClass = "badge danger";
                        badgeStyle = "";
                    } else if (item.topics.includes('info')) {
                        badgeClass = "badge success";
                        badgeStyle = "";
                    }

                    tbodyHTML += `
                        <tr>
                            <td style="white-space: nowrap; font-family: monospace; color: var(--text-muted);">${item.time}</td>
                            <td><span class="${badgeClass}" style="${badgeStyle}">${item.topics}</span></td>
                            <td style="font-family: monospace;">${item.message}</td>
                        </tr>
                    `;
                });
            }

            section.innerHTML = `
                <h3 style="padding: 16px; border-bottom: 1px solid var(--card-border); color: var(--text-color);">${router.routerName}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Topics</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHTML}
                    </tbody>
                </table>
            `;
            container.appendChild(section);
        });
    }

    // --- Queue Chart Handlers ---
    document.getElementById("queue-chart-router")?.addEventListener("change", (e) => {
        const host = e.target.value;
        const ruleSelect = document.getElementById("queue-chart-rule");
        if (!ruleSelect) return;
        
        ruleSelect.innerHTML = '<option value="">Select Queue...</option>';
        if (host) {
            ruleSelect.disabled = false;
            const router = lastQueueData.find(r => r.routerHost === host);
            if (router) {
                router.data.forEach(q => {
                    const opt = document.createElement("option");
                    opt.value = q.name;
                    opt.textContent = q.name;
                    ruleSelect.appendChild(opt);
                });
            }
        } else {
            ruleSelect.disabled = true;
        }
        queueLabels.fill(''); queueRxData.fill(0); queueTxData.fill(0);
        if(queueChart) queueChart.update();
    });

    document.getElementById("queue-chart-rule")?.addEventListener("change", () => {
        queueLabels.fill(''); queueRxData.fill(0); queueTxData.fill(0);
        if(queueChart) queueChart.update();
    });

    async function updateQueueChart() {
        if (!document.getElementById("view-queue").classList.contains("active")) return;
        
        const routerHost = document.getElementById("queue-chart-router")?.value;
        const queueName = document.getElementById("queue-chart-rule")?.value;

        if (!routerHost || !queueName) return;

        try {
            const req = await secureFetch('/api/queue-traffic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host: routerHost, queueName: queueName })
            });
            const data = await req.json();

            if (data && queueChart && !data.error) {
                const rxMbps = (data.rx / 1000000).toFixed(2);
                const txMbps = (data.tx / 1000000).toFixed(2);

                const rxElem = document.getElementById('queue-rx-text');
                const txElem = document.getElementById('queue-tx-text');
                if (rxElem) rxElem.textContent = rxMbps + " Mbps";
                if (txElem) txElem.textContent = txMbps + " Mbps";

                const now = new Date();
                const timeLabel = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');

                queueLabels.push(timeLabel); queueLabels.shift();
                queueRxData.push(rxMbps); queueRxData.shift();
                queueTxData.push(txMbps); queueTxData.shift();

                queueChart.update();
            }
        } catch(e) {}
    }

    async function updateQueueTableRates() {
        if (!document.getElementById("view-queue").classList.contains("active")) return;
        try {
            const routers = await fetchFromAPI('queue');
            if (!routers) return;
            lastQueueData = routers;
            routers.forEach(router => {
                router.data.forEach(q => {
                    const spanId = `live-rate-${router.routerHost.replace(/\./g, '-')}-${q.id.replace(/\*/g, '')}`;
                    const span = document.getElementById(spanId);
                    if (span) {
                        const rxMbps = (q.rateRx / 1000000).toFixed(2);
                        const txMbps = (q.rateTx / 1000000).toFixed(2);
                        span.textContent = `▼ ${rxMbps} / ▲ ${txMbps} Mbps`;
                        span.style.color = "var(--primary-color)";
                        setTimeout(() => span.style.color = "var(--success-color)", 500);
                    }
                    
                    const switchElem = document.getElementById(`switch-${spanId}`);
                    const statusTextElem = document.getElementById(`status-${spanId}`);
                    if (switchElem && statusTextElem) {
                        const pendingTime = window.pendingToggles ? window.pendingToggles[spanId] : 0;
                        if (!pendingTime || Date.now() - pendingTime > 5000) {
                            const isActive = q.status === 'Active';
                            if (switchElem.checked !== isActive) switchElem.checked = isActive;
                            statusTextElem.textContent = isActive ? 'Aktif' : 'Non Aktif';
                            statusTextElem.style.color = isActive ? 'var(--success-color)' : 'var(--text-muted)';
                        }
                    }
                });
            });
        } catch(e) {}
    }

    // --- Ping Logic ---
    let pingRoutersLoaded = false;
    async function renderPingView() {
        if (pingRoutersLoaded) return;
        const select = document.getElementById("ping-router");
        const data = await fetchFromAPI('dashboard');
        if (data && data.length > 0) {
            data.forEach(dev => {
                const opt = document.createElement("option");
                opt.value = dev.ip;
                opt.textContent = `${dev.name} (${dev.ip})`;
                select.appendChild(opt);
            });
            pingRoutersLoaded = true;
        }
    }

    document.getElementById("start-ping-btn").addEventListener("click", async () => {
        const target = document.getElementById("ping-target").value.trim();
        const host = document.getElementById("ping-router").value;
        const resultsDiv = document.getElementById("ping-results");

        if (!target) {
            alert("Please enter a Target IP or Domain");
            return;
        }

        const btn = document.getElementById("start-ping-btn");
        btn.innerText = "Pinging...";
        btn.disabled = true;
        resultsDiv.innerHTML = "<div style='color: var(--text-muted);'>Executing ping on router(s)... Please wait.</div>";

        try {
            const res = await secureFetch('/api/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host, target })
            });
            const data = await res.json();
            
            if (res.ok) {
                resultsDiv.innerHTML = "";
                if (data.length === 0) {
                    resultsDiv.innerHTML = "<div style='color: var(--danger-color);'>No response from any router.</div>";
                }
                
                data.forEach(routerRes => {
                    const block = document.createElement("div");
                    block.style.marginBottom = "20px";
                    block.style.padding = "15px";
                    block.style.background = "rgba(0,0,0,0.2)";
                    block.style.borderRadius = "8px";
                    
                    let preText = "";
                    if (!routerRes.data || routerRes.data.length === 0) {
                        preText = "No response or timeout.";
                    } else {
                        routerRes.data.forEach(p => {
                            if (p.host) {
                                preText += `Reply from ${p.host}: seq=${p.seq || 0} size=${p.size || 0} time=${p.time || 'unknown'} \n`;
                            } else {
                                preText += JSON.stringify(p) + "\\n";
                            }
                        });
                    }

                    block.innerHTML = `
                        <h4 style="margin-bottom: 10px; color: var(--primary-color);">${routerRes.routerName}</h4>
                        <pre style="font-family: monospace; color: var(--text-color); font-size: 13px; white-space: pre-wrap;">${preText}</pre>
                    `;
                    resultsDiv.appendChild(block);
                });
            } else {
                resultsDiv.innerHTML = `<div style='color: var(--danger-color);'>Error: ${data.error}</div>`;
            }
        } catch (error) {
            resultsDiv.innerHTML = "<div style='color: var(--danger-color);'>Failed to execute ping.</div>";
        } finally {
            btn.innerText = "Start Ping";
            btn.disabled = false;
        }
    });

    // --- GPS Logic ---
    let gpsMap = null;
    let mapMarkers = [];

    async function renderGpsView() {
        const mapContainer = document.getElementById("map-container");

        // Initialize Map if not already initialized
        if (!gpsMap) {
            // Default center at Indonesia
            gpsMap = L.map('map-container').setView([-2.5489, 118.0149], 5);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(gpsMap);
            
            // Fix map rendering issue when loading hidden
            setTimeout(() => gpsMap.invalidateSize(), 500);
        } else {
            setTimeout(() => gpsMap.invalidateSize(), 200);
        }

        await fetchAndPlotGps();
    }

    async function fetchAndPlotGps() {
        const btn = document.getElementById("refresh-gps-btn");
        const originalText = btn.innerText;
        btn.innerText = "Refreshing...";
        btn.disabled = true;

        const routers = await fetchFromAPI('gps');
        
        btn.innerText = originalText;
        btn.disabled = false;

        if (!routers) return;

        // Clear existing markers
        mapMarkers.forEach(m => gpsMap.removeLayer(m));
        mapMarkers = [];

        let validCount = 0;
        const bounds = L.latLngBounds();

        routers.forEach(router => {
            const manualGpsStr = localStorage.getItem('manual_gps_' + router.routerHost);
            let lat = router.latitude;
            let lng = router.longitude;
            
            if (manualGpsStr) {
                try {
                    const parsed = JSON.parse(manualGpsStr);
                    lat = parsed.lat;
                    lng = parsed.lng;
                    router.valid = "manual";
                } catch(e) {}
            }

            const parseCoord = (c) => {
                if (typeof c === 'number') return c;
                let str = String(c).trim();
                if (str === "none") return NaN;
                let multiplier = 1;
                if (str.startsWith('S') || str.startsWith('W') || str.startsWith('s') || str.startsWith('w')) {
                    multiplier = -1;
                }
                str = str.replace(/[a-zA-Z]/g, '').trim();
                return parseFloat(str) * multiplier;
            };

            let latNum = parseCoord(lat);
            let lngNum = parseCoord(lng);

            // Default to center of Indonesia if invalid so user can drag it
            if (isNaN(latNum) || isNaN(lngNum) || (latNum === 0 && lngNum === 0)) {
                latNum = -2.5489 + (Math.random() * 2 - 1);
                lngNum = 118.0149 + (Math.random() * 2 - 1);
                router.valid = "false";
            }

            const marker = L.marker([latNum, lngNum], { draggable: true, title: router.routerName }).addTo(gpsMap);
            
            let statusText = router.valid === 'manual' ? '<span style="color:var(--primary-color)">Manual (Saved)</span>' : (router.valid === 'true' ? '<span style="color:var(--success-color)">Auto (API)</span>' : '<span style="color:var(--danger-color)">Not Set (Default)</span>');
            
            marker.bindPopup(`
                <div style="text-align: center; color: #333;">
                    <b style="font-size: 14px;">${router.routerName}</b><br>
                    <span style="font-size: 12px; color: #666;">${router.routerHost}</span><br>
                    <div style="margin-top: 5px; font-size: 12px;">Status: ${statusText}</div>
                    <div style="margin-top: 5px; font-size: 11px; color: #888;"><i>Geser pin ini untuk mengatur manual</i></div>
                </div>
            `);

            marker.on('dragend', function(event) {
                const position = marker.getLatLng();
                localStorage.setItem('manual_gps_' + router.routerHost, JSON.stringify({
                    lat: position.lat,
                    lng: position.lng
                }));
                marker.getPopup().setContent(`
                    <div style="text-align: center; color: #333;">
                        <b style="font-size: 14px;">${router.routerName}</b><br>
                        <span style="font-size: 12px; color: #666;">${router.routerHost}</span><br>
                        <div style="margin-top: 5px; font-size: 12px;">Status: <span style="color:var(--primary-color)">Manual (Tersimpan)</span></div>
                        <div style="margin-top: 5px; font-size: 11px; color: #888;"><i>Lokasi berhasil disimpan!</i></div>
                    </div>
                `);
            });

            mapMarkers.push(marker);
            bounds.extend([latNum, lngNum]);
            validCount++;
        });

        if (validCount > 0) {
            gpsMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        } else {
            // Optional: Alert or notification if no GPS is valid
            // alert("No valid GPS coordinates found from the routers.");
        }
    }

    document.getElementById("refresh-gps-btn").addEventListener("click", fetchAndPlotGps);

    // --- User Management Logic ---
    async function renderUserList() {
        const tbody = document.getElementById("user-list-tbody");
        if (!tbody) return;
        
        try {
            const res = await secureFetch('/api/users');
            if (!res.ok) throw new Error("Gagal mengambil data user");
            const users = await res.json();
            
            let html = "";
            users.forEach(u => {
                const isActive = (window.activeUser === u.username);
                const statusBadge = isActive ? `<span class="badge success">Active Now</span>` : `<span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--card-border);">Offline</span>`;
                
                // Don't allow deleting the active user or the last user
                const canDelete = !isActive && users.length > 1;
                
                // Delete button
                const deleteBtn = canDelete ? `
                    <button class="delete-user-btn" data-id="${u.id}" data-user="${u.username}" title="Delete User" style="background: transparent; box-shadow: none; padding: 8px; border: 1px solid rgba(239, 68, 68, 0.3); color: var(--danger-color); border-radius: 8px; cursor: pointer; display: inline-flex; transition: all 0.2s;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                ` : `
                    <button disabled title="Cannot delete active/only user" style="background: transparent; box-shadow: none; padding: 8px; border: 1px solid var(--card-border); color: var(--text-muted); border-radius: 8px; opacity: 0.3; cursor: not-allowed; display: inline-flex;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                `;

                const initial = u.username.charAt(0).toUpperCase();
                const userRole = u.role || 'Administrator';
                let roleColor = 'var(--primary-color)';
                if (userRole === 'Operator') roleColor = 'var(--warning-color)';
                if (userRole === 'Read-Only') roleColor = 'var(--text-muted)';

                html += `
                    <tr>
                        <td>
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <div style="width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, var(--primary-color), #2563eb); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 16px; box-shadow: 0 2px 8px var(--primary-glow);">
                                    ${initial}
                                </div>
                                <span style="font-weight: 600; font-size: 15px; color: var(--text-color);">${u.username}</span>
                            </div>
                        </td>
                        <td style="color: ${roleColor}; font-weight: 500;">${userRole}</td>
                        <td>${statusBadge}</td>
                        <td style="text-align: right;">${deleteBtn}</td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;

            document.querySelectorAll(".delete-user-btn").forEach(btn => {
                btn.addEventListener("click", async (e) => {
                    const id = e.currentTarget.getAttribute("data-id");
                    const username = e.currentTarget.getAttribute("data-user");
                    if (confirm(`Are you sure you want to delete user '${username}'?`)) {
                        try {
                            const delRes = await secureFetch(`/api/users/delete/${id}`, { method: 'DELETE' });
                            if (delRes.ok) {
                                renderUserList();
                            } else {
                                alert("Failed to delete user.");
                            }
                        } catch(err) {
                            alert("Error: " + err.message);
                        }
                    }
                });
            });
        } catch (error) {
            console.error(error);
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--danger-color);">Error loading users</td></tr>`;
        }
    }

    const addUserBtn = document.getElementById("add-user-btn");
    const addUserMsg = document.getElementById("add-user-msg");
    const showAddUserBtn = document.getElementById("show-add-user-btn");
    const cancelAddUserBtn = document.getElementById("cancel-add-user-btn");
    const addUserForm = document.getElementById("add-user-form-container");

    if (showAddUserBtn) {
        showAddUserBtn.addEventListener("click", () => {
            addUserForm.style.display = "block";
            showAddUserBtn.style.display = "none";
        });
    }

    if (cancelAddUserBtn) {
        cancelAddUserBtn.addEventListener("click", () => {
            addUserForm.style.display = "none";
            showAddUserBtn.style.display = "flex";
            document.getElementById("new-username").value = "";
            document.getElementById("new-password").value = "";
            addUserMsg.textContent = "";
        });
    }
    
    if (addUserBtn) {
        addUserBtn.addEventListener("click", async () => {
            const newUsername = document.getElementById("new-username").value.trim();
            const newPassword = document.getElementById("new-password").value.trim();
            const newRole = document.getElementById("new-role") ? document.getElementById("new-role").value : "Administrator";
            
            if (!newUsername || !newPassword) {
                addUserMsg.textContent = "Please fill in all fields.";
                addUserMsg.style.color = "var(--danger-color)";
                return;
            }

            try {
                const res = await secureFetch('/api/users/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole })
                });
                
                const data = await res.json();
                
                if (res.ok && data.success) {
                    addUserMsg.textContent = "User added successfully!";
                    addUserMsg.style.color = "var(--success-color)";
                    
                    setTimeout(() => { 
                        addUserForm.style.display = "none";
                        showAddUserBtn.style.display = "flex";
                        document.getElementById("new-username").value = "";
                        document.getElementById("new-password").value = "";
                        addUserMsg.textContent = "";
                    }, 1500);
                    
                    renderUserList();
                } else {
                    addUserMsg.textContent = data.error || "Failed to add user.";
                    addUserMsg.style.color = "var(--danger-color)";
                }
            } catch(e) {
                addUserMsg.textContent = "Error connecting to server.";
                addUserMsg.style.color = "var(--danger-color)";
            }
        });
    }

    const changePassBtn = document.getElementById("change-pass-btn");
    const changePassMsg = document.getElementById("change-pass-msg");
    
    if (changePassBtn) {
        changePassBtn.addEventListener("click", async () => {
            const oldPassword = document.getElementById("old-password").value;
            const newPassword = document.getElementById("change-new-password").value;

            if (!oldPassword || !newPassword) {
                changePassMsg.textContent = "Mohon isi password lama dan baru.";
                changePassMsg.style.color = "var(--warning-color)";
                return;
            }

            changePassBtn.disabled = true;
            changePassBtn.textContent = "Updating...";

            try {
                const data = await secureFetch('/api/users/change-password', {
                    method: 'POST',
                    body: JSON.stringify({ oldPassword, newPassword })
                });

                if (data && data.success) {
                    changePassMsg.textContent = "Password berhasil diubah!";
                    changePassMsg.style.color = "var(--success-color)";
                    document.getElementById("old-password").value = "";
                    document.getElementById("change-new-password").value = "";
                } else {
                    changePassMsg.textContent = data.error || "Gagal mengubah password.";
                    changePassMsg.style.color = "var(--danger-color)";
                }
            } catch (e) {
                changePassMsg.textContent = "Error connecting to server.";
                changePassMsg.style.color = "var(--danger-color)";
            } finally {
                changePassBtn.disabled = false;
                changePassBtn.textContent = "Update Password";
                setTimeout(() => { changePassMsg.textContent = ""; }, 5000);
            }
        });
    }

    // --- Reports Logic ---
    let reportChartInstances = {};
    let currentReportPeriod = "1h";

    function initReportChart(host, ctx) {
        if (reportChartInstances[host]) {
            reportChartInstances[host].destroy();
        }

        const isLightMode = document.body.classList.contains("light-mode");
        const gridColor = isLightMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
        const textColor = isLightMode ? '#64748b' : '#94a3b8';

        reportChartInstances[host] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Availability (%)',
                        borderColor: '#34d399',
                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                        data: [],
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: {
                        grid: { display: false, color: gridColor },
                        ticks: { color: textColor, maxTicksLimit: 10 }
                    },
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            callback: function(value) { return value + '%'; }
                        }
                    }
                }
            }
        });
        return reportChartInstances[host];
    }

    async function renderReports() {
        try {
            // Fetch dashboard data to map IPs to router names
            const dashboardData = await fetchFromAPI('dashboard');
            const ipToName = {};
            if (dashboardData) {
                dashboardData.forEach(r => ipToName[r.ip] = r.name);
            }

            const res = await secureFetch(`/api/reports?period=${currentReportPeriod}`);
            const data = await res.json();
            
            const container = document.getElementById("reports-container");
            if (!container) return;

            if (!data || data.length === 0) {
                container.innerHTML = "<div style='text-align: center; color: var(--text-muted); padding: 40px;'>No history data available yet. Please wait a few minutes.</div>";
                return;
            }

            // Group by host
            const grouped = {};
            data.forEach(row => {
                if (!grouped[row.host]) grouped[row.host] = [];
                grouped[row.host].push(row);
            });

            container.innerHTML = "";

            Object.keys(grouped).forEach(host => {
                const hostData = grouped[host];
                const chartId = `reportChart-${host.replace(/\./g, '-')}`;
                const routerName = ipToName[host] || "Router";
                
                // Calculate Uptime
                let totalOnline = 0;
                let totalOffline = 0;
                
                const aggregated = {};
                hostData.forEach(row => {
                    if (!aggregated[row.time_bucket]) {
                        aggregated[row.time_bucket] = { online: 0, offline: 0 };
                    }
                    aggregated[row.time_bucket].online += row.online_count || 0;
                    aggregated[row.time_bucket].offline += row.offline_count || 0;
                    
                    totalOnline += row.online_count || 0;
                    totalOffline += row.offline_count || 0;
                });
                
                let totalChecks = totalOnline + totalOffline;
                let uptimePct = totalChecks > 0 ? ((totalOnline / totalChecks) * 100).toFixed(1) : 100;
                let downtimePct = totalChecks > 0 ? ((totalOffline / totalChecks) * 100).toFixed(1) : 0;

                const section = document.createElement("div");
                section.style.marginBottom = "32px";
                section.style.borderTop = "1px solid var(--card-border)";
                section.style.paddingTop = "24px";

                section.innerHTML = `
                    <h3 style="color: var(--text-color); margin-bottom: 16px;">${routerName} (${host})</h3>
                    <div style="height: 350px; position: relative; width: 100%;">
                        <canvas id="${chartId}"></canvas>
                    </div>
                    
                    <!-- Uptime Summary -->
                    <div style="margin-top: 24px; display: flex; gap: 24px;">
                        <div style="flex: 1; background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.2); padding: 16px; border-radius: 8px;">
                            <h4 style="color: var(--success-color); margin-bottom: 4px;">Total Uptime</h4>
                            <div style="font-size: 24px; font-weight: bold; color: var(--success-color);">${uptimePct}%</div>
                            <div style="font-size: 13px; color: var(--success-color); opacity: 0.8;">Calculated from selected period</div>
                        </div>
                        <div style="flex: 1; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); padding: 16px; border-radius: 8px;">
                            <h4 style="color: var(--danger-color); margin-bottom: 4px;">Total Downtime</h4>
                            <div style="font-size: 24px; font-weight: bold; color: var(--danger-color);">${downtimePct}%</div>
                            <div style="font-size: 13px; color: var(--danger-color); opacity: 0.8;">Calculated from selected period</div>
                        </div>
                    </div>
                `;
                
                container.appendChild(section);

                // Init chart
                const ctx = document.getElementById(chartId);
                const chartInst = initReportChart(host, ctx);

                const sortedBuckets = Object.keys(aggregated).sort((a,b) => parseInt(a) - parseInt(b));
                const labels = [];
                const availabilityData = [];

                sortedBuckets.forEach(bucket => {
                    const date = new Date(parseInt(bucket));
                    let timeStr = "";
                    if (currentReportPeriod === "1h" || currentReportPeriod === "1d") {
                        timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
                    } else {
                        timeStr = date.getDate() + '/' + (date.getMonth()+1) + ' ' + date.getHours() + ':00';
                    }
                    
                    labels.push(timeStr);
                    const total = aggregated[bucket].online + aggregated[bucket].offline;
                    const pct = total > 0 ? (aggregated[bucket].online / total) * 100 : 100;
                    availabilityData.push(pct.toFixed(1));
                });

                chartInst.data.labels = labels;
                chartInst.data.datasets[0].data = availabilityData;
                chartInst.update();
            });
        } catch (e) {
            console.error("Failed to fetch reports:", e);
        }
    }

    document.querySelectorAll(".report-filter-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".report-filter-btn").forEach(b => {
                b.classList.remove("active");
                b.style.background = "transparent";
                b.style.color = "var(--text-muted)";
            });
            const target = e.target;
            target.classList.add("active");
            target.style.background = "var(--primary-color)";
            target.style.color = "white";
            
            currentReportPeriod = target.getAttribute("data-period");
            renderReports();
        });
    });
    });

    // --- Global Table Sorting Logic ---
    document.body.addEventListener('click', (e) => {
        if (e.target.tagName === 'TH' && e.target.closest('table')) {
            const th = e.target;
            const table = th.closest('table');
            const tbody = table.querySelector('tbody');
            if (!tbody) return;

            const cols = Array.from(th.parentNode.children);
            const colIndex = cols.indexOf(th);

            let asc = th.getAttribute('data-sort') === 'asc';
            asc = !asc;

            cols.forEach(c => {
                c.removeAttribute('data-sort');
                c.innerText = c.innerText.replace(' ▲', '').replace(' ▼', '');
            });

            th.setAttribute('data-sort', asc ? 'asc' : 'desc');
            th.innerText += asc ? ' ▲' : ' ▼';

            const rows = Array.from(tbody.querySelectorAll('tr'));
            if (rows.length <= 1 && rows[0] && rows[0].innerText.includes('No data')) return;

            rows.sort((a, b) => {
                const aCol = a.children[colIndex];
                const bCol = b.children[colIndex];
                if (!aCol || !bCol) return 0;
                
                const aText = aCol.innerText.trim();
                const bText = bCol.innerText.trim();

                // IP Address Sorting
                const isIP = (str) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(str.trim());
                if (isIP(aText) && isIP(bText)) {
                    const numA = aText.split('/')[0].split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);
                    const numB = bText.split('/')[0].split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);
                    return asc ? numA - numB : numB - numA;
                }

                // Numeric Sorting
                const aNum = parseFloat(aText.replace(/[^\d.-]/g, ""));
                const bNum = parseFloat(bText.replace(/[^\d.-]/g, ""));
                const isNumericA = !isNaN(aNum) && /\d/.test(aText) && aText.length < 20 && !aText.includes(':');
                const isNumericB = !isNaN(bNum) && /\d/.test(bText) && bText.length < 20 && !bText.includes(':');

                if (isNumericA && isNumericB) {
                    return asc ? aNum - bNum : bNum - aNum;
                }

                // Fallback to string sort
                return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
            });

            tbody.innerHTML = '';
            rows.forEach(r => tbody.appendChild(r));
        }
    });
