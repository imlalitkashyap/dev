const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 👇 TERA MONGODB URL (Bilkul waisa hi rakhna jaisa abhi chal rha hai)
const MONGO_URI = "mongodb+srv://brucewayne028:Lalit%40dev28@devlalit.ufmjppx.mongodb.net/trafficDB?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ PRO DB CONNECTED'))
    .catch(err => console.error('❌ DB ERROR:', err));

// 1. Schema: Har page view record karega (Total Views ke liye)
const VisitSchema = new mongoose.Schema({
    website: String,
    device: String,
    os: String,          // Windows, Android, iOS
    browser: String,     // Chrome, Safari
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

// 2. Schema: Sirf Unique Users record karega
const UniqueUserSchema = new mongoose.Schema({
    visitorId: { type: String, unique: true }, // Ye duplicate nahi hone dega
    firstVisit: { type: Date, default: Date.now },
    lastVisit: Date,
    deviceInfo: String
});
const UniqueUser = mongoose.model('UniqueUser', UniqueUserSchema);

// Live Users Memory
let liveUsers = {}; 

// Helper: OS aur Browser pata lagana
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

io.on('connection', async (socket) => {
    const query = socket.handshake.query;
    
    // Sirf Visitors ke liye logic
    if (query.type === 'visitor') {
        const userAgent = socket.handshake.headers['user-agent'] || "";
        const referer = socket.handshake.headers.referer || "Direct";
        let domain = "Unknown";
        try { if(referer !== "Direct") domain = new URL(referer).hostname; } catch(e){}

        const { os, browser } = getDeviceInfo(userAgent);
        const deviceType = /mobile/i.test(userAgent) ? "Mobile" : "Desktop";
        const visitorId = query.visitorId || "anonymous";

        // Live Tracking Add
        liveUsers[socket.id] = { website: domain, os, browser, device: deviceType };

        // --- DATABASE JADU ---
        try {
            // A. Total Views (Hamesha save karo)
            await Visit.create({ website: domain, device: deviceType, os, browser });

            // B. Unique User (Check karo agar naya hai)
            const existingUser = await UniqueUser.findOne({ visitorId });
            if (!existingUser) {
                // Bilkul Naya Banda!
                await UniqueUser.create({ visitorId, deviceInfo: `${os} on ${browser}`, lastVisit: new Date() });
            } else {
                // Purana Banda (Sirf time update karo)
                existingUser.lastVisit = new Date();
                await existingUser.save();
            }
        } catch(err) { console.log("Save Error:", err.message); }

        broadcastStats();
    }

    socket.on('request_update', () => broadcastStats());
    socket.on('disconnect', () => {
        delete liveUsers[socket.id];
        broadcastStats();
    });
});

async function broadcastStats() {
    try {
        const totalLive = Object.keys(liveUsers).length;
        
        // Count from DB
        const totalVisits = await Visit.countDocuments();       // Total Views
        const uniqueVisitors = await UniqueUser.countDocuments(); // Unique Insaan

        // Breakdowns for Charts
        const siteBreakdown = {};
        const osBreakdown = {};
        
        Object.values(liveUsers).forEach(u => {
            siteBreakdown[u.website] = (siteBreakdown[u.website] || 0) + 1;
            osBreakdown[u.os] = (osBreakdown[u.os] || 0) + 1;
        });

        io.emit('update_dashboard', {
            totalLive,
            totalVisits,
            uniqueVisitors,
            siteBreakdown,
            osBreakdown
        });
    } catch (error) { console.error(error); }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Ultra Pro Server on ${PORT}`));
