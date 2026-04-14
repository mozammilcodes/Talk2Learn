const socket = io();

// Fix: Mobile Networks ke liye extra STUN servers
const peer = new Peer({
    config: { 
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ] 
    }
});

let localStream;
let myPeerId = null;
let currentCall = null; // Current call ko track karne ke liye

peer.on('open', (id) => { 
    myPeerId = id; 
    console.log("My Peer ID is:", id);
});

// ====== FRONTEND: FORM SUBMISSION ======
document.getElementById('practiceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!myPeerId) return alert("Please wait, connecting to server...");

    // Browser Notification ki permission maangna
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }

    try {
        // FIX 1: Sirf tabhi permission maango jab stream pehle se na ho
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        
        // Video UI ki jagah pehle Loading UI dikhayein
        document.getElementById('home-content').classList.add('hidden');
        document.getElementById('loading-ui').classList.remove('hidden');
        
        const localVid = document.getElementById('localVideo');
        if (localVid) {
            localVid.srcObject = localStream;
            localVid.muted = true;
            localVid.playsInline = true; 
            localVid.play().catch(e => console.error("Local video play failed:", e));
        }

        socket.emit('start-search', {
            name: document.getElementById('username').value,
            level: document.getElementById('level').value,
            peerId: myPeerId
        });
        
    } catch (err) {
        console.error("Media Error:", err);
        alert("Camera aur Mic access dena zaroori hai. Please enable permissions.");
        // Error aane par wapas home dikhayein
        document.getElementById('loading-ui').classList.add('hidden');
        document.getElementById('home-content').classList.remove('hidden');
    }
});

// ====== MATCHING & CALL LOGIC ======

socket.on('match-found', (data) => {
    console.log("🔥 Match Found! Partner ID:", data.partnerPeerId);

    document.getElementById('loading-ui').classList.add('hidden');
    document.getElementById('video-ui').classList.remove('hidden');
    document.getElementById('chatBox').classList.add('hidden'); // Chat band kar do naye match par

    if (data.isCaller) {
        setTimeout(() => {
            currentCall = peer.call(data.partnerPeerId, localStream); 
            handleCall(currentCall);
        }, 1500); 
    }
});

peer.on('call', (call) => {
    // FIX: Agar pehle se koi call fasi hui hai, toh use completely destroy karo
    if (currentCall) {
        currentCall.close();
    }
    
    currentCall = call; 
    call.answer(localStream); 
    handleCall(call);
});

function handleCall(call) {
    call.on('stream', (remoteStream) => {
        console.log("✅ Remote stream received!");
        
        // Remote Video Setup
        const remoteVid = document.getElementById('remoteVideo');
        if (remoteVid && remoteVid.srcObject !== remoteStream) {
            remoteVid.srcObject = remoteStream;
            remoteVid.playsInline = true; 
            remoteVid.onloadedmetadata = () => {
                remoteVid.play().catch(err => {
                    console.warn("Autoplay blocked:", err);
                    remoteVid.controls = true;
                });
            };
        }

        // Local Video Setup
        const localVid = document.getElementById('localVideo');
        if (localVid && localVid.srcObject !== localStream) {
            localVid.srcObject = localStream;
            localVid.muted = true;
            localVid.playsInline = true;
            localVid.play().catch(e => console.error(e));
        }
    });

   // Ye 'handleCall' function ke andar wala 'close' event hai, ise update karein
    call.on('close', () => {
        // Sirf tab jab partner call cut kare
        if(currentCall) {
            autoSearchAfterDisconnect();
        }
    });
} // <-- Ye handleCall function ka closing bracket hai

// ========================================================
// ====== CALL END & DISCONNECT HANDLING ========
// ========================================================

// 1. Jab User khud "End Call" button dabaye (Home page pe jayega)
function endMyCall() {
    socket.emit('call-ended'); 
    
    if (currentCall) {
        const callToClose = currentCall;
        currentCall = null;
        callToClose.close();
    }
    
    alert("You ended the call.");
    location.reload(); // Khud end kiya hai isliye wapas start pe bhejo
}

// 2. Jab partner achanak leave kar de (Auto-Search me jayega)
socket.on('partner-disconnected', () => {
    if(currentCall){
       autoSearchAfterDisconnect();
    }
});

