const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // كاش لحفظ بيانات السيرفرات لتسريع الفتح

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cors());
app.use(express.static('public'));

// دوال التشفير وفك التشفير البسيطة (Base64)
const encodeId = (id) => Buffer.from(id).toString('base64');
const decodeId = (encoded) => Buffer.from(encoded, 'base64').toString('utf-8');

// 1. مسار المشغل الرئيسي (مثال: /m?v=bGl2ZV90dl9iZWluc3BvcnQ1)
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

        // تحليل بيانات السيرفرات وتخزينها في الكاش (كما في ProxyService.java)
        const parsedServers = serversData.map((srv, index) => {
            let realUrl = "";
            let customHeaders = {};
            let swapKey = null;
            let swapVal = null;
            let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

            try {
                // إذا كانت الـ url عبارة عن JSON متداخل
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

                // إضافة Origin و Referer تلقائياً إذا لم تكن موجودة
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
            cache.set(`srv_${id_live}_${index}`, serverConfig); // حفظ الإعدادات في الكاش
            return { index, name: serverConfig.name };
        });

        res.render('player', { 
            match: matchInfo, 
            servers: parsedServers, 
            id_live,
            fullUrl: req.protocol + '://' + req.get('host') + req.originalUrl
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("حدث خطأ أثناء جلب البيانات");
    }
});

// 2. مسار البروكسي لملف m3u8 (لتعديل الروابط الداخلية)
app.get('/proxy/playlist.m3u8', async (req, res) => {
    const { id, s } = req.query; // id_live & server index
    const srvConfig = cache.get(`srv_${id}_${s}`);
    
    if (!srvConfig || !srvConfig.realUrl) return res.status(404).send("Server not found");

    try {
        const response = await axios.get(srvConfig.realUrl, { 
            headers: srvConfig.customHeaders,
            responseType: 'text'
        });

        let m3u8 = response.data;
        const baseUrl = srvConfig.realUrl.substring(0, srvConfig.realUrl.lastIndexOf('/') + 1);

        // تعديل الروابط الداخلية لقطع الفيديو لتمر عبر البروكسي الخاص بنا
        const lines = m3u8.split('\n');
        const modifiedLines = lines.map(line => {
            let trimmed = line.trim();
            if (!trimmed.startsWith('#') && trimmed !== '') {
                let segmentUrl = trimmed;
                if (!segmentUrl.startsWith('http')) {
                    segmentUrl = baseUrl + segmentUrl;
                }
                
                // تطبيق Swap إذا وجد (كما في تطبيق الأندرويد)
                if (srvConfig.swapKey && srvConfig.swapVal !== null && segmentUrl.includes(srvConfig.swapKey)) {
                    segmentUrl = segmentUrl.replace(srvConfig.swapKey, srvConfig.swapVal);
                }

                // توجيه الطلب إلى مسار القطع الخاص بنا
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
    // لغرض التجربة، اطبع رابط تجريبي
    console.log(`Test link: http://localhost:${PORT}/m?v=${encodeId('live_tv_beinsport5')}`);
});
