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

// 👇 YAHAN APNA MONGODB URL DAAL (Bahut Important)
const MONGO_URI = "mongodb+srv://TERA_USER:TERA_PASSWORD@cluster....mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected (History Save Hogi)'))
    .catch(err => console.log('❌ DB Error:', err));

// Database Schema (Kya kya save karna hai)
const VisitSchema = new mongoose.Schema({
    website: String,   // Kaunsi site (SpidyUniverse, etc.)
    device: String,    // Mobile/Desktop
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

// Memory me Live Users
let liveUsers = {}; // Format: { socketId: { website: 'url', device: 'mobile' } }

io.on('connection', async (socket) => {
    // 1. Data Extract karna (User kahan se aaya)
    const referer = socket.handshake.headers.referer || "Direct/Unknown";
    const userAgent = socket.handshake.headers['user-agent'];
    const deviceType = /mobile/i.test(userAgent) ? "Mobile" : "Desktop";
    
    // Website ka saaf naam nikalna (e.g., https://google.com -> google.com)
    let domain = "Unknown";
    try {
        domain = new URL(referer).hostname;
    } catch (e) {}

    // 2. Live Tracking me add karna
    liveUsers[socket.id] = { website: domain, device: deviceType };

    // 3. Database me Permanent Save karna (History ke liye)
    if (socket.handshake.query.type === 'visitor') {
        const newVisit = new Visit({ website: domain, device: deviceType });
        await newVisit.save();
    }

    // 4. Sabko Data bhejna (Admin Panel update)
    broadcastStats();

    socket.on('disconnect', () => {
        delete liveUsers[socket.id];
        broadcastStats();
    });
});

// Ye function sara calculation karke Admin Panel ko bhejta hai
async function broadcastStats() {
    // Live Counts
    const totalLive = Object.keys(liveUsers).length;
    
    // Website wise breakdown (Kon kahan se hai)
    const siteBreakdown = {};
    Object.values(liveUsers).forEach(u => {
        siteBreakdown[u.website] = (siteBreakdown[u.website] || 0) + 1;
    });

    // History Counts (Database se pucho)
    // Note: Production me ise cache karna chahiye, har bar DB call heavy hoti hai
    const totalVisits = await Visit.countDocuments();
    
    const stats = {
        totalLive,
        siteBreakdown,
        totalVisits,
        // Tu aur bhi DB queries laga sakta hai yahan (Monthly, etc.)
    };

    io.emit('update_dashboard', stats);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Pro Server Running on ${PORT}`));
