// data.js - Mock data for the dashboard

const mockData = {
    dashboard: [
        { id: "DEV-01", name: "Core Router", status: "Online", ip: "192.168.1.1", uptime: "45 days, 12 hours", cpu: "24%", lastRestart: "2026-04-20 08:00" },
        { id: "DEV-02", name: "Edge Switch A", status: "Online", ip: "192.168.1.2", uptime: "12 days, 4 hours", cpu: "18%", lastRestart: "2026-05-24 14:30" },
        { id: "DEV-03", name: "Edge Switch B", status: "Offline", ip: "192.168.1.3", uptime: "0 days, 0 hours", cpu: "N/A", lastRestart: "2026-06-05 10:15" },
        { id: "DEV-04", name: "Database Server", status: "Online", ip: "10.0.0.5", uptime: "120 days, 2 hours", cpu: "65%", lastRestart: "2026-02-05 02:00" },
        { id: "DEV-05", name: "Web Server", status: "Online", ip: "10.0.0.10", uptime: "30 days, 8 hours", cpu: "42%", lastRestart: "2026-05-06 04:00" }
    ],
    ipList: [
        // Online IPs
        { ip: "192.168.1.1", status: "Online", device: "Core Router", mac: "00:1A:2B:3C:4D:5E" },
        { ip: "192.168.1.2", status: "Online", device: "Edge Switch A", mac: "00:1A:2B:3C:4D:5F" },
        { ip: "10.0.0.5", status: "Online", device: "Database Server", mac: "AA:BB:CC:DD:EE:FF" },
        { ip: "10.0.0.10", status: "Online", device: "Web Server", mac: "11:22:33:44:55:66" },
        
        // Free IPs
        { ip: "192.168.1.4", status: "Free", device: "-", mac: "-" },
        { ip: "192.168.1.5", status: "Free", device: "-", mac: "-" },
        { ip: "10.0.0.11", status: "Free", device: "-", mac: "-" },
        { ip: "10.0.0.12", status: "Free", device: "-", mac: "-" }
    ],
    firewall: [
        { id: "FW-101", ruleName: "Allow HTTP/HTTPS", source: "Any", destination: "Web Server", port: "80, 443", action: "Allow", status: "Active" },
        { id: "FW-102", ruleName: "Block Malicious IPs", source: "Blocked_List", destination: "Any", port: "Any", action: "Drop", status: "Active" },
        { id: "FW-103", ruleName: "Allow SSH Internal", source: "192.168.1.0/24", destination: "Database Server", port: "22", action: "Allow", status: "Active" },
        { id: "FW-104", ruleName: "Legacy FTP Access", source: "Any", destination: "10.0.0.50", port: "21", action: "Allow", status: "Inactive" },
        { id: "FW-105", ruleName: "Temp Vendor Access", source: "203.0.113.5", destination: "10.0.0.10", port: "8080", action: "Allow", status: "Inactive" }
    ]
};