// 3. Naya Function: Partner ke jane par wapas searching me lagana
function autoSearchAfterDisconnect() {
    console.log("Partner left. Finding new match automatically...");
    
    if (currentCall) {
        const callToClose = currentCall;
        currentCall = null; 
        callToClose.close(); 
    }
    
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;

    // UI Reset
    document.getElementById('video-ui').classList.add('hidden');
    document.getElementById('chatBox').classList.add('hidden'); 
    document.getElementById('home-content').classList.add('hidden'); 
    document.getElementById('loading-ui').classList.remove('hidden'); 
    document.getElementById('chat-messages').innerHTML = ''; 

    // Automatically naya partner dhundo bina kuch press kiye
    setTimeout(() => {
        socket.emit('start-search', {
            name: document.getElementById('username').value,
            level: document.getElementById('level').value,
            peerId: myPeerId
        });
    }, 1500);
}
// ====== SKIP PARTNER FUNCTION ======
function skipPartner() {
    console.log("⏭️ Skipping to next partner...");
    
    // TRICK: Pehle call object ko null karo taaki reload wala event trigger na ho
    if (currentCall) {
        const callToClose = currentCall;
        currentCall = null; // Important reset pehle
        callToClose.close(); // Call baad mein close karein
    }
    
    // Server ko batao
    socket.emit('skip-partner');

    // Remote video feed clear karo
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;

    // UI Reset karo (Chat band, loading shuru, video hide)
    document.getElementById('video-ui').classList.add('hidden');
    document.getElementById('chatBox').classList.add('hidden'); 
    document.getElementById('home-content').classList.add('hidden'); 
    document.getElementById('loading-ui').classList.remove('hidden');
    document.getElementById('chat-messages').innerHTML = ''; 

    // Thoda ruk kar wapas search shuru karo
    setTimeout(() => {
        socket.emit('start-search', {
            name: document.getElementById('username').value,
            level: document.getElementById('level').value,
            peerId: myPeerId
        });
    }, 1500);
}

// Jab aapka partner aapse skip karke aage badh jaye
socket.on('partner-skipped', () => {
    console.log("Partner skipped you. Finding new match automatically...");
    
    // 1. Purani call aur connection properly close karo
    if (currentCall) {
        const callToClose = currentCall;
        currentCall = null; 
        callToClose.close(); 
    }
    
    // 2. Remote video feed clear karo
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;

    // 3. UI Reset karo (Chat band, loading shuru, video hide)
    document.getElementById('video-ui').classList.add('hidden');
    document.getElementById('chatBox').classList.add('hidden'); 
    document.getElementById('home-content').classList.add('hidden'); // Ensure Home is hidden
    document.getElementById('loading-ui').classList.remove('hidden'); // Spinner dikhao
    document.getElementById('chat-messages').innerHTML = ''; 

    // 4. Turant naya partner dhoondhna shuru karo
    // Note: Agar user form bharke andar aaya tha, toh level/username field se mil jayenge
    setTimeout(() => {
        socket.emit('start-search', {
            name: document.getElementById('username').value,
            level: document.getElementById('level').value,
            peerId: myPeerId
        });
    }, 1500); // Thoda time delay server sync ke liye
});

socket.on('partner-disconnected', () => {
    // Agar currently call me the tabhi alert aaye, skip ke time nahi
    if(currentCall){
       endCallProcess("Partner has left the platform.");
    }
});

function endCallProcess(message) {
    alert(message);
    location.reload(); 
}

socket.on('kicked-by-admin', () => {
    alert("You have been kicked out by the Admin.");
    location.reload();
});

// ====== CHAT FUNCTIONALITY ======

function toggleChat() {
    const chatBox = document.getElementById('chatBox');
    if (chatBox.classList.contains('hidden')) {
        chatBox.classList.remove('hidden');
    } else {
        chatBox.classList.add('hidden');
    }
}

// Enter key press karne par message send karna
function handleKeyPress(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('chatInputMsg');
    const message = input.value.trim();

    if (message !== "") {
        // UI par apna message dikhana
        appendMessage('You', message, 'msg-sent');
        
        // Server ko message bhejna
        socket.emit('send-message', message);
        
        // Input clear karna
        input.value = "";
    }
}

// Jab dusre user se message aaye
socket.on('receive-message', (data) => {
    // Agar chat box band hai toh alert dikha sakte hain ya icon highlight kar sakte hain
    const chatBox = document.getElementById('chatBox');
    if(chatBox.classList.contains('hidden')) {
        // Optional: Ek chota visual cue de sakte hain ki message aaya hai
        document.getElementById('chatToggleBtn').style.backgroundColor = '#ff758c';
        setTimeout(() => { document.getElementById('chatToggleBtn').style.backgroundColor = ''; }, 2000);
    }
    
    appendMessage('Partner', data, 'msg-received');
});

