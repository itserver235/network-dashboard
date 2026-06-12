const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { RouterOSAPI } = require('node-routeros');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'reports.db'));
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS router_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        host TEXT,
        rx REAL,
        tx REAL,
        status TEXT
    )`);
});
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Setup multiple clients
const clients = [];

for (let i = 1; i <= 10; i++) {
    const host = process.env[`MIKROTIK_HOST_${i}`];
    if (!host) continue;

    const user = process.env[`MIKROTIK_USER_${i}`];
    const password = process.env[`MIKROTIK_PASS_${i}`];
    const port = parseInt(process.env[`MIKROTIK_PORT_${i}`]) || 8728;

    const client = new RouterOSAPI({ host, user, password, port });
    
    client.on('error', (err) => {
        const msg = err ? String(err.message || err) : "Unknown error";
        if (!msg.includes("Timed out")) {
            console.error(`Router ${host} Error:`, msg);
        }
        client.connected = false;
    });

    clients.push({ id: i, host, client });
}

async function runCommandOnClient(clientObj, command) {
    try {
        const executeWithTimeout = async (promiseFn, ms) => {
            let timer;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Timed out")), ms);
            });
            return Promise.race([promiseFn(), timeoutPromise]).finally(() => clearTimeout(timer));
        };

        if (!clientObj.client.connected) {
            if (clientObj.isConnecting) {
                throw new Error("SKIP_LOGS"); 
            }
            clientObj.isConnecting = true;
            try {
                await executeWithTimeout(() => clientObj.client.connect(), 3000);
            } finally {
                clientObj.isConnecting = false;
            }
        }
        return await executeWithTimeout(() => clientObj.client.write(command), 5000);
    } catch (err) {
        if (err && err.message === "SKIP_LOGS") return null; // Silent skip
        
        const msg = err ? String(err.message || err) : "Unknown error";
        if (!msg.includes("Timed out")) {
            console.error(`Error on Router ${clientObj.host}:`, msg);
        }
        try { clientObj.client.close(); } catch (e) {}
        clientObj.client.connected = false;
        clientObj.isConnecting = false;
        return null; 
    }
}

async function getRouterIdentity(c) {
    if (c.identityName) return c.identityName;
    try {
        const iden = await runCommandOnClient(c, '/system/identity/print');
        if (iden && iden[0] && iden[0].name) {
            c.identityName = iden[0].name;
            return c.identityName;
        }
    } catch(e) {}
    return `Router ${c.host}`;
}

async function getWanInterface(c) {
    if (c.wanInterface) return c.wanInterface;
    try {
        const routes = await runCommandOnClient(c, '/ip/route/print');
        if (routes) {
            const defaultRoute = routes.find(r => r['dst-address'] === '0.0.0.0/0' && (r.active === 'true' || r.active === true));
            if (defaultRoute && defaultRoute['gateway-status']) {
                const match = defaultRoute['gateway-status'].match(/via\s+(.+)$/);
                if (match && match[1]) {
                    c.wanInterface = match[1].trim();
                    return c.wanInterface;
                }
            }
        }
        
        // Fallback: Just grab the first running interface
        const ifaces = await runCommandOnClient(c, '/interface/print');
        if (ifaces) {
            const running = ifaces.find(i => i.running === 'true' || i.running === true);
            if (running) {
                c.wanInterface = running.name;
                return c.wanInterface;
            }
        }
    } catch(e) {}
    return "ether1";
}

app.get('/api/dashboard', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            const resource = await runCommandOnClient(c, '/system/resource/print');
            
            if (!resource) {
                return {
                    id: `MTIK-${c.id}`,
                    name: `Router ${c.host}`,
                    status: "Offline",
                    ip: c.host,
                    uptime: "0s",
                    cpu: "0%",
                    lastRestart: "N/A"
                };
            }

            let devId = `MTIK-${c.id}`;
            try {
                const routerboard = await runCommandOnClient(c, '/system/routerboard/print');
                if (routerboard && routerboard[0] && routerboard[0]['serial-number']) {
                    devId = routerboard[0]['serial-number'];
                }
            } catch (e) {}
            
            const name = await getRouterIdentity(c);
            const uptime = resource[0]['uptime'] || '0s';
            const cpu = resource[0]['cpu-load'] ? resource[0]['cpu-load'] + '%' : 'N/A';
            
            return {
                id: devId,
                name: name,
                status: "Online",
                ip: c.host,
                uptime: uptime,
                cpu: cpu,
                lastRestart: "N/A"
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null); 
        
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/traffic', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            const iface = await getWanInterface(c);
            let rx = 0, tx = 0;
            try {
                const traffic = await runCommandOnClient(c, ['/interface/monitor-traffic', `=interface=${iface}`, '=once=']);
                if (traffic && traffic[0]) {
                    rx = parseInt(traffic[0]['rx-bits-per-second']) || 0;
                    tx = parseInt(traffic[0]['tx-bits-per-second']) || 0;
                }
            } catch(e) {}
            
            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                interface: iface,
                rx: rx,
                tx: tx
            };
        });
        const results = (await Promise.all(promises)).filter(r => r !== null);
        res.json(results);
    } catch(error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/logs', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            // We only need the last 50 logs to avoid huge payloads
            const logs = await runCommandOnClient(c, '/log/print');
            if (!logs) {
                return {
                    routerHost: c.host,
                    routerName: await getRouterIdentity(c),
                    data: []
                };
            }

            // MikroTik logs are usually chronological (oldest first), so we slice from the end and reverse
            const recentLogs = logs.slice(-50).reverse().map(item => ({
                id: item['.id'] || "-",
                time: item.time || "-",
                topics: item.topics || "system",
                message: item.message || ""
            }));

            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                data: recentLogs
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/ips', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            const arp = await runCommandOnClient(c, '/ip/arp/print');
            if (!arp) return null;

            const ipList = arp.map(item => ({
                ip: item.address,
                status: (item.complete === 'true' || item.complete === true || !item.invalid) ? "Online" : "Offline",
                device: item.interface || "Unknown",
                mac: item['mac-address'] || "-"
            })).filter(item => item.status === "Online");

            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                data: ipList
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/firewalls', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            const filters = await runCommandOnClient(c, '/ip/firewall/filter/print');
            if (!filters) return null;

            const fwList = filters.map(item => ({
                id: item['.id'] || "-",
                ruleName: item.comment || "Unnamed Rule",
                source: item['src-address'] || "Any",
                destination: item['dst-address'] || "Any",
                port: item['dst-port'] || item['port'] || "Any",
                interface: item['in-interface'] || item['out-interface'] || item['in-interface-list'] || item['out-interface-list'] || "All",
                action: item.action === 'accept' ? 'Allow' : (item.action === 'drop' ? 'Drop' : item.action),
                status: (item.disabled === 'true' || item.disabled === true) ? "Inactive" : "Active"
            }));

            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                data: fwList
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/firewall/toggle', async (req, res) => {
    const { host, id, enable } = req.body;
    if (!host || !id) return res.status(400).json({ error: "Host and ID required" });

    const clientObj = clients.find(c => c.host === host);
    if (!clientObj) return res.status(404).json({ error: "Router not found" });

    try {
        const cmd = enable ? '/ip/firewall/filter/enable' : '/ip/firewall/filter/disable';
        await runCommandOnClient(clientObj, [cmd, '=numbers=' + id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/queue', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            const queues = await runCommandOnClient(c, '/queue/simple/print');
            if (!queues) return null;

            const qList = queues.map(item => {
                const rateStr = item.rate || "0/0";
                const rates = rateStr.split("/");
                const rateRx = parseInt(rates[0]) || 0;
                const rateTx = parseInt(rates[1]) || 0;
                
                return {
                    id: item['.id'] || "-",
                    name: item.name || "Unnamed",
                    target: item.target || "-",
                    maxLimit: item['max-limit'] || "-",
                    burstLimit: item['burst-limit'] || "-",
                    status: (item.disabled === 'true' || item.disabled === true) ? "Inactive" : "Active",
                    rateRx: rateRx,
                    rateTx: rateTx
                };
            });

            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                data: qList
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/queue/toggle', async (req, res) => {
    const { host, id, enable } = req.body;
    if (!host || !id) return res.status(400).json({ error: "Host and ID required" });

    const clientObj = clients.find(c => c.host === host);
    if (!clientObj) return res.status(404).json({ error: "Router not found" });

    try {
        const cmd = enable ? '/queue/simple/enable' : '/queue/simple/disable';
        await runCommandOnClient(clientObj, [cmd, '=numbers=' + id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.post('/api/queue-traffic', async (req, res) => {
    const { host, queueName } = req.body;
    if (!host || !queueName) return res.status(400).json({ error: "Host and queueName are required" });

    const clientObj = clients.find(c => c.host === host);
    if (!clientObj) return res.status(404).json({ error: "Router not found" });

    try {
        const queues = await runCommandOnClient(clientObj, ['/queue/simple/print', `?name=${queueName}`]);
        let rateRx = 0, rateTx = 0;
        if (queues && queues[0]) {
            const rateStr = queues[0].rate || "0/0";
            const rates = rateStr.split("/");
            rateRx = parseInt(rates[0]) || 0;
            rateTx = parseInt(rates[1]) || 0;
        }
        res.json({ rx: rateRx, tx: rateTx });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ping', async (req, res) => {
    const { host, target } = req.body;
    if (!target) return res.status(400).json({ error: "Target IP is required" });

    try {
        let targetClients = host === 'all' ? clients : clients.filter(c => c.host === host);
        if (targetClients.length === 0) return res.status(404).json({ error: "Router not found" });

        const promises = targetClients.map(async (c) => {
            const result = await runCommandOnClient(c, ['/ping', `=address=${target}`, '=count=4']);
            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                data: result || []
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const http = require('http');

function getIPGeo(ip) {
    return new Promise((resolve) => {
        http.get(`http://ip-api.com/json/${ip}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch(e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

