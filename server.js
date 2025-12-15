const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Admin Panel (index.html) ko serve karne ke liye
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: "*", // Yaha '*' ka matlab koi bhi website connect ho sakti hai
        methods: ["GET", "POST"]
    }
});

let liveUsers = 0;

io.on('connection', (socket) => {
    // Check karein ki connection Admin hai ya User
    const isUser = socket.handshake.query.type === 'visitor';

    if (isUser) {
        liveUsers++;
        io.emit('update_count', liveUsers); // Sabko naya count bhejo
        console.log(`➕ User joined. Total: ${liveUsers}`);
    }

    socket.on('disconnect', () => {
        if (isUser) {
            liveUsers = Math.max(0, liveUsers - 1); // 0 se neeche na jaye
            io.emit('update_count', liveUsers);
            console.log(`➖ User left. Total: ${liveUsers}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