// UI par message add karne ka function
function appendMessage(sender, text, className) {
    const chatMessages = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg-bubble ${className}`;
    msgDiv.innerText = text;
    
    chatMessages.appendChild(msgDiv);
    
    // Auto scroll bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ====== ADMIN PANEL LOGIC ======

const adminBtn = document.querySelector('.admin-icon-btn');
if (adminBtn) {
    adminBtn.onclick = () => {
        const modal = document.getElementById('adminModal');
        if(modal) modal.classList.remove('hidden');
    };
}

// ====== SECURE ADMIN LOGIN LOGIC ======
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
    loginBtn.onclick = () => {
        const pass = document.getElementById('adminPass').value;
        // Ab hum yahan check nahi karenge, seedha server ko bhejenge
        socket.emit('admin-login-attempt', pass); 
    };
}

// Jab server bole ki Password SAHI hai
socket.on('admin-login-success', () => {
    document.getElementById('adminModal').classList.add('hidden');
    const dashboard = document.getElementById('adminDashboard');
    if(dashboard) dashboard.classList.remove('hidden');
    
    // Admin room me join ho jao
    const pass = document.getElementById('adminPass').value;
    socket.emit('admin-join', pass); 
});

// Jab server bole ki Password GALAT hai
socket.on('admin-login-failed', () => {
    alert("Wrong Password! Access Denied. 🚫");
});

// 1. Live Tiles Update
socket.on('stats-update', (data) => {
    if(document.getElementById('admin-total-online')) document.getElementById('admin-total-online').innerText = data.online;
    if(document.getElementById('admin-active-calls')) document.getElementById('admin-active-calls').innerText = data.calls;
    if(document.getElementById('admin-searching')) document.getElementById('admin-searching').innerText = data.totalSearching;
});

// 2. Live Users Table Update (FIXED ID)
socket.on('update-admin-list', (usersList) => {
    const tbody = document.getElementById('admin-user-list'); 
    if(!tbody) return;
    
    tbody.innerHTML = ''; 
    
    usersList.forEach((u, index) => {
        const tr = document.createElement('tr');
        const statusColor = u.inCall ? '#00b894' : '#d6a01e';
        const statusText = u.inCall ? 'In Call' : 'Searching';
        
        tr.innerHTML = `
            <td>${u.username || 'Unknown'}</td>
            <td>${u.level || '-'}</td>
            <td><span class="status-badge" style="background:${u.inCall ? '#55efc4' : '#ffeaa7'}; color:${statusColor};">${statusText}</span></td>
            <td>
                <button onclick="kickUser('${u.id}')" class="ban-btn">Kick</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
});

// 3. Admin Kick Function
window.kickUser = (socketId) => {
    if(confirm("Are you sure you want to kick this user?")) {
        socket.emit('kick-user', socketId);
    }
};

// 4. Activity Logs Update (FIXED ID)
socket.on('new-log', (logData) => {
    const logBox = document.getElementById('log-container'); 
    if(!logBox) return;

    const logItem = document.createElement('div');
    logItem.className = 'log-entry';
    logItem.innerHTML = `<span class="log-time">[${logData.time}]</span> <strong class="log-event">${logData.event}:</strong> ${logData.details}`;
    
    logBox.prepend(logItem); 
});

// Front Page Live User Count
socket.on('updateUserCount', (count) => {
    const liveText = document.getElementById('live-count-text');
    if (liveText) liveText.innerText = `${count} Students Online Practice Kar Rahe Hain`;
});

function closeAdminModal() {
    const modal = document.getElementById('adminModal');
    if(modal) modal.classList.add('hidden');
}

window.logoutAdmin = () => {
    const dashboard = document.getElementById('adminDashboard');
    if(dashboard) dashboard.classList.add('hidden');
    location.reload();
};

// ====== CONTROL BUTTONS ======
function toggleAudio() {
    if (localStream) {
        const enabled = localStream.getAudioTracks()[0].enabled;
        localStream.getAudioTracks()[0].enabled = !enabled;
        document.getElementById('micBtn').innerHTML = !enabled ? "🎤" : "🔇";
    }
}

function toggleVideo() {
    if (localStream) {
        const enabled = localStream.getVideoTracks()[0].enabled;
        localStream.getVideoTracks()[0].enabled = !enabled;
        document.getElementById('camBtn').innerHTML = !enabled ? "📷" : "🚫";
    }
}