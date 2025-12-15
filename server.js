require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 👇 ADMIN PASSWORD
const ADMIN_PASS = "LalitBoss123"; 
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) console.error("❌ DB URL Missing!");
else mongoose.connect(MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log(err));

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
let bannedIPs = new Set(); 

// Load Banned IPs
BannedIP.find().then(docs => docs.forEach(d => bannedIPs.add(d.ip)));

io.on('connection', async (socket) => {
    const query = socket.handshake.query;

    // --- ADMIN ---
    if (query.type === 'admin') {
        socket.on('admin_login', (pass) => {
            if (pass === ADMIN_PASS) {
                socket.emit('login_success');
                broadcastStats();
            } else {
                socket.emit('login_fail');
            }
        });

        socket.on('send_global_alert', (msg) => {
            io.emit('receive_alert', msg); // Sabko bhejo
        });

        socket.on('ban_ip', async (ip) => {
            bannedIPs.add(ip);
            await BannedIP.create({ ip, reason: "Admin Banned" });
            
            // Disconnect users with this IP
            const sockets = await io.fetchSockets();
            sockets.forEach(s => {
                const sIP = s.handshake.headers['x-forwarded-for'] || s.handshake.address;
                if(sIP && sIP.includes(ip)) s.disconnect(true);
            });
            broadcastStats();
        });
        return;
    }

    // --- VISITOR ---
    if (query.type === 'visitor') {
        let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();

        // CHECK BAN
        if (bannedIPs.has(ip)) {
            socket.emit('receive_alert', "⛔ YOU ARE BANNED");
            socket.disconnect();
            return;
        }

        // LOCATION TRACE (With Timeout fix)
        let location = "Unknown";
        let countryCode = "";
        try {
            if (ip && ip.length > 7 && !ip.includes('127.0.0.1')) {
                const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 2000 });
                if (res.data.status === 'success') {
                    location = `${res.data.city}, ${res.data.country}`;
                    countryCode = res.data.countryCode;
                }
            }
        } catch (e) {}

        const userInfo = {
            id: socket.id,
            website: new URL(socket.handshake.headers.referer || "http://direct").hostname,
            page: query.page || "/",
            device: /mobile/i.test(socket.handshake.headers['user-agent']) ? "Mobile" : "PC",
            location,
            countryCode,
            ip
        };

        liveUsers[socket.id] = userInfo;
        
        // Save to DB
        Visit.create({ ...userInfo }).catch(err => console.log(err));

        broadcastStats();

        socket.on('disconnect', () => {
            delete liveUsers[socket.id];
            broadcastStats();
        });
    }
});

async function broadcastStats() {
    // DB se Total History count nikalo
    const totalHistory = await Visit.countDocuments();
    const totalLive = Object.keys(liveUsers).length;
    // Banned list bhi bhejo taaki Admin ko dikhe
    const bannedList = Array.from(bannedIPs);
    
    io.emit('update_dashboard', { totalLive, liveUsers, totalHistory, bannedList });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SYSTEM READY ON ${PORT}`));
