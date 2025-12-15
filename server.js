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
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// 👇 TERA DATABASE LINK (Maine fix kar diya hai)
// Password me '@' tha isliye '%40' lagaya hai taaki error na aaye
const MONGO_URI = "mongodb+srv://brucewayne028:Lalit%40dev28@devlalit.ufmjppx.mongodb.net/trafficDB?retryWrites=true&w=majority";

// Database Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DATABASE CONNECTED - History Save Hogi!'))
    .catch(err => console.error('❌ DB CONNECTION ERROR:', err));

// Schema (Register me kya likhna hai)
const VisitSchema = new mongoose.Schema({
    website: String,   // Site ka naam (e.g., spidyuniverse)
    device: String,    // Mobile ya Laptop
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

// Live Users Memory
let liveUsers = {}; 

io.on('connection', async (socket) => {
    // 1. User Details Nikalna
    const referer = socket.handshake.headers.referer || "Direct/Unknown";
    const userAgent = socket.handshake.headers['user-agent'];
    const deviceType = /mobile/i.test(userAgent) ? "Mobile" : "Desktop";
    
    // Website ka saaf naam nikalna
    let domain = "Unknown Site";
    try {
        if(referer !== "Direct/Unknown") {
            domain = new URL(referer).hostname;
        }
    } catch (e) {}

    // 2. Sirf 'Visitor' ko track karein (Admin ko count na karein)
    if (socket.handshake.query.type === 'visitor') {
        // Live List me add
        liveUsers[socket.id] = { website: domain, device: deviceType };
        
        // Database me Save (History ke liye)
        try {
            const newVisit = new Visit({ website: domain, device: deviceType });
            await newVisit.save();
        } catch(err) { console.log("Save Error:", err); }

        console.log(`➕ User joined: ${domain}`);
        broadcastStats();
    }

    // 3. Admin ko Data Bhejna
    socket.on('request_update', () => broadcastStats());

    // 4. Disconnect hone par
    socket.on('disconnect', () => {
        if (liveUsers[socket.id]) {
            delete liveUsers[socket.id];
            broadcastStats();
        }
    });
});

// Sare Admin Panels ko data bhejo
async function broadcastStats() {
    try {
        // 1. Live Count
        const totalLive = Object.keys(liveUsers).length;
        
        // 2. Kaunsi site par kitne log (Live)
        const siteBreakdown = {};
        Object.values(liveUsers).forEach(u => {
            siteBreakdown[u.website] = (siteBreakdown[u.website] || 0) + 1;
        });

        // 3. Total History Count (Database se)
        const totalVisits = await Visit.countDocuments();
        
        // Data Pack karke bhejo
        const stats = {
            totalLive,
            siteBreakdown,
            totalVisits
        };

        io.emit('update_dashboard', stats);
    } catch (error) {
        console.error("Broadcast Error:", error);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server Running on Port ${PORT}`));
