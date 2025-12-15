require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(cors()); // Sab websites ko allow karo
app.use(express.static(path.join(__dirname, 'public'))); // Admin panel dikhao

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Kisi bhi website se connection aane do
        methods: ["GET", "POST"]
    }
});

// --- DATABASE CONNECTION ---
// Render ke Environment Variable se URL lega
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("❌ FATAL ERROR: MONGO_URI nahi mila! Render Environment check kar.");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ DATABASE CONNECTED - SERVER STABLE'))
        .catch(err => console.log('❌ DB CONNECTION FAIL:', err));
}

// --- SCHEMA ---
const VisitSchema = new mongoose.Schema({
    website: String,
    page: String,
    device: String,
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

// --- LIVE MEMORY ---
let liveUsers = {}; 

io.on('connection', (socket) => {
    const query = socket.handshake.query;

    // 1. ADMIN LOGIC
    if (query.type === 'admin') {
        broadcastStats(); // Admin aate hi data dikhao
        
        // Alert System
        socket.on('send_alert', (msg) => {
            io.emit('receive_alert', msg); // Sab users ko bhejo
        });
        return;
    }

    // 2. VISITOR LOGIC
    if (query.type === 'visitor') {
        const userInfo = {
            id: socket.id,
            website: new URL(socket.handshake.headers.referer || "http://direct").hostname,
            page: query.page || "/",
            device: /mobile/i.test(socket.handshake.headers['user-agent']) ? "Mobile" : "PC"
        };

        liveUsers[socket.id] = userInfo;
        
        // Database me save karo
        Visit.create(userInfo).catch(err => console.log("DB Save Error (Ignore):", err.message));

        broadcastStats();

        socket.on('disconnect', () => {
            delete liveUsers[socket.id];
            broadcastStats();
        });
    }
});

// Data Bhejne ka Function
async function broadcastStats() {
    try {
        const totalHistory = await Visit.countDocuments();
        const totalLive = Object.keys(liveUsers).length;
        
        io.emit('update_dashboard', { 
            totalLive, 
            liveUsers, 
            totalHistory 
        });
    } catch (e) {
        console.log("Broadcast Error:", e);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SERVER STARTED ON PORT ${PORT}`));
