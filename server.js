require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios'); // Location nikalne ke liye

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 👇 ADMIN PASSWORD YAHAN CHANGE KAR LENA
const ADMIN_PASS = "LalitBoss123"; 

// 👇 DATABASE URL (Ye Render ki Settings se aayega)
const MONGO_URI = process.env.MONGO_URI;

// --- DATABASE CONNECTION ---
if (!MONGO_URI) {
    console.error("❌ ERROR: MONGO_URI nahi mila! Render Environment Variables check kar.");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ DB CONNECTED - GOD MODE ACTIVE'))
        .catch(err => console.log('❌ DB ERROR:', err));
}

// --- SCHEMAS (Database Models) ---
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

// --- MEMORY STORE ---
let liveUsers = {};
let bannedIPs = new Set(); // Cache for fast blocking

// Server start hote hi Banned list load kar lo
BannedIP.find().then(docs => docs.forEach(d => bannedIPs.add(d.ip)));

io.on('connection', async (socket) => {
    const query = socket.handshake.query;
    
    // ==========================================
    // 👑 1. ADMIN LOGIC
    // ==========================================
    if (query.type === 'admin') {
        // Login Check
        socket.on('admin_login', (pass) => {
            if (pass === ADMIN_PASS) {
                socket.emit('login_success');
                broadcastStats(); // Turant data bhejo
            } else {
                socket.emit('login_fail');
            }
        });

        // Global Alert (Popup Message)
        socket.on('send_global_alert', (msg) => {
            io.emit('receive_alert', msg);
        });

        // Ban User
        socket.on('ban_ip', async (ip) => {
            bannedIPs.add(ip); // Memory me block
            await BannedIP.create({ ip, reason: "Admin Banned" }); // DB me block
            
            // Us IP wale sabhi users ko disconnect kar do
            const sockets = await io.fetchSockets();
            sockets.forEach(s => {
                const sIP = s.handshake.headers['x-forwarded-for'] || s.handshake.address;
                if(sIP && sIP.includes(ip)) {
                    s.disconnect(true);
                }
            });
            broadcastStats();
        });
        return; 
    }

    // ==========================================
    // 🕵️‍♂️ 2. VISITOR LOGIC
    // ==========================================
    if (query.type === 'visitor') {
        // IP Address Nikalna
        let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
        
        // Agar IP Ban List me hai to bye-bye
        if (bannedIPs.has(ip)) {
            socket.emit('receive_alert', "⛔ YOU ARE BANNED BY ADMIN");
            socket.disconnect();
            return;
        }

        // ... Upar ka code same ...

        // Location Trace (API Call) - IMPROVED VERSION
        let location = "Unknown Location";
        let countryCode = "";
        
        try {
            // Localhost ko ignore karo
            if (ip && ip.length > 7 && !ip.includes('127.0.0.1')) {
                // 👇 YAHAN CHANGE HAI: Timeout laga diya (3 second max)
                const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
                
                if (res.data.status === 'success') {
                    location = `${res.data.city}, ${res.data.country}`;
                    countryCode = res.data.countryCode;
                }
            }
        } catch (e) { 
            // Agar error aaye to server band mat karna, bas log karna
            console.log("Geo Location Failed (Site still working):", e.message); 
        }

        // ... Niche ka code same ...

        // User Data Object
        const userInfo = {
            id: socket.id,
            website: new URL(socket.handshake.headers.referer || "http://direct").hostname,
            page: query.page || "/",
            device: /mobile/i.test(socket.handshake.headers['user-agent']) ? "Mobile" : "PC",
            location,
            countryCode,
            ip // Admin ko dikhane ke liye
        };

        // Live Tracking me add
        liveUsers[socket.id] = userInfo;

        // History Database me save
        Visit.create({ 
            website: userInfo.website, 
            location, 
            countryCode, 
            page: userInfo.page, 
            device: userInfo.device 
        });

        broadcastStats();

        // Disconnect hone par
        socket.on('disconnect', () => {
            if (liveUsers[socket.id]) {
                delete liveUsers[socket.id];
                broadcastStats();
            }
        });
    }
});

// --- HELPER: Sabko Data Bhejna ---
async function broadcastStats() {
    const totalLive = Object.keys(liveUsers).length;
    io.emit('update_dashboard', { totalLive, liveUsers });
}

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SYSTEM ONLINE ON PORT ${PORT}`));
