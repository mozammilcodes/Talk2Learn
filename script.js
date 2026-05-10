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
        if (currentCall) {
            autoSearchAfterDisconnect();
        }
    });
}

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

// ====== CANCEL SEARCH FUNCTION ======
function cancelSearch() {
    console.log("🚫 Canceling search...");

    // 1. Server ko batao ki search rok de
    socket.emit('cancel-search');

    // 2. UI Reset karo (Loading chupao, Home screen wapas lao)
    document.getElementById('loading-ui').classList.add('hidden');
    document.getElementById('home-content').classList.remove('hidden');

    // 3. Agar camera on ho gaya tha, toh usko band kar do taaki light jalte na rahe
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
}

// 2. Jab partner achanak leave kar de (Auto-Search me jayega)
socket.on('partner-disconnected', () => {
    if (currentCall) {
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

    // ====== ANTI-SPAM (Button Disable Logic) ======
    const skipBtn = document.getElementById('skipBtn');
    if (skipBtn) {
        skipBtn.disabled = true; 
        skipBtn.style.opacity = "0.5"; 

        setTimeout(() => {
            skipBtn.disabled = false;
            skipBtn.style.opacity = "1";
        }, 2000);
    }
    // ==========================================================

    if (currentCall) {
        const callToClose = currentCall;
        currentCall = null; 
        callToClose.close(); 
    }

    socket.emit('skip-partner');

    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;

    document.getElementById('video-ui').classList.add('hidden');
    document.getElementById('chatBox').classList.add('hidden');
    document.getElementById('home-content').classList.add('hidden');
    document.getElementById('loading-ui').classList.remove('hidden');
    document.getElementById('chat-messages').innerHTML = '';

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

    if (currentCall) {
        const callToClose = currentCall;
        currentCall = null;
        callToClose.close();
    }

    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;

    document.getElementById('video-ui').classList.add('hidden');
    document.getElementById('chatBox').classList.add('hidden');
    document.getElementById('home-content').classList.add('hidden'); 
    document.getElementById('loading-ui').classList.remove('hidden'); 
    document.getElementById('chat-messages').innerHTML = '';

    setTimeout(() => {
        socket.emit('start-search', {
            name: document.getElementById('username').value,
            level: document.getElementById('level').value,
            peerId: myPeerId
        });
    }, 1500); 
});

socket.on('partner-disconnected', () => {
    if (currentCall) {
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

function handleKeyPress(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('chatInputMsg');
    const message = input.value.trim();

    if (message !== "") {
        appendMessage('You', message, 'msg-sent');
        socket.emit('send-message', message);
        input.value = "";
    }
}

socket.on('receive-message', (data) => {
    const chatBox = document.getElementById('chatBox');
    if (chatBox.classList.contains('hidden')) {
        document.getElementById('chatToggleBtn').style.backgroundColor = '#ff758c';
        setTimeout(() => { document.getElementById('chatToggleBtn').style.backgroundColor = ''; }, 2000);
    }
    appendMessage('Partner', data, 'msg-received');
});

function appendMessage(sender, text, className) {
    const chatMessages = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg-bubble ${className}`;
    msgDiv.innerText = text;

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ====== ADMIN PANEL LOGIC ======

const adminBtn = document.querySelector('.admin-icon-btn');
if (adminBtn) {
    adminBtn.onclick = () => {
        const modal = document.getElementById('adminModal');
        if (modal) modal.classList.remove('hidden');
    };
}

// ====== SECURE ADMIN LOGIN LOGIC ======
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
    loginBtn.onclick = () => {
        const pass = document.getElementById('adminPass').value;
        socket.emit('admin-login-attempt', pass);
    };
}

socket.on('admin-login-success', () => {
    document.getElementById('adminModal').classList.add('hidden');
    const dashboard = document.getElementById('adminDashboard');
    if (dashboard) dashboard.classList.remove('hidden');

    const pass = document.getElementById('adminPass').value;
    socket.emit('admin-join', pass);
});

socket.on('admin-login-failed', () => {
    alert("Wrong Password! Access Denied. 🚫");
});

socket.on('stats-update', (data) => {
    if (document.getElementById('admin-total-online')) document.getElementById('admin-total-online').innerText = data.online;
    if (document.getElementById('admin-active-calls')) document.getElementById('admin-active-calls').innerText = data.calls;
    if (document.getElementById('admin-searching')) document.getElementById('admin-searching').innerText = data.totalSearching;
});

socket.on('update-admin-list', (usersList) => {
    const tbody = document.getElementById('admin-user-list');
    if (!tbody) return;

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

window.kickUser = (socketId) => {
    if (confirm("Are you sure you want to kick this user?")) {
        socket.emit('kick-user', socketId);
    }
};

socket.on('new-log', (logData) => {
    const logBox = document.getElementById('log-container');
    if (!logBox) return;

    const logItem = document.createElement('div');
    logItem.className = 'log-entry';
    logItem.innerHTML = `<span class="log-time">[${logData.time}]</span> <strong class="log-event">${logData.event}:</strong> ${logData.details}`;

    logBox.prepend(logItem);
});

socket.on('updateUserCount', (count) => {
    const liveText = document.getElementById('live-count-text');
    if (liveText) liveText.innerText = `${count} Students Online Practice Kar Rahe Hain`;
});

function closeAdminModal() {
    const modal = document.getElementById('adminModal');
    if (modal) modal.classList.add('hidden');
}

window.logoutAdmin = () => {
    const dashboard = document.getElementById('adminDashboard');
    if (dashboard) dashboard.classList.add('hidden');
    location.reload();
};

// ====== ADMIN LOGIN ENTER KEY LOGIC ======
const adminPassInput = document.getElementById('adminPass');
if (adminPassInput) {
    adminPassInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('loginBtn').click(); // Enter dabate hi Login button click ho jayega
        }
    });
}

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

// ==========================================================
// ====== WHATSAPP STYLE: PIP DRAG & DROP + SWAP LOGIC ======
// ==========================================================

const localVidEl = document.getElementById('localVideo');
const remoteVidEl = document.getElementById('remoteVideo');

let isDragging = false;
let startX, startY, initialLeft, initialTop;
let hasMoved = false; 

[localVidEl, remoteVidEl].forEach(vid => {
    vid.addEventListener('mousedown', dragStart);
    vid.addEventListener('touchstart', dragStart, { passive: false });
    vid.addEventListener('click', handleTap);
});

window.addEventListener('mousemove', dragMove);
window.addEventListener('mouseup', dragEnd);
window.addEventListener('touchmove', dragMove, { passive: false });
window.addEventListener('touchend', dragEnd);

function dragStart(e) {
    if (e.target.classList.contains('video-main')) return;

    if (e.type === 'touchstart') {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    } else {
        startX = e.clientX;
        startY = e.clientY;
    }

    const rect = e.target.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    e.target.style.setProperty('bottom', 'auto', 'important');
    e.target.style.setProperty('right', 'auto', 'important');
    e.target.style.setProperty('left', initialLeft + 'px', 'important');
    e.target.style.setProperty('top', initialTop + 'px', 'important');

    isDragging = true;
    hasMoved = false;
}

function dragMove(e) {
    if (!isDragging) return;

    let currentX, currentY;
    if (e.type === 'touchmove') {
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
    } else {
        currentX = e.clientX;
        currentY = e.clientY;
    }

    let deltaX = currentX - startX;
    let deltaY = currentY - startY;

    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        hasMoved = true;
    }

    let newLeft = initialLeft + deltaX;
    let newTop = initialTop + deltaY;

    const pip = document.querySelector('.video-pip');
    if (pip) {
        const maxX = window.innerWidth - pip.offsetWidth;
        const maxY = window.innerHeight - pip.offsetHeight;

        newLeft = Math.max(0, Math.min(newLeft, maxX));
        newTop = Math.max(0, Math.min(newTop, maxY));

        pip.style.setProperty('left', newLeft + 'px', 'important');
        pip.style.setProperty('top', newTop + 'px', 'important');
    }

    if (e.cancelable) e.preventDefault();
}

function dragEnd(e) {
    isDragging = false;
}

function handleTap(e) {
    if (e.target.classList.contains('video-main')) return;
    if (!hasMoved) {
        swapVideos();
    }
}

function swapVideos() {
    const localVid = document.getElementById('localVideo');
    const remoteVid = document.getElementById('remoteVideo');

    if (localVid.classList.contains('video-pip')) {
        localVid.classList.replace('video-pip', 'video-main');
        remoteVid.classList.replace('video-main', 'video-pip');
    } else {
        localVid.classList.replace('video-main', 'video-pip');
        remoteVid.classList.replace('video-pip', 'video-main');
    }

    localVid.style = "";
    remoteVid.style = "";
}

socket.on('match-found', () => {
    const local = document.getElementById('localVideo');
    const remote = document.getElementById('remoteVideo');
    if (local) {
        local.className = 'video-pip';
        local.style = '';
    }
    if (remote) {
        remote.className = 'video-main';
        remote.style = '';
    }
});

// =========================================================
// ====== LAPTOP ONLY: CHAT BOX DRAG & DROP LOGIC ======
// =========================================================

const chatBoxEl = document.getElementById('chatBox');
const chatHeaderEl = chatBoxEl.querySelector('.chat-header');

let isDraggingChat = false;
let startXChat, startYChat, initialLeftChat, initialTopChat;

if(chatHeaderEl) {
    chatHeaderEl.addEventListener('mousedown', dragStartChat);
}

window.addEventListener('mousemove', dragMoveChat);
window.addEventListener('mouseup', dragEndChat);

function dragStartChat(e) {
    if (chatBoxEl.classList.contains('hidden')) return;
    if (e.button !== 0) return;

    startXChat = e.clientX;
    startYChat = e.clientY;

    const rect = chatBoxEl.getBoundingClientRect();
    initialLeftChat = rect.left;
    initialTopChat = rect.top;

    chatBoxEl.style.position = 'absolute';
    chatBoxEl.style.left = initialLeftChat + 'px';
    chatBoxEl.style.top = initialTopChat + 'px';
    chatBoxEl.style.margin = '0'; 

    isDraggingChat = true;
}

function dragMoveChat(e) {
    if (!isDraggingChat) return;

    let deltaX = e.clientX - startXChat;
    let deltaY = e.clientY - startYChat;

    let newLeft = initialLeftChat + deltaX;
    let newTop = initialTopChat + deltaY;

    const maxX = window.innerWidth - chatBoxEl.offsetWidth;
    const maxY = window.innerHeight - chatBoxEl.offsetHeight;

    newLeft = Math.max(0, Math.min(newLeft, maxX));
    newTop = Math.max(0, Math.min(newTop, maxY));

    chatBoxEl.style.left = newLeft + 'px';
    chatBoxEl.style.top = newTop + 'px';
}

function dragEndChat() {
    isDraggingChat = false;
}

// =========================================================
// ====== NAYA: ADMIN CHAT MONITOR & VAULT LOGIC ======
// =========================================================

// 1. LIVE CHAT FEED
socket.on('live-chat-update', (chat) => {
    const chatFeed = document.getElementById('admin-chat-feed');
    if (!chatFeed) return;

    const placeholder = chatFeed.querySelector('p');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.className = 'admin-chat-entry';
    entry.innerHTML = `
        <span class="chat-time">[${chat.time}]</span> 
        <span class="chat-sender">${chat.sender}:</span> 
        <span class="chat-text">${chat.text}</span>
    `;
    
    chatFeed.prepend(entry);

    if (chatFeed.children.length > 50) {
        chatFeed.lastChild.remove();
    }
});

// 2. VAULT: HISTORY LOAD KARNA
window.loadChatHistory = () => {
    const keywordInput = document.getElementById('searchChatKeyword');
    const keyword = keywordInput ? keywordInput.value : "";
    
    const historyContainer = document.getElementById('history-results');
    if (historyContainer) {
        historyContainer.innerHTML = '<p style="text-align:center; color: #f1c40f; margin-top: 20px;">Fetching records from database...</p>';
    }

    socket.emit('request-chat-history', keyword);
}

// 3. VAULT: HISTORY MILNE PAR UI MEIN DIKHANA
socket.on('chat-history-data', (chats) => {
    const historyContainer = document.getElementById('history-results');
    if (!historyContainer) return;

    historyContainer.innerHTML = ''; 

    if (chats.length === 0) {
        historyContainer.innerHTML = '<p style="text-align:center; color: #747d8c; margin-top: 20px;">No chat records found.</p>';
        return;
    }

    chats.forEach(chat => {
        const timeStr = new Date(chat.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        
        const card = document.createElement('div');
        card.className = 'history-card';
        card.id = `chat-card-${chat._id}`; 
        card.innerHTML = `
            <div class="history-card-content">
                <span class="history-time">${timeStr}</span>
                <span class="history-sender">${chat.senderName}:</span>
                <span class="history-text">"${chat.message}"</span>
            </div>
            <button class="history-del-btn" onclick="deleteSingleChat('${chat._id}')">🗑️ Delete</button>
        `;
        historyContainer.appendChild(card);
    });
});

// 4. VAULT: SINGLE CHAT DELETE KARNA
window.deleteSingleChat = (chatId) => {
    if (confirm("Are you sure you want to delete this specific message permanently?")) {
        const card = document.getElementById(`chat-card-${chatId}`);
        if (card) {
            card.style.opacity = '0.5';
            card.innerText = 'Deleting...';
        }
        socket.emit('delete-single-chat', chatId);
    }
}

// 5. VAULT: CLEAR ALL CHATS (CLEANUP)
window.deleteAllChats = () => {
    const keywordInput = document.getElementById('searchChatKeyword');
    if (keywordInput && keywordInput.value !== "") {
         alert("Please clear the search box before deleting all chats to avoid confusion.");
         return;
    }

    if (confirm("⚠️ WARNING: This will permanently delete ALL chat history from the database. Are you sure?")) {
        const historyContainer = document.getElementById('history-results');
        if (historyContainer) {
            historyContainer.innerHTML = '<p style="text-align:center; color: #e84118; margin-top: 20px;">Deleting entire database... Please wait.</p>';
        }
        socket.emit('delete-all-chats');
    }
}

// 6. VAULT: DELETE SUCCESS MESSAGE
socket.on('chat-delete-success', () => {
    loadChatHistory(); 
});

// ====== SEARCH BOX ENTER KEY LOGIC ======
const searchInputEl = document.getElementById('searchChatKeyword');
if(searchInputEl) {
    searchInputEl.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            loadChatHistory(); // Enter dabate hi search shuru
        }
    });
}