const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { RouterOSAPI } = require('node-routeros');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'reports.db'), (err) => {
    if (err) console.error('SQLite open error:', err.message);
});

// Enable WAL mode to prevent SQLITE_BUSY when multiple writes happen
db.run('PRAGMA journal_mode=WAL;');
db.run('PRAGMA busy_timeout=5000;'); // Wait up to 5s if locked

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS router_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        host TEXT,
        rx REAL,
        tx REAL,
        status TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT
    )`);
    // Insert default admin if users table is empty
    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
        if (!err && row && row.count === 0) {
            const crypto = require('crypto');
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
            const finalHash = `${salt}:${hash}`;
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ['admin', finalHash, 'admin']);
        }
    });
});

// Safe wrapper for db.run to avoid uncaught errors
function dbRun(sql, params) {
    db.run(sql, params, (err) => {
        if (err && !err.message.includes('SQLITE_BUSY')) {
            console.error('DB write error:', err.message);
        }
    });
}
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const crypto = require('crypto');
const activeSessions = new Map();

// Helper to clean up expired sessions
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (session.expiresAt < now) {
            activeSessions.delete(token);
        }
    }
}, 5 * 60 * 1000); // clean every 5 mins

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, error: "Username atau password salah." });
        }
        
        try {
            const [salt, key] = user.password.split(':');
            const crypto = require('crypto');
            const hashedBuffer = crypto.scryptSync(password, salt, 64);
            const keyBuffer = Buffer.from(key, 'hex');
            const match = crypto.timingSafeEqual(hashedBuffer, keyBuffer);
            
            if (match) {
                const token = crypto.randomBytes(32).toString('hex');
                activeSessions.set(token, {
                    username: user.username,
                    role: user.role,
                    expiresAt: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
                });
                return res.json({ success: true, token, role: user.role });
            } else {
                return res.status(401).json({ success: false, error: "Username atau password salah." });
            }
        } catch (e) {
            return res.status(500).json({ success: false, error: "Internal server error." });
        }
    });
});

app.get('/api/users', (req, res) => {
    // Basic authorization check (ideally we should use authMiddleware but it is defined below, we'll assume it's applied correctly if we place it after, wait, authMiddleware is app.use('/api') so it applies to all. We are fine to just return users.)
    // Wait, the routes are defined before authMiddleware?
    // Actually, in server.js, app.use('/api', authMiddleware) is on line 89. So anything defined BEFORE line 89 is NOT protected by authMiddleware!
    // But wait, the original app.post('/api/login') was at line 53, BEFORE authMiddleware. That's why it wasn't blocked.
    // If I add `/api/users` here, it will be UNPROTECTED! I should add `/api/users` AFTER authMiddleware!
    // So I shouldn't add it in this chunk. I'll add it in another chunk.
    // Wait, I will just do it properly. Let's not add /api/users here.


function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: "Access denied. No token provided." });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: "Access denied. Invalid token format." });
    }
    const session = activeSessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
        if (session) activeSessions.delete(token);
        return res.status(401).json({ error: "Sesi expired. Silakan login kembali." });
    }
    // Refresh expiration
    session.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
    next();
}

app.use('/api', (req, res, next) => {
    if (req.path === '/login') {
        return next();
    }
    authMiddleware(req, res, next);
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, username, role FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users/add', (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const finalHash = `${salt}:${hash}`;
    
    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, finalHash, role || 'user'], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE")) return res.status(400).json({ error: "Username already exists" });
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/users/delete/:id', (req, res) => {
    db.run("DELETE FROM users WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

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

// If no clients are configured in .env, populate with mock/simulated clients
if (clients.length === 0) {
    console.log("No MikroTik routers configured in .env. Initializing mock routers for testing/demo.");
    const mockRouters = [
        { id: 1, host: "192.168.88.1", name: "Core Router" },
        { id: 2, host: "192.168.88.2", name: "Distribution Switch" },
        { id: 3, host: "192.168.88.3", name: "Access Point Main" }
    ];
    for (const r of mockRouters) {
        clients.push({
            id: r.id,
            host: r.host,
            client: { connected: true, connect: async () => {}, write: async () => {}, close: () => {} },
            isMock: true,
            mockName: r.name,
            uptimeStart: Date.now() - (r.id * 5 * 3600 * 1000 + 10000), // different uptime start times
            
            // Mock states
            firewalls: [
                { '.id': '*1', comment: 'Allow HTTP/HTTPS', 'src-address': '0.0.0.0/0', 'dst-address': '192.168.88.10', port: '80,443', action: 'accept', disabled: 'false' },
                { '.id': '*2', comment: 'Block Port Scanner', 'src-address': 'Any', 'dst-address': 'Any', port: 'Any', action: 'drop', disabled: 'false' },
                { '.id': '*3', comment: 'Allow Winbox Access', 'src-address': '192.168.88.0/24', 'dst-address': 'Any', port: '8291', action: 'accept', disabled: 'false' },
                { '.id': '*4', comment: 'Temp Block Facebook', 'src-address': 'Any', 'dst-address': 'Any', port: 'Any', action: 'drop', disabled: 'true' }
            ],
            queues: [
                { '.id': '*1', name: 'Limit-Admin', target: '192.168.88.10/32', 'max-limit': '10M/10M', 'burst-limit': '0/0', disabled: 'false' },
                { '.id': '*2', name: 'Limit-Staff', target: '192.168.88.0/24', 'max-limit': '50M/50M', 'burst-limit': '0/0', disabled: 'false' },
                { '.id': '*3', name: 'Limit-Guest', target: '192.168.88.100/30', 'max-limit': '5M/5M', 'burst-limit': '0/0', disabled: 'true' }
            ],
            logs: [
                { '.id': '*1', time: '11:20:00', topics: 'system,info', message: 'device changed by admin' },
                { '.id': '*2', time: '11:21:05', topics: 'dhcp,info', message: 'dhcp1 assigned 192.168.88.25 to 00:1A:2B:3C:4D:5E' },
                { '.id': '*3', time: '11:22:15', topics: 'firewall,info', message: 'web-access attempt blocked from 185.220.101.5' },
                { '.id': '*4', time: '11:23:42', topics: 'system,info,account', message: 'user admin logged in via local' }
            ]
        });
    }
}

function handleMockCommand(c, cmd) {
    const baseCmd = Array.isArray(cmd) ? cmd[0] : cmd;
    
    if (baseCmd === '/system/resource/print') {
        const uptimeMs = Date.now() - c.uptimeStart;
        const totalSecs = Math.floor(uptimeMs / 1000);
        const days = Math.floor(totalSecs / 86400);
        const hours = Math.floor((totalSecs % 86400) / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        let uptimeStr = "";
        if (days > 0) uptimeStr += `${days}d`;
        if (hours > 0 || days > 0) uptimeStr += `${hours}h`;
        if (mins > 0 || hours > 0 || days > 0) uptimeStr += `${mins}m`;
        uptimeStr += `${secs}s`;

        const cpuLoad = Math.floor(Math.random() * 15) + 3; // 3% to 17%

        return [{
            'uptime': uptimeStr || '0s',
            'cpu-load': String(cpuLoad),
            'free-memory': '24117248',
            'total-memory': '67108864',
            'cpu': 'MIPS',
            'cpu-count': '1',
            'cpu-frequency': '650',
            'board-name': 'hEX lite'
        }];
    }
    
    if (baseCmd === '/system/routerboard/print') {
        return [{
            'routerboard': 'true',
            'model': 'RB750Gr3',
            'serial-number': `MT-DEMO-SN${c.id}`
        }];
    }
    
    if (baseCmd === '/system/identity/print') {
        return [{ 'name': c.mockName }];
    }
    
    if (baseCmd === '/ip/route/print') {
        return [{
            'dst-address': '0.0.0.0/0',
            'gateway': '192.168.88.254',
            'gateway-status': '192.168.88.254 reachable via ether1',
            'active': 'true'
        }];
    }
    
    if (baseCmd === '/interface/print') {
        return [
            { name: 'ether1', type: 'ether', running: 'true' },
            { name: 'ether2', type: 'ether', running: 'true' }
        ];
    }
    
    if (baseCmd === '/interface/monitor-traffic') {
        const rx = Math.floor((Math.random() * 30 + 15) * 1000000);
        const tx = Math.floor((Math.random() * 9 + 3) * 1000000);
        return [{
            'rx-bits-per-second': String(rx),
            'tx-bits-per-second': String(tx)
        }];
    }
    
    if (baseCmd === '/log/print') {
        if (Math.random() < 0.15 && c.logs.length < 100) {
            const now = new Date();
            const timeStr = now.toTimeString().split(' ')[0];
            const logTypes = [
                { topics: 'dhcp,info', message: `dhcp1 assigned 192.168.88.${Math.floor(Math.random()*150)+50} to client` },
                { topics: 'firewall,info', message: `port scan detected from 185.${Math.floor(Math.random()*10)+200}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}` },
                { topics: 'system,info', message: 'DNS cache cleared' },
                { topics: 'system,info,account', message: 'user admin logged in via web' }
            ];
            const selected = logTypes[Math.floor(Math.random() * logTypes.length)];
            c.logs.push({
                '.id': `*${c.logs.length + 1}`,
                time: timeStr,
                topics: selected.topics,
                message: selected.message
            });
        }
        return c.logs;
    }
    
    if (baseCmd === '/ip/arp/print') {
        return [
            { address: '192.168.88.10', 'mac-address': '00:15:5D:01:02:03', interface: 'ether2', complete: 'true' },
            { address: '192.168.88.25', 'mac-address': '00:1A:2B:3C:4D:5E', interface: 'ether2', complete: 'true' },
            { address: '192.168.88.50', 'mac-address': 'BC:EE:7B:A1:B2:C3', interface: 'ether2', complete: 'true' },
            { address: '192.168.88.101', 'mac-address': 'FC:FB:FB:12:34:56', interface: 'ether2', complete: 'true' }
        ];
    }
    
    if (baseCmd === '/ip/firewall/filter/print') {
        return c.firewalls;
    }
    
    if (baseCmd === '/ip/firewall/filter/enable') {
        const numberParam = cmd.find(p => p.startsWith('=numbers='));
        if (numberParam) {
            const id = numberParam.split('=')[2];
            const rule = c.firewalls.find(f => f['.id'] === id);
            if (rule) rule.disabled = 'false';
        }
        return [{ success: true }];
    }
    
    if (baseCmd === '/ip/firewall/filter/disable') {
        const numberParam = cmd.find(p => p.startsWith('=numbers='));
        if (numberParam) {
            const id = numberParam.split('=')[2];
            const rule = c.firewalls.find(f => f['.id'] === id);
            if (rule) rule.disabled = 'true';
        }
        return [{ success: true }];
    }
    
    if (baseCmd === '/queue/simple/print') {
        const nameParam = Array.isArray(cmd) ? cmd.find(p => p.startsWith('?name=')) : null;
        if (nameParam) {
            const qName = nameParam.split('=')[1];
            const q = c.queues.find(item => item.name === qName);
            if (q) {
                let rate = '0/0';
                if (q.disabled === 'false') {
                    const rx = Math.floor(Math.random() * 300000) + 20000;
                    const tx = Math.floor(Math.random() * 800000) + 50000;
                    rate = `${rx}/${tx}`;
                }
                return [{ ...q, rate }];
            }
            return [];
        }
        
        return c.queues.map(q => {
            let rate = '0/0';
            if (q.disabled === 'false') {
                const rx = Math.floor(Math.random() * 300000) + 20000;
                const tx = Math.floor(Math.random() * 800000) + 50000;
                rate = `${rx}/${tx}`;
            }
            return { ...q, rate };
        });
    }
    
    if (baseCmd === '/queue/simple/enable') {
        const numberParam = cmd.find(p => p.startsWith('=numbers='));
        if (numberParam) {
            const id = numberParam.split('=')[2];
            const q = c.queues.find(item => item['.id'] === id);
            if (q) q.disabled = 'false';
        }
        return [{ success: true }];
    }
    
    if (baseCmd === '/queue/simple/disable') {
        const numberParam = cmd.find(p => p.startsWith('=numbers='));
        if (numberParam) {
            const id = numberParam.split('=')[2];
            const q = c.queues.find(item => item['.id'] === id);
            if (q) q.disabled = 'true';
        }
        return [{ success: true }];
    }
    
    if (baseCmd === '/ping') {
        const addrParam = cmd.find(p => p.startsWith('=address='));
        const targetIp = addrParam ? addrParam.split('=')[2] : '8.8.8.8';
        return [
            { host: targetIp, size: '56', ttl: '64', time: `${Math.floor(Math.random()*10)+5}ms`, status: 'echo reply' },
            { host: targetIp, size: '56', ttl: '64', time: `${Math.floor(Math.random()*10)+5}ms`, status: 'echo reply' },
            { host: targetIp, size: '56', ttl: '64', time: `${Math.floor(Math.random()*10)+5}ms`, status: 'echo reply' },
            { host: targetIp, size: '56', ttl: '64', time: `${Math.floor(Math.random()*10)+5}ms`, status: 'echo reply' }
        ];
    }
    
    if (baseCmd === '/system/reboot') {
        c.uptimeStart = Date.now();
        c.logs.push({
            '.id': `*${c.logs.length + 1}`,
            time: new Date().toTimeString().split(' ')[0],
            topics: 'system,info',
            message: 'system rebooted'
        });
        return [{ success: true }];
    }

    return null;
}

async function runCommandOnClient(clientObj, command) {
    if (clientObj.isMock) {
        return handleMockCommand(clientObj, command);
    }
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
    
    // Command Injection Protection: ensure id is a valid RouterOS identifier format (*1, *A, etc) or alphanumeric
    if (!/^\*?[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: "Invalid ID format" });

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
    
    // Command Injection Protection: ensure id is a valid RouterOS identifier format (*1, *A, etc) or alphanumeric
    if (!/^\*?[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: "Invalid ID format" });

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
            if (!c.isMock && !c.client.connected && !c.isConnecting) {
                dbRun(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
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
                    dbRun(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
                        [timestamp, c.host, rx, tx, 'Online']);
                } else {
                    dbRun(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
                        [timestamp, c.host, 0, 0, 'Loss']);
                }
            } catch(e) {
                dbRun(`INSERT INTO router_metrics (timestamp, host, rx, tx, status) VALUES (?, ?, ?, ?, ?)`, 
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

// Global uncaught exception handler to prevent server crash
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception (non-fatal):', err.message || err);
});
process.on('unhandledRejection', (reason) => {
    const msg = reason ? String(reason.message || reason) : 'Unknown';
    if (!msg.includes('Timed out') && !msg.includes('RosException') && !msg.includes('SQLITE_BUSY')) {
        console.error('Unhandled Promise Rejection (non-fatal):', msg);
    }
});
