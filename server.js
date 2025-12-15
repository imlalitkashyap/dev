require('dotenv').config();
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

// Database Connection
const MONGO_URI = process.env.MONGO_URI;
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ DB Connected'))
        .catch(err => console.log(err));
}

// Simple Schema
const VisitSchema = new mongoose.Schema({
    website: String,
    page: String,
    device: String,
    timestamp: { type: Date, default: Date.now }
});
const Visit = mongoose.model('Visit', VisitSchema);

let liveUsers = {};

io.on('connection', (socket) => {
    const query = socket.handshake.query;

    // --- 1. ADMIN (Bina Password ke) ---
    if (query.type === 'admin') {
        broadcastStats(); // Connect hote hi data bhejo
        
        socket.on('send_alert', (msg) => {
            io.emit('receive_alert', msg);
        });
        return;
    }

    // --- 2. VISITOR (User) ---
    if (query.type === 'visitor') {
        const userInfo = {
            id: socket.id,
            website: new URL(socket.handshake.headers.referer || "http://direct").hostname,
            page: query.page || "/",
            device: /mobile/i.test(socket.handshake.headers['user-agent']) ? "Mobile" : "PC"
        };

        liveUsers[socket.id] = userInfo;
        
        // DB me save karo (Error aaye toh ignore karo taaki server na ruke)
        Visit.create({ ...userInfo }).catch(() => {});

        broadcastStats();

        socket.on('disconnect', () => {
            delete liveUsers[socket.id];
            broadcastStats();
        });
    }
});

async function broadcastStats() {
    try {
        const totalHistory = await Visit.countDocuments();
        const totalLive = Object.keys(liveUsers).length;
        io.emit('update_dashboard', { totalLive, liveUsers, totalHistory });
    } catch (e) {
        console.log(e);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server Started on ${PORT}`));
