require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

// ====== DATABASE CONNECTION (Direct TCP - Network Bypass) ======
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
.then(() => {
    console.log("✅ MongoDB Connected Successfully!");
}).catch((err) => {
    console.error("❌ MongoDB Connection Error: ", err.message);
});

// ====== DATABASE SCHEMAS (Data ka Structure) ======

// 1. Admin Logs ke liye structure
const logSchema = new mongoose.Schema({
    event: String,
    details: String,
    time: String,
    timestamp: { type: Date, default: Date.now }
});
const AdminLog = mongoose.model('AdminLog', logSchema);

// 2. Chat Messages ke liye structure
const chatSchema = new mongoose.Schema({
    senderName: String,
    message: String,
    timestamp: { type: Date, default: Date.now }
});
const ChatMsg = mongoose.model('ChatMsg', chatSchema);

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

// ====== STATE MANAGEMENT ======
let users = {};
let activeCalls = 0;

app.use(express.static(__dirname));

function sendStatsToAdmin() {
    const stats = {
        online: Object.keys(users).length,
        calls: activeCalls,
        totalSearching: Object.values(users).filter(u => !u.inCall).length
    };

    io.to('admin-room').emit('stats-update', stats);
    io.to('admin-room').emit('update-admin-list', Object.values(users));
}

// ====== NAYA: SMART HELPER FUNCTION ======
async function logToAdminAndDB(eventName, detailsText) {
    const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    io.to('admin-room').emit('new-log', {
        event: eventName,
        details: detailsText,
        time: timeStr
    });

    try {
        const dbLog = new AdminLog({
            event: eventName,
            details: detailsText,
            time: timeStr
        });
        await dbLog.save();
    } catch (error) {
        console.error("❌ Log save error:", error.message);
    }
}

