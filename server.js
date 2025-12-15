require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios'); // Location ke liye

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- DATABASE CONNECT ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ DB CONNECTED'))
    .catch(err => console.log('❌ DB ERROR:', err));

// --- SCHEMAS ---
const VisitSchema = new mongoose.Schema({
    website: String,
    location: String,
    countryCode: String,
    page: String,
    device: String,
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

const BannedSchema = new mongoose.Schema({ ip: String, reason: String });
const BannedIP = mongoose.model('BannedIP', BannedSchema);

// --- MEMORY ---
let liveUsers = {};
let bannedIPs = new Set(); // Fast checking ke liye cache

// Server start hote hi Banned IPs load kar lo
BannedIP.find().then(docs => docs.forEach(d => bannedIPs.add(d.ip)));

io.on('connection', async (socket) => {
    const query = socket.handshake.query;
    
    // 1. ADMIN LOGIN & COMMANDS
    if (query.type === 'admin') {
        socket.on('admin_login', (pass) => {
            if (pass === LalitBoss123) {
                socket.emit('login_success');
                broadcastStats(); // Login hote hi data bhejo
            } else {
                socket.emit('login_fail');
            }
        });

        // GOD MODE ALERT (Sabko message bhejo)
        socket.on('send_global_alert', (msg) => {
            io.emit('receive_alert', msg);
        });

        // BAN USER
        socket.on('ban_ip', async (ip) => {
            bannedIPs.add(ip);
            await BannedIP.create({ ip, reason: "Admin Banned" });
            // Us IP ke saare sockets disconnect kar do
            const sockets = await io.fetchSockets();
            sockets.forEach(s => {
                if(s.handshake.address.includes(ip) || s.handshake.headers['x-forwarded-for']?.includes(ip)) {
                    s.disconnect(true);
                }
            });
            broadcastStats();
        });
        return; // Admin ko track nahi karna aage
    }

    // 2. VISITOR TRACKING
    if (query.type === 'visitor') {
        // IP Nikalo
        let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        if (ip.includes(',')) ip = ip.split(',')[0].trim();

        // Check agar BAN hai to bhaga do
        if (bannedIPs.has(ip)) {
            socket.emit('receive_alert', "⛔ You are BANNED from this server.");
            socket.disconnect();
            return;
        }

        // Location API Call
        let location = "Unknown";
        let countryCode = "";
        try {
            if (ip && ip.length > 7) {
                const res = await axios.get(`http://ip-api.com/json/${ip}`);
                if (res.data.status === 'success') {
                    location = `${res.data.city}, ${res.data.country}`;
                    countryCode = res.data.countryCode;
                }
            }
        } catch (e) {}

        const info = {
            id: socket.id,
            website: new URL(socket.handshake.headers.referer || "http://direct").hostname,
            page: query.page || "/",
            device: /mobile/i.test(socket.handshake.headers['user-agent']) ? "Mobile" : "PC",
            location,
            countryCode,
            ip // Admin ko dikhane ke liye (lekin save mat karna privacy ke liye)
        };

        liveUsers[socket.id] = info;

        // DB Save
        Visit.create({ 
            website: info.website, 
            location, 
            countryCode, 
            page: info.page, 
            device: info.device 
        });

        broadcastStats();

        socket.on('disconnect', () => {
            delete liveUsers[socket.id];
            broadcastStats();
        });
    }
});

async function broadcastStats() {
    const totalLive = Object.keys(liveUsers).length;
    io.emit('update_dashboard', { totalLive, liveUsers });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 GOD SERVER RUNNING ON ${PORT}`));
