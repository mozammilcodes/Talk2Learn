const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

// ====== STATE MANAGEMENT ======
let users = {};         
let activeCalls = 0;    
const ADMIN_PASSWORD = "1234"; // Setup for your login

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

io.on('connection', (socket) => {
    console.log('New connection established:', socket.id);
    
    // FIX: Naya user aate hi frontpage counter update karo
    socket.emit('updateUserCount', Object.keys(users).length);
    
    socket.on('admin-join', (passcode) => {
        if (passcode === ADMIN_PASSWORD) {
            socket.join('admin-room');
            sendStatsToAdmin(); 
            
            socket.emit('new-log', { 
                event: "Admin Access", 
                details: "Authorized successfully", 
                time: new Date().toLocaleTimeString() 
            });
        } else {
            socket.emit('admin-error', 'Incorrect Password!');
        }
    });

    // ====== SECURE ADMIN LOGIN CHECK ======
    // process.env.ADMIN_PASSWORD ka matlab hai "Tijori se password nikalo"
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234"; 

    socket.on('admin-login-attempt', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.emit('admin-login-success');
        } else {
            socket.emit('admin-login-failed');
        }
    });

    socket.on('start-search', (userData) => {
        // NAYA: Check karna ki iska purana partner kaun tha (agar koi tha toh...)
        const previousPartnerId = users[socket.id] ? users[socket.id].lastPartner : null;

        users[socket.id] = { 
            id: socket.id, 
            username: userData.name, 
            level: userData.level, 
            peerId: userData.peerId,
            partnerId: null, 
            lastPartner: previousPartnerId, // NAYA: Purane partner ko yaad rakho
            inCall: false 
        };
        
        io.emit('updateUserCount', Object.keys(users).length);
        
        io.to('admin-room').emit('new-log', {
            event: "Search Started",
            details: `${userData.name} (Level: ${userData.level}) is searching`,
            time: new Date().toLocaleTimeString()
        });
        
        sendStatsToAdmin();

        // NAYA MATCHING LOGIC: Purane partner ko ignore karo
        let partner = Object.values(users).find(u => 
            u.id !== socket.id && 
            u.level === userData.level && 
            !u.inCall &&
            u.id !== users[socket.id].lastPartner 
        );

        if (partner) {
            users[socket.id].inCall = true;
            users[socket.id].partnerId = partner.id;
            users[socket.id].lastPartner = partner.id; // Record current partner
            
            users[partner.id].inCall = true;
            users[partner.id].partnerId = socket.id;
            users[partner.id].lastPartner = socket.id; // Record current partner
            
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
            
            io.to('admin-room').emit('new-log', {
                event: "Match Success",
                details: `${userData.name} matched with ${partner.username}`,
                time: new Date().toLocaleTimeString()
            });

            io.emit('update-active-calls', activeCalls);
            sendStatsToAdmin();
        }
    });

    //  CHAT MESSAGES

    socket.on('send-message', (msg) => {
        const user = users[socket.id];
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('receive-message', msg);
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
            
            io.to('admin-room').emit('new-log', {
                event: "Call Ended",
                details: `Call involving ${user.username} ended`,
                time: new Date().toLocaleTimeString()
            });

            io.emit('update-active-calls', activeCalls);
            sendStatsToAdmin();
        }
    });

  // ====== FIXED: SKIP PARTNER LOGIC ======
    socket.on('skip-partner', () => {
        const user = users[socket.id];
        if (user && user.inCall) {
            const partnerId = user.partnerId;
            
            // Dono ko 'inCall' se free karo
            user.inCall = false;
            user.partnerId = null;

            if (users[partnerId]) {
                users[partnerId].inCall = false;
                users[partnerId].partnerId = null;
                io.to(partnerId).emit('partner-skipped'); 
            }

            // CRITICAL FIX: Ensure activeCalls kabhi minus me na jaye
            if (activeCalls > 0) {
                activeCalls--; 
            }
            
            io.to('admin-room').emit('new-log', {
                event: "Skipped",
                details: `${user.username} skipped to next partner`,
                time: new Date().toLocaleTimeString()
            });

            io.emit('update-active-calls', activeCalls);
            sendStatsToAdmin();
        }
    });

    socket.on('kick-user', (id) => {
        const targetSocket = io.sockets.sockets.get(id);
        if(targetSocket) {
            const kickedUsername = users[id] ? users[id].username : id;
            
            io.to('admin-room').emit('new-log', {
                event: "Admin Action",
                details: `User ${kickedUsername} was kicked by admin`,
                time: new Date().toLocaleTimeString()
            });
            
            targetSocket.emit('kicked-by-admin'); 
            targetSocket.disconnect();
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        
        if (user) {
            io.to('admin-room').emit('new-log', {
                event: "User Disconnect",
                details: `${user.username || socket.id} left the platform`,
                time: new Date().toLocaleTimeString()
            });

            if (user.partnerId) {
                const partnerId = user.partnerId;
                io.to(partnerId).emit('partner-disconnected');
                
                if (users[partnerId]) {
                    users[partnerId].inCall = false;
                    users[partnerId].partnerId = null;
                }
                
                // CRITICAL FIX
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