io.on('connection', (socket) => {
    console.log('New connection established:', socket.id);

    // Frontpage counter update karo
    socket.emit('updateUserCount', Object.keys(users).length);

    // Activity save karo jab koi naya connection aaye
    logToAdminAndDB("User Joined", `Naya student connect hua. ID: ${socket.id}`);

    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

    // ====== ADMIN LOGIN & HISTORY LOAD ======
    socket.on('admin-join', async (passcode) => {
        if (passcode === ADMIN_PASSWORD) {
            socket.join('admin-room');
            sendStatsToAdmin();

            // MONGODB SE PURANI HISTORY NIKALNA
            try {
                let history = await AdminLog.find().sort({ timestamp: -1 }).limit(50);
                history = history.reverse();

                history.forEach(log => {
                    socket.emit('new-log', {
                        event: log.event,
                        details: log.details,
                        time: log.time
                    });
                });
            } catch (err) {
                console.error("History nikalne me error:", err.message);
            }

            logToAdminAndDB("Admin Access", "Authorized successfully");
        } else {
            socket.emit('admin-error', 'Incorrect Password!');
        }
    });

    socket.on('admin-login-attempt', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.emit('admin-login-success');
        } else {
            socket.emit('admin-login-failed');
        }
    });

    // ====== NAYA: CHAT HISTORY MANGWANA ======
    socket.on('request-chat-history', async (keyword = "") => {
        try {
            let query = {};
            if (keyword && keyword.trim() !== "") {
                const searchRegex = new RegExp(keyword, 'i');
                query = {
                    $or: [
                        { senderName: searchRegex },
                        { message: searchRegex }
                    ]
                };
            }
            let chats = await ChatMsg.find(query).sort({ timestamp: -1 }).limit(100);
            socket.emit('chat-history-data', chats);
        } catch (err) {
            console.error("Chat history fetch error:", err.message);
        }
    });

    // ====== NAYA: EK SINGLE CHAT DELETE KARNA ======
    socket.on('delete-single-chat', async (chatId) => {
        try {
            await ChatMsg.findByIdAndDelete(chatId);
            logToAdminAndDB("Chat Deleted", `Admin deleted a specific chat message (ID: ${chatId})`);
            socket.emit('chat-delete-success');
        } catch (err) {
            console.error("Single chat delete error:", err.message);
        }
    });

    // ====== NAYA: SAARE CHATS DELETE KARNA (CLEANUP) ======
    socket.on('delete-all-chats', async () => {
        try {
            await ChatMsg.deleteMany({});
            logToAdminAndDB("Database Cleanup", "Admin deleted ALL chat history");
            socket.emit('chat-delete-success');
        } catch (err) {
            console.error("All chats delete error:", err.message);
        }
    });

    // ====== MATCHING LOGIC ======
    socket.on('start-search', (userData) => {
        if (users[socket.id] && users[socket.id].inCall === true) return;

        const previousPartnerId = users[socket.id] ? users[socket.id].lastPartner : null;
        
        users[socket.id] = {
            id: socket.id,
            username: userData.name,
            level: userData.level,
            peerId: userData.peerId,
            partnerId: null,
            lastPartner: previousPartnerId,
            inCall: false
        };

        io.emit('updateUserCount', Object.keys(users).length);
        sendStatsToAdmin();

        logToAdminAndDB("Search Started", `${userData.name} (Level: ${userData.level}) is searching`);

        let partner = Object.values(users).find(u =>
            u.id !== socket.id &&
            u.level === userData.level &&
            !u.inCall &&
            u.id !== users[socket.id].lastPartner
        );

        if (partner) {
            users[socket.id].inCall = true;
            users[socket.id].partnerId = partner.id;
            users[socket.id].lastPartner = partner.id;

            users[partner.id].inCall = true;
            users[partner.id].partnerId = socket.id;
            users[partner.id].lastPartner = socket.id;

            activeCalls++;

            io.to(socket.id).emit('match-found', {
                partnerPeerId: partner.peerId,
                isCaller: true,
                partnerName: partner.username
            });
            io.to(partner.id).emit('match-found', {
                partnerPeerId: userData.peerId,
                isCaller: false,
                partnerName: userData.name
            });

            logToAdminAndDB("Match Success", `${userData.name} matched with ${partner.username}`);

            io.emit('update-active-calls', activeCalls);
            sendStatsToAdmin();
        }
    });

    socket.on('cancel-search', () => {
        const user = users[socket.id];
        if (user && !user.inCall) {
            logToAdminAndDB("Search Cancelled", `${user.username} cancelled the search`);
            delete users[socket.id];
            
            io.emit('updateUserCount', Object.keys(users).length);
            sendStatsToAdmin();
        }
    });

    // ====== CHAT MESSAGES WITH DB SAVE & LIVE FEED ======
    socket.on('send-message', async (msg) => {
        const user = users[socket.id];
        
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('receive-message', msg);
        }

        try {
            const senderName = user ? user.username : "Unknown_" + socket.id.substring(0, 4);
            const newChat = new ChatMsg({
                senderName: senderName,
                message: msg
            });
            const savedChat = await newChat.save();
            console.log("📝 Chat saved to DB:", msg);

            // Live Chat Dashboard par bhejo
            const timeStr = new Date(savedChat.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
            io.to('admin-room').emit('live-chat-update', {
                sender: senderName,
                text: msg,
                time: timeStr
            });

        } catch (error) {
            console.error("❌ Chat save error:", error.message);
        }
    });

    socket.on('call-ended', () => {
        const user = users[socket.id];
        if (user && user.inCall) {
            const partnerId = user.partnerId;

            user.inCall = false;
            user.partnerId = null;

            if (users[partnerId]) {
                users[partnerId].inCall = false;
                users[partnerId].partnerId = null;
                io.to(partnerId).emit('partner-disconnected');
            }

            activeCalls = Math.max(0, activeCalls - 1);

            logToAdminAndDB("Call Ended", `Call involving ${user.username} ended`);

            io.emit('update-active-calls', activeCalls);
            sendStatsToAdmin();
        }
    });

    socket.on('skip-partner', () => {
        const user = users[socket.id];
        if (user && user.inCall) {
            const partnerId = user.partnerId;

            user.inCall = false;
            user.partnerId = null;

            if (users[partnerId]) {
                users[partnerId].inCall = false;
                users[partnerId].partnerId = null;
                io.to(partnerId).emit('partner-skipped');
            }

            if (activeCalls > 0) {
                activeCalls--;
            }

            logToAdminAndDB("Skipped", `${user.username} skipped to next partner`);

            io.emit('update-active-calls', activeCalls);
            sendStatsToAdmin();
        }
    });

    socket.on('kick-user', (id) => {
        const targetSocket = io.sockets.sockets.get(id);
        if (targetSocket) {
            const kickedUsername = users[id] ? users[id].username : id;

            logToAdminAndDB("Admin Action", `User ${kickedUsername} was kicked by admin`);

            targetSocket.emit('kicked-by-admin');
            targetSocket.disconnect();
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];

        if (user) {
            logToAdminAndDB("User Disconnect", `${user.username || socket.id} left the platform`);

            if (user.partnerId) {
                const partnerId = user.partnerId;
                io.to(partnerId).emit('partner-disconnected');

                if (users[partnerId]) {
                    users[partnerId].inCall = false;
                    users[partnerId].partnerId = null;
                }

                if (activeCalls > 0) {
                    activeCalls--;
                }
            }
        }

        delete users[socket.id];

        io.emit('updateUserCount', Object.keys(users).length);
        io.emit('update-active-calls', activeCalls);
        sendStatsToAdmin();
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));