app.get('/api/gps', async (req, res) => {
    try {
        const promises = clients.map(async (c) => {
            let lat = "none";
            let lng = "none";
            let valid = "false";
            
            try {
                const geo = await getIPGeo(c.host);
                if (geo && geo.status === "success") {
                    lat = geo.lat;
                    lng = geo.lon;
                    valid = "true";
                }
            } catch (e) {
                // Ignore
            }

            return {
                routerHost: c.host,
                routerName: await getRouterIdentity(c),
                latitude: lat,
                longitude: lng,
                valid: valid
            };
        });

        let results = await Promise.all(promises);
        results = results.filter(r => r !== null);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/restart', async (req, res) => {
    const { host } = req.body;
    if (!host) return res.status(400).json({ error: "Host is required" });

    const clientObj = clients.find(c => c.host === host);
    if (!clientObj) return res.status(404).json({ error: "Router not found" });

    try {
        if (!clientObj.client.connected) {
            await clientObj.client.connect();
        }
        // MikroTik closes connection on reboot, so we don't await the response to avoid timeout errors
        clientObj.client.write('/system/reboot').catch(e => {
            // Ignore socket drop error due to reboot
        });
        res.json({ success: true, message: `Router ${host} is restarting...` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Background Reports Poller ---
setInterval(async () => {
    const timestamp = Date.now();
    for (const c of clients) {
        try {
            if (!c.client.connected && !c.isConnecting) {
                db.run(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
                    [timestamp, c.host, 0, 0, 'Offline']);
                continue;
            }
            
            const iface = await getWanInterface(c);
            let rx = 0; let tx = 0;
            
            try {
                const traffic = await runCommandOnClient(c, ['/interface/monitor-traffic', '=interface=' + iface, '=once=']);
                if (traffic && traffic[0]) {
                    rx = parseInt(traffic[0]['rx-bits-per-second']) || 0;
                    tx = parseInt(traffic[0]['tx-bits-per-second']) || 0;
                    
                    db.run(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
                        [timestamp, c.host, rx, tx, 'Online']);
                } else {
                    db.run(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
                        [timestamp, c.host, 0, 0, 'Loss']);
                }
            } catch(e) {
                db.run(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
                    [timestamp, c.host, 0, 0, 'Loss']);
            }
        } catch(e) {}
    }
}, 60000);

// --- Report API Endpoint ---
app.get('/api/reports', (req, res) => {
    const period = req.query.period || '1h';
    const now = Date.now();
    let timeLimit = now - (60 * 60 * 1000); 
    let groupMinutes = 1; 

    if (period === '1d') {
        timeLimit = now - (24 * 60 * 60 * 1000);
        groupMinutes = 15; 
    } else if (period === '1w') {
        timeLimit = now - (7 * 24 * 60 * 60 * 1000);
        groupMinutes = 60 * 2; 
    } else if (period === '1M') {
        timeLimit = now - (30 * 24 * 60 * 60 * 1000);
        groupMinutes = 60 * 6; // group by 6 hours for 1 month
    } else if (period === '1y') {
        timeLimit = now - (365 * 24 * 60 * 60 * 1000);
        groupMinutes = 60 * 24; 
    }

    const sql = `
        SELECT 
            host, 
            (timestamp / (1000 * 60 * ?)) * (1000 * 60 * ?) as time_bucket,
            AVG(rx) as avg_rx,
            AVG(tx) as avg_tx,
            SUM(CASE WHEN status = 'Online' THEN 1 ELSE 0 END) as online_count,
            SUM(CASE WHEN status != 'Online' THEN 1 ELSE 0 END) as offline_count,
            COUNT(*) as count
        FROM router_metrics
        WHERE timestamp >= ?
        GROUP BY host, time_bucket
        ORDER BY time_bucket ASC
    `;

    db.all(sql, [groupMinutes, groupMinutes, timeLimit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}. Monitoring ${clients.length} routers.`);
});
