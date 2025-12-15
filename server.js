require('dotenv').config(); // 🔒 Security: .env file se password uthayega

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(cors());

// Admin Panel (public folder) serve karne ke liye
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Kisi bhi website ko connect hone do
        methods: ["GET", "POST"]
    }
});

// 👇 DATABASE CONNECTION (Secure Wala)
// Render settings me MONGO_URI variable set karna mat bhoolna!
const MONGO_URI = process.env.MONGO_URI; 

if (!MONGO_URI) {
    console.error("❌ ERROR: MONGO_URI nahi mila! .env file ya Render Settings check kar.");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ DATABASE CONNECTED - System Ready! 🚀'))
        .catch(err => console.error('❌ DB CONNECTION ERROR:', err));
}

// --- SCHEMAS (Database Models) ---

// 1. Visit Logs (Total Views count karne ke liye)
const VisitSchema = new mongoose.Schema({
    website: String,
    device: String,      // Mobile / Desktop
    os: String,          // Windows / Android / iOS
    browser: String,     // Chrome / Safari
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

// 2. Unique Users (Asli insaan count karne ke liye)
const UniqueUserSchema = new mongoose.Schema({
    visitorId: { type: String, unique: true }, // Ye ID unique rahegi
    firstVisit: { type: Date, default: Date.now },
    lastVisit: Date,
    deviceInfo: String
});
const UniqueUser = mongoose.model('UniqueUser', UniqueUserSchema);

// --- MEMORY STORE (Live Tracking) ---
let liveUsers = {}; 

// --- HELPER FUNCTION (OS Pata lagane ke liye) ---
function getDeviceInfo(userAgent) {
    let os = "Unknown OS";
    if (/windows/i.test(userAgent)) os = "Windows";
    else if (/android/i.test(userAgent)) os = "Android";
    else if (/iphone|ipad|ipod/i.test(userAgent)) os = "iOS";
    else if (/linux/i.test(userAgent)) os = "Linux";
    else if (/mac/i.test(userAgent)) os = "Mac";

    let browser = "Unknown Browser";
    if (/chrome/i.test(userAgent)) browser = "Chrome";
    else if (/firefox/i.test(userAgent)) browser = "Firefox";
    else if (/safari/i.test(userAgent)) browser = "Safari";

    return { os, browser };
}

// --- MAIN LOGIC (Jab koi connect hoga) ---
io.on('connection', async (socket) => {
    const query = socket.handshake.query;

    // Check karo: Ye 'Visitor' hai ya 'Admin'?
    if (query.type === 'visitor') {
        
        // 1. User ki Details Nikalo
        const userAgent = socket.handshake.headers['user-agent'] || "";
        const referer = socket.handshake.headers.referer || "Direct";
        let domain = "Unknown Site";
        
        try { 
            if(referer !== "Direct" && referer !== "Direct/Unknown") {
                domain = new URL(referer).hostname;
            }
        } catch(e) {}

        const { os, browser } = getDeviceInfo(userAgent);
        const deviceType = /mobile/i.test(userAgent) ? "Mobile" : "Desktop";
        const visitorId = query.visitorId || "anonymous"; // ID jo local storage se aayi

        // 2. Live List me add karo
        liveUsers[socket.id] = { website: domain, os, browser, device: deviceType };

        console.log(`➕ New User on: ${domain} (${os})`);

        // 3. Database me Save karo (Async taaki server slow na ho)
        try {
            // A. Total Visits (Hamesha save hoga)
            await Visit.create({ website: domain, device: deviceType, os, browser });

            // B. Unique User (Check agar pehle kabhi aaya hai)
            const existingUser = await UniqueUser.findOne({ visitorId });
            
            if (!existingUser) {
                // Bilkul Naya Banda! 🎉
                await UniqueUser.create({ 
                    visitorId, 
                    deviceInfo: `${os} on ${browser}`, 
                    lastVisit: new Date() 
                });
            } else {
                // Purana Banda (Bas time update karo)
                existingUser.lastVisit = new Date();
                await existingUser.save();
            }
        } catch(err) { 
            console.error("Save Error:", err.message); 
        }

        // Sabko naya data bhejo
        broadcastStats();
    }

    // Admin jab update maange
    socket.on('request_update', () => broadcastStats());

    // Jab user chala jaye
    socket.on('disconnect', () => {
        if (liveUsers[socket.id]) {
            delete liveUsers[socket.id];
            broadcastStats();
        }
    });
});

// --- BROADCAST FUNCTION (Sabko Data Bhejna) ---
async function broadcastStats() {
    try {
        const totalLive = Object.keys(liveUsers).length;
        
        // Database se counts mango
        const totalVisits = await Visit.countDocuments();       // Total Views
        const uniqueVisitors = await UniqueUser.countDocuments(); // Unique Insaan

        // Charts ka data prepare karo
        const siteBreakdown = {};
        const osBreakdown = {};
        
        Object.values(liveUsers).forEach(u => {
            // Website wise count
            siteBreakdown[u.website] = (siteBreakdown[u.website] || 0) + 1;
            // OS wise count
            osBreakdown[u.os] = (osBreakdown[u.os] || 0) + 1;
        });

        // Data bhejo
        io.emit('update_dashboard', {
            totalLive,
            totalVisits,
            uniqueVisitors,
            siteBreakdown,
            osBreakdown
        });
    } catch (error) { 
        console.error("Broadcast Error:", error); 
    }
}

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 TRACKING SERVER STARTED ON PORT ${PORT}`);
});
