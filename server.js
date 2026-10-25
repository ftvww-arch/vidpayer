const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const ejs = require('ejs');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // كاش لحفظ بيانات السيرفرات لمدة ساعة لتسريع الفتح

app.use(cors());

// دوال التشفير وفك التشفير البسيطة (Base64)
const encodeId = (id) => Buffer.from(id).toString('base64');
const decodeId = (encoded) => Buffer.from(encoded, 'base64').toString('utf-8');

// واجهة المشغل كاملة كمتغير نصي
const htmlTemplate = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title><%= match.title %> - مشغل البث</title>
    <link rel="preconnect" href="https://cdn.jsdelivr.net">
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body, html { height: 100%; width: 100%; background-color: #000; font-family: 'Tajawal', sans-serif; overflow: hidden; display: flex; justify-content: center; align-items: center; }
        
        .player-container {
            position: relative; width: 100%; height: 100%; max-width: 1200px; max-height: 800px;
            background-color: #000; overflow: hidden; cursor: default; user-select: none; -webkit-user-select: none;
        }

        .loading-overlay {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(10px);
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            z-index: 25; transition: opacity 0.3s ease;
        }
        .spinner { width: 50px; height: 50px; border: 4px solid rgba(255, 255, 255, 0.1); border-top: 4px solid #5c4dff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px; }
        .loading-text { color: #fff; font-size: 15px; font-weight: 500; letter-spacing: 0.5px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        #video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; z-index: 2; }

        .glass-bar {
            position: absolute; left: 50%; transform: translateX(-50%); z-index: 10; height: 58px;
            background: rgba(20, 22, 32, 0.78); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
            border-radius: 14px; display: flex; align-items: center; justify-content: space-between;
            padding: 0 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.08);
            transition: opacity 0.4s ease, transform 0.4s ease, display 0.2s ease;
        }

        .glass-bar.title-bar { width: 95%; max-width: 980px; height: 68px; top: 25px; }
        .glass-bar.controls-bar { width: 86%; max-width: 820px; bottom: 25px; }

        .player-container.hide-ui { cursor: none; }
        .player-container.hide-ui .glass-bar { opacity: 0; pointer-events: none; }
        .player-container.hide-ui .glass-bar.title-bar { transform: translate(-50%, -15px); }
        .player-container.hide-ui .glass-bar.controls-bar { transform: translate(-50%, 15px); }

        .logo-text { color: #ffffff; font-size: 17px; font-weight: 700; text-decoration: none; transition: opacity 0.2s; letter-spacing: 0.5px; }
        .logo-text:hover { opacity: 0.8; }
        .video-title { color: #e5e7eb; font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%; text-align: right; }

        .left-controls { display: flex; align-items: center; gap: 8px; width: 100px; }
        .live-dot { width: 8px; height: 8px; background-color: #ff3b30; border-radius: 50%; box-shadow: 0 0 8px rgba(255, 59, 48, 0.8); }
        .live-text { color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }

        .center-controls { position: absolute; left: 50%; transform: translateX(-50%); display: flex; justify-content: center; align-items: center; }
        .play-pause-btn { width: 44px; height: 44px; background-color: #5c4dff; border: none; border-radius: 50%; display: flex; justify-content: center; align-items: center; cursor: pointer; transition: transform 0.2s ease, background-color 0.2s; box-shadow: 0 4px 12px rgba(92, 77, 255, 0.4); }
        .play-pause-btn:hover { transform: scale(1.1); background-color: #4a3be0; }
        .play-pause-icon { fill: #ffffff; width: 18px; height: 18px; }

        .right-controls { display: flex; align-items: center; gap: 18px; width: 130px; justify-content: flex-end; }
        .control-icon-btn { background: none; border: none; cursor: pointer; display: flex; justify-content: center; align-items: center; opacity: 0.8; transition: opacity 0.2s, transform 0.2s; }
        .control-icon-btn:hover { opacity: 1; transform: scale(1.1); }
        .icon-svg { fill: #d1d5db; width: 20px; height: 20px; }

        .server-popup { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 340px; background: rgba(20, 22, 35, 0.96); backdrop-filter: blur(16px); border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.12); color: white; z-index: 100; padding: 20px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8); }
        .popup-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 10px; }
        .popup-title { display: flex; flex-direction: column; }
        .popup-title .en { font-size: 11px; color: #9ca3af; text-transform: uppercase; font-weight: 500; }
        .popup-title .ar { font-size: 14px; font-weight: 700; margin-top: 2px; }
        .close-server-popup { background: none; border: none; color: #9ca3af; font-size: 20px; cursor: pointer; }
        .close-server-popup:hover { color: #ffffff; }

        .server-list { display: flex; flex-direction: column; gap: 6px; max-height: 250px; overflow-y: auto; }
        .server-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-radius: 10px; cursor: pointer; transition: background-color 0.2s; }
        .server-item:hover { background-color: rgba(255, 255, 255, 0.08); }
        .server-item.active { background-color: rgba(92, 77, 255, 0.3); border: 1px solid rgba(92, 77, 255, 0.4); }
        .server-info { display: flex; flex-direction: column; }
        .server-info .en { font-size: 13px; font-weight: 500; }
        .server-info .ar { font-size: 12px; color: #9ca3af; margin-top: 2px; font-weight: 500; }
        .server-item.active .server-info .en, .server-item.active .server-info .ar { color: #ffffff; }
        .check-icon { width: 18px; height: 18px; fill: #5c4dff; display: none; }
        .signal-icon { width: 16px; height: 16px; fill: #9ca3af; }
        .server-item.active .check-icon { display: block; }
        .server-item.active .signal-icon { display: none; }

        .modal { display: none; position: fixed; z-index: 150; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.8); justify-content: center; align-items: center; backdrop-filter: blur(8px); }
        .modal-content { background-color: rgba(25, 27, 40, 0.95); border-radius: 16px; padding: 24px; width: 90%; max-width: 500px; border: 1px solid rgba(255, 255, 255, 0.1); color: white; display: flex; flex-direction: column; gap: 16px; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; }
        .modal-header h2 { font-size: 18px; font-weight: 700; }
        .close-modal { background: none; border: none; color: #d1d5db; font-size: 22px; cursor: pointer; }
        #embedCodeArea { background-color: rgba(0,0,0,0.4); border: 1px solid rgba(255, 255, 255, 0.1); color: #a78bfa; font-family: monospace; padding: 12px; border-radius: 8px; resize: none; width: 100%; height: 100px; font-size: 12px; }
        #copyEmbedBtn { background-color: #5c4dff; color: white; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 14px; transition: background-color 0.2s; }
        #copyEmbedBtn:hover { background-color: #4a3be0; }

        @media (max-width: 768px) {
            .glass-bar.title-bar { width: 96%; padding: 0 16px; top: 15px; }
            .glass-bar.controls-bar { width: 92%; padding: 0 16px; bottom: 15px; }
            .video-title { font-size: 13px; max-width: 50%; }
        }
    </style>
</head>
<body>
    <div class="player-container" id="playerContainer">
        <!-- شاشة التحميل -->
        <div id="loadingOverlay" class="loading-overlay">
            <div class="spinner"></div>
            <div class="loading-text">جاري الاتصال بالبث المباشر...</div>
        </div>

        <video id="video" playsinline webkit-playsinline autoplay muted></video>

        <!-- الشريط العلوي -->
        <div class="glass-bar title-bar" id="titleBar">
            <a href="#" target="_blank" class="logo-text">ياسين Tv بلس</a>
            <div class="video-title" dir="rtl"><%= match.title %> (<%= match.league %>)</div>
        </div>
        
        <!-- قائمة اختيار السيرفرات -->
        <div id="serverPopup" class="server-popup">
            <div class="popup-header">
                <div class="popup-title">
                    <span class="en">STREAM SERVER SELECTION</span>
                    <span class="ar" dir="rtl">اختر الخادم للبث المباشر</span>
                </div>
                <button class="close-server-popup" id="closeServerPopup">&times;</button>
            </div>
            <div class="server-list">
                <% servers.forEach(function(server, i) { %>
                    <div class="server-item <%= i === 0 ? 'active' : '' %>" onclick="changeServer(<%= server.index %>, this)">
                        <div class="server-info">
                            <span class="en"><%= server.name %></span>
                        </div>
                        <svg class="check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        <svg class="signal-icon" viewBox="0 0 24 24"><path d="M12 11c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 2c0-3.31-2.69-6-6-6s-6 2.69-6 6c0 2.22 1.21 4.15 3 5.19l1-1.74c-1.19-.7-2-1.97-2-3.45 0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.48-.81 2.75-2 3.45l1 1.74c1.79-1.04 3-2.97 3-5.19Z"/></svg>
                    </div>
                <% }); %>
            </div>
        </div>
        
        <!-- الشريط السفلي -->
        <div class="glass-bar controls-bar" id="controlsBar">
            <div class="left-controls">
                <div class="live-dot"></div>
                <span class="live-text">LIVE</span>
            </div>
            <div class="center-controls">
                <button class="play-pause-btn" id="playPauseBtn">
                    <svg class="play-pause-icon" id="pauseIcon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
                    <svg class="play-pause-icon" id="playIcon" style="display: none;" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
                </button>
            </div>
            <div class="right-controls">
                <button class="control-icon-btn" id="embedBtn"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M8.293 6.293a1 1 0 0 1 1.414 0L14.414 11H19a1 1 0 0 1 0 2h-4.586l-4.707 4.707a1 1 0 0 1-1.414-1.414L11.586 13H5a1 1 0 0 1 0-2h6.586L8.293 7.707a1 1 0 0 1 0-1.414z"/><path d="M19 19a1 1 0 1 1-2 0V5a1 1 0 0 1 2 0v14z"/></svg></button>
                <button class="control-icon-btn" id="settingsBtn"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></button>
                <button class="control-icon-btn" id="fullscreenBtn"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
            </div>
        </div>
    </div>

    <!-- نافذة كود التضمين -->
    <div id="embedModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Embed Code / كود التضمين</h2>
                <button class="close-modal" id="closeEmbedModal">&times;</button>
            </div>
            <textarea id="embedCodeArea" readonly><iframe src="<%= fullUrl %>" width="100%" height="500" frameborder="0" allowfullscreen></iframe></textarea>
            <button id="copyEmbedBtn">Copy Code / نسخ الكود</button>
        </div>
    </div>

    <script>
        const video = document.getElementById('video');
        const playerContainer = document.getElementById('playerContainer');
        const id_live = "<%= id_live %>";
        let hls = null;
        let isPlaying = true;
        let inactivityTimeout;

        function resetInactivityTimer() {
            playerContainer.classList.remove('hide-ui');
            clearTimeout(inactivityTimeout);
            inactivityTimeout = setTimeout(() => {
                if (!video.paused && document.getElementById('serverPopup').style.display !== 'block') {
                    playerContainer.classList.add('hide-ui');
                }
            }, 3000);
        }
        playerContainer.addEventListener('mousemove', resetInactivityTimer);

        function showLoading() { document.getElementById('loadingOverlay').style.opacity = '1'; }
        function hideLoading() { document.getElementById('loadingOverlay').style.opacity = '0'; }

        function changeServer(serverIndex, element = null) {
            showLoading();
            
            if(element) {
                document.querySelectorAll('.server-item').forEach(el => el.classList.remove('active'));
                element.classList.add('active');
            }

            const manifestUrl = \`/proxy/playlist.m3u8?id=\${id_live}&s=\${serverIndex}\`;

            if (hls) { hls.destroy(); hls = null; }
            
            if (Hls.isSupported()) {
                hls = new Hls({ enableWorker: true, lowLatencyMode: true }); 
                hls.loadSource(manifestUrl); 
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().then(hideLoading).catch(hideLoading); });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = manifestUrl; 
                video.addEventListener('loadedmetadata', () => { video.play().then(hideLoading).catch(hideLoading); });
            }
            document.getElementById('serverPopup').style.display = 'none';
        }

        <% if (servers.length > 0) { %>
            changeServer(0);
        <% } %>

        const playPauseBtn = document.getElementById('playPauseBtn');
        const pauseIcon = document.getElementById('pauseIcon');
        const playIcon = document.getElementById('playIcon');

        playPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            video.paused ? video.play() : video.pause();
        });

        video.addEventListener('play', () => { 
            isPlaying = true; pauseIcon.style.display = 'block'; playIcon.style.display = 'none'; resetInactivityTimer(); 
        });
        
        video.addEventListener('pause', () => { 
            isPlaying = false; pauseIcon.style.display = 'none'; playIcon.style.display = 'block'; 
            playerContainer.classList.remove('hide-ui'); clearTimeout(inactivityTimeout); 
        });

        document.getElementById('fullscreenBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!document.fullscreenElement) {
                if (playerContainer.requestFullscreen) playerContainer.requestFullscreen();
                else if (playerContainer.webkitRequestFullscreen) playerContainer.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
        });

        const serverPopup = document.getElementById('serverPopup');
        const settingsBtn = document.getElementById('settingsBtn');
        
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            serverPopup.style.display = serverPopup.style.display === 'block' ? 'none' : 'block';
        });
        
        document.getElementById('closeServerPopup').addEventListener('click', () => serverPopup.style.display = 'none');

        const embedModal = document.getElementById('embedModal');
        document.getElementById('embedBtn').addEventListener('click', () => embedModal.style.display = 'flex');
        document.getElementById('closeEmbedModal').addEventListener('click', () => embedModal.style.display = 'none');
        document.getElementById('copyEmbedBtn').addEventListener('click', () => {
            document.getElementById('embedCodeArea').select(); 
            document.execCommand('copy'); 
            alert('تم نسخ كود التضمين!'); 
            embedModal.style.display = 'none';
        });

        window.addEventListener('click', (event) => {
            if (event.target == embedModal) embedModal.style.display = 'none';
            if (serverPopup.style.display === 'block' && !serverPopup.contains(event.target) && event.target !== settingsBtn) {
                serverPopup.style.display = 'none';
            }
        });
    </script>
</body>
</html>
`;

// 1. مسار المشغل الرئيسي 
app.get('/m', async (req, res) => {
    try {
        const encodedId = req.query.v;
        if (!encodedId) return res.status(400).send("رابط غير صالح");

        const id_live = decodeId(encodedId);

        // جلب بيانات المباراة
        const matchRes = await axios.get('https://api.kirozozo.xyz/ytvplus/mach');
        const matchInfo = matchRes.data.find(m => m.id_live === id_live) || { title: 'بث مباشر', league: '', id_live };

        // جلب السيرفرات
        const serversRes = await axios.get(`https://api.kirozozo.xyz/ytvplus/stream?id_live=${id_live}`);
        const serversData = serversRes.data;

        const parsedServers = serversData.map((srv, index) => {
            let realUrl = "";
            let customHeaders = {};
            let swapKey = null;
            let swapVal = null;
            let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

            try {
                if (srv.data.url.startsWith('{') && srv.data.url.endsWith('}')) {
                    const nestedObj = JSON.parse(srv.data.url);
                    realUrl = nestedObj.url;
                    if (nestedObj.agent) userAgent = nestedObj.agent;
                    
                    if (nestedObj.swap) {
                        swapKey = Object.keys(nestedObj.swap)[0];
                        swapVal = nestedObj.swap[swapKey];
                    }
                    if (nestedObj.headers) {
                        customHeaders = { ...nestedObj.headers };
                    }
                } else {
                    realUrl = srv.data.url;
                }

                if (!customHeaders['User-Agent']) customHeaders['User-Agent'] = userAgent;

                if (realUrl) {
                    const parsedUrl = new URL(realUrl);
                    const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
                    if (!customHeaders['Referer']) customHeaders['Referer'] = origin + '/';
                    if (!customHeaders['Origin']) customHeaders['Origin'] = origin;
                }
            } catch (e) {
                realUrl = srv.data.url;
            }

            const serverConfig = { realUrl, customHeaders, swapKey, swapVal, name: srv.name || `سيرفر ${index + 1}` };
            cache.set(`srv_${id_live}_${index}`, serverConfig); 
            return { index, name: serverConfig.name };
        });

        // دمج البيانات مع كود HTML باستخدام EJS
        const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
        const renderedHtml = ejs.render(htmlTemplate, { match: matchInfo, servers: parsedServers, id_live, fullUrl });
        
        res.send(renderedHtml);

    } catch (error) {
        console.error(error);
        res.status(500).send("حدث خطأ أثناء جلب البيانات");
    }
});

// 2. مسار البروكسي لملف m3u8
app.get('/proxy/playlist.m3u8', async (req, res) => {
    const { id, s } = req.query; 
    const srvConfig = cache.get(`srv_${id}_${s}`);
    
    if (!srvConfig || !srvConfig.realUrl) return res.status(404).send("Server not found");

    try {
        const response = await axios.get(srvConfig.realUrl, { 
            headers: srvConfig.customHeaders,
            responseType: 'text'
        });

        let m3u8 = response.data;
        const baseUrl = srvConfig.realUrl.substring(0, srvConfig.realUrl.lastIndexOf('/') + 1);

        const lines = m3u8.split('\n');
        const modifiedLines = lines.map(line => {
            let trimmed = line.trim();
            if (!trimmed.startsWith('#') && trimmed !== '') {
                let segmentUrl = trimmed;
                if (!segmentUrl.startsWith('http')) {
                    segmentUrl = baseUrl + segmentUrl;
                }
                
                if (srvConfig.swapKey && srvConfig.swapVal !== null && segmentUrl.includes(srvConfig.swapKey)) {
                    segmentUrl = segmentUrl.replace(srvConfig.swapKey, srvConfig.swapVal);
                }

                return `/proxy/segment.ts?id=${id}&s=${s}&url=${encodeURIComponent(segmentUrl)}`;
            }
            return line;
        });

        res.set({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*'
        });
        res.send(modifiedLines.join('\n'));

    } catch (error) {
        res.status(500).send("Playlist Error");
    }
});

// 3. مسار البروكسي لقطع الفيديو (ts)
app.get('/proxy/segment.ts', async (req, res) => {
    const { id, s, url } = req.query;
    const srvConfig = cache.get(`srv_${id}_${s}`);
    
    if (!srvConfig) return res.status(404).send();

    try {
        const response = await axios.get(decodeURIComponent(url), {
            headers: srvConfig.customHeaders,
            responseType: 'stream'
        });

        res.set({
            'Content-Type': 'video/MP2T',
            'Access-Control-Allow-Origin': '*'
        });
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Test link: http://localhost:${PORT}/m?v=${encodeId('live_tv_beinsport5')}`);
});
