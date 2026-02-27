import { db } from './firebase.js';

const TRENDS_COLLECTION = 'bot_settings';

// Firestore 문서 ID
const GOOGLE_TRENDS_DOC = 'google_trends';
const YOUTUBE_TRENDS_DOC = 'youtube_trends';
const NAVER_TRENDS_DOC = 'naver_trends';

// K-POP/패션 관련 키워드 (Google Trends 필터용)
const KPOP_FASHION_KEYWORDS = [
    'kpop', 'k-pop', 'bts', 'blackpink', 'newjeans', 'aespa', 'ive', 'stray kids',
    'twice', 'seventeen', 'nct', 'enhypen', 'le sserafim', 'itzy', 'txt', 'ateez',
    '방탄', '블랙핑크', '뉴진스', '에스파', '아이브', '스트레이키즈', '트와이스', '세븐틴',
    '패션', 'fashion', '공항', 'airport', '컴백', 'comeback', '화보', '무대',
    '앨범', 'album', '뮤비', 'mv', '콘서트', 'concert', '아이돌', 'idol',
    '런웨이', 'runway', '브랜드', 'brand', '앰버서더', 'ambassador',
];

// ─── Google Trends (한국 실시간 인기 검색어) ────────────

/**
 * Google Trends Daily Trends API에서 한국 인기 검색어를 수집합니다.
 * 비공식 API이지만 안정적, 인증 불필요.
 */
async function fetchGoogleTrends() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const url = 'https://trends.google.com/trends/api/dailytrends?hl=ko&tz=-540&geo=KR&ns=15';
        const res = await fetch(url, {
            headers: { 'User-Agent': 'mystyleKPOP-bot/1.0' },
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            console.warn(`[BuzzCollector] Google Trends: HTTP ${res.status}`);
            return null;
        }

        const text = await res.text();
        // Google Trends 응답은 ")]}'\n" 접두사가 붙어 있음
        const cleanText = text.replace(/^\)\]\}'\n/, '');
        const data = JSON.parse(cleanText);

        const days = data?.default?.trendingSearchesDays || [];
        if (days.length === 0) return null;

        const allTrending = [];
        const kpopRelated = [];

        // 최근 2일치 트렌드에서 추출
        for (const day of days.slice(0, 2)) {
            for (const search of (day.trendingSearches || [])) {
                const title = search.title?.query || '';
                const traffic = search.formattedTraffic || '';
                const relatedQueries = (search.relatedQueries || []).map(q => q.query || '').filter(Boolean);

                allTrending.push({
                    keyword: title,
                    traffic,
                    relatedQueries: relatedQueries.slice(0, 3),
                });

                // K-POP/패션 관련 필터
                const combined = `${title} ${relatedQueries.join(' ')}`.toLowerCase();
                const isKpopFashion = KPOP_FASHION_KEYWORDS.some(kw => combined.includes(kw));
                if (isKpopFashion) {
                    kpopRelated.push(title);
                }
            }
        }

        console.log(`[BuzzCollector] Google Trends: ${allTrending.length}개 트렌드, K-POP 관련 ${kpopRelated.length}개`);

        return {
            trendingKeywords: allTrending.slice(0, 20).map(t => t.keyword),
            kpopRelated: kpopRelated.slice(0, 10),
            allTrending: allTrending.slice(0, 20),
        };
    } catch (err) {
        console.warn('[BuzzCollector] Google Trends 수집 실패:', err.message);
        return null;
    }
}

// ─── YouTube Data API (K-POP MV 조회수 트렌드) ─────────

/**
 * YouTube Data API v3로 최근 K-POP 관련 인기 영상을 검색하고 조회수 속도를 분석합니다.
 * YOUTUBE_API_KEY 미설정 시 자동 스킵.
 */
async function fetchYouTubeTrends() {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
        console.log('[BuzzCollector] YouTube API 키 미설정 → 스킵');
        return null;
    }

    try {
        const queries = ['kpop comeback MV', 'kpop fashion 2026', '아이돌 컴백 뮤비'];
        const allVideos = [];

        // 최근 48시간
        const after = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

        for (const query of queries) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&order=viewCount&publishedAfter=${after}&maxResults=5&key=${apiKey}`;
            const searchRes = await fetch(searchUrl, { signal: controller.signal });
            clearTimeout(timeout);

            if (!searchRes.ok) {
                console.warn(`[BuzzCollector] YouTube 검색 "${query}": HTTP ${searchRes.status}`);
                continue;
            }

            const searchData = await searchRes.json();
            const videoIds = (searchData.items || []).map(item => item.id?.videoId).filter(Boolean);

            if (videoIds.length === 0) continue;

            // 영상 통계 조회
            const statsController = new AbortController();
            const statsTimeout = setTimeout(() => statsController.abort(), 10000);

            const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${apiKey}`;
            const statsRes = await fetch(statsUrl, { signal: statsController.signal });
            clearTimeout(statsTimeout);

            if (!statsRes.ok) continue;

            const statsData = await statsRes.json();
            for (const video of (statsData.items || [])) {
                const stats = video.statistics || {};
                const snippet = video.snippet || {};
                const publishedAt = new Date(snippet.publishedAt);
                const ageHours = Math.max((Date.now() - publishedAt.getTime()) / 3600000, 1);
                const viewCount = parseInt(stats.viewCount || '0', 10);

                allVideos.push({
                    title: (snippet.title || '').slice(0, 200),
                    channelTitle: snippet.channelTitle || '',
                    viewCount,
                    likeCount: parseInt(stats.likeCount || '0', 10),
                    commentCount: parseInt(stats.commentCount || '0', 10),
                    velocity: Math.round(viewCount / ageHours), // 시간당 조회수
                    publishedAt: snippet.publishedAt,
                });
            }
        }

        // velocity 기준 정렬
        allVideos.sort((a, b) => b.velocity - a.velocity);
        const hotVideos = allVideos.slice(0, 10);

        // 아티스트명 추출 (채널명 + 제목에서)
        const artistSet = new Set();
        for (const v of hotVideos) {
            const text = `${v.title} ${v.channelTitle}`.toLowerCase();
            for (const kw of KPOP_FASHION_KEYWORDS) {
                if (kw.length >= 3 && text.includes(kw)) {
                    artistSet.add(kw);
                }
            }
        }

        console.log(`[BuzzCollector] YouTube: ${allVideos.length}개 영상, 상위 velocity ${hotVideos[0]?.velocity || 0}회/h`);

        return {
            hotVideos: hotVideos.slice(0, 5),
            trendingArtists: [...artistSet].slice(0, 10),
        };
    } catch (err) {
        console.warn('[BuzzCollector] YouTube 수집 실패:', err.message);
        return null;
    }
}

// ─── Naver DataLab (한국 검색 트렌드 지수) ──────────────

/**
 * Naver DataLab API로 K-POP/패션 키워드의 검색 트렌드 지수를 분석합니다.
 * 기존 NAVER_CLIENT_ID/SECRET 사용. 미설정 시 자동 스킵.
 */
async function fetchNaverTrends() {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.log('[BuzzCollector] Naver API 키 미설정 → 스킵');
        return null;
    }

    try {
        const endDate = new Date().toISOString().slice(0, 10);
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // 키워드 그룹 (최대 5개)
        const keywordGroups = [
            { groupName: 'K-POP 패션', keywords: ['K-POP 패션', '아이돌 패션', 'kpop fashion'] },
            { groupName: '아이돌 컴백', keywords: ['아이돌 컴백', 'K-POP 컴백', 'kpop comeback'] },
            { groupName: '공항패션', keywords: ['공항패션', '아이돌 공항', 'airport fashion'] },
            { groupName: '아이돌 화보', keywords: ['아이돌 화보', 'K-POP 화보', '아이돌 매거진'] },
            { groupName: '뮤직비디오', keywords: ['뮤직비디오 패션', 'MV 의상', '무대의상'] },
        ];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Naver-Client-Id': clientId,
                'X-Naver-Client-Secret': clientSecret,
            },
            body: JSON.stringify({
                startDate,
                endDate,
                timeUnit: 'date',
                keywordGroups,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            console.warn(`[BuzzCollector] Naver DataLab: HTTP ${res.status}`);
            return null;
        }

        const data = await res.json();
        const results = data.results || [];

        const keywordTrends = [];
        for (const group of results) {
            const dataPoints = group.data || [];
            if (dataPoints.length < 2) continue;

            // 최근 2일 vs 이전 5일 평균 비교 → 상승/하락 판정
            const recent = dataPoints.slice(-2);
            const older = dataPoints.slice(0, -2);

            const recentAvg = recent.reduce((s, d) => s + d.ratio, 0) / recent.length;
            const olderAvg = older.length > 0
                ? older.reduce((s, d) => s + d.ratio, 0) / older.length
                : recentAvg;

            let trend = 'stable';
            if (olderAvg > 0) {
                const change = (recentAvg - olderAvg) / olderAvg;
                if (change > 0.15) trend = 'rising';
                else if (change < -0.15) trend = 'falling';
            }

            keywordTrends.push({
                keyword: group.title,
                latestIndex: Math.round(recentAvg),
                trend,
            });
        }

        const risingCount = keywordTrends.filter(t => t.trend === 'rising').length;
        console.log(`[BuzzCollector] Naver DataLab: ${keywordTrends.length}개 키워드, 상승 ${risingCount}개`);

        return { keywordTrends };
    } catch (err) {
        console.warn('[BuzzCollector] Naver DataLab 수집 실패:', err.message);
        return null;
    }
}

// ─── 메인 수집 함수 ──────────────────────────────────────

/**
 * Google Trends + YouTube + Naver DataLab을 병렬로 수집하여 Firestore에 저장합니다.
 * 개별 소스 실패는 다른 소스에 영향을 주지 않습니다.
 */
export async function collectBuzzSignals() {
    if (!db) {
        console.warn('[BuzzCollector] Firebase DB not initialized. Skipping buzz collection.');
        return;
    }

    console.log('[BuzzCollector] 화제성 신호 수집 시작...');

    const [googleData, youtubeData, naverData] = await Promise.all([
        fetchGoogleTrends().catch(err => { console.error('[BuzzCollector] Google Trends 전체 실패:', err.message); return null; }),
        fetchYouTubeTrends().catch(err => { console.error('[BuzzCollector] YouTube 전체 실패:', err.message); return null; }),
        fetchNaverTrends().catch(err => { console.error('[BuzzCollector] Naver DataLab 전체 실패:', err.message); return null; }),
    ]);

    // 각각 독립적으로 Firestore 저장
    const saves = [];

    if (googleData) {
        saves.push(
            db.collection(TRENDS_COLLECTION).doc(GOOGLE_TRENDS_DOC).set({
                lastCollected: new Date(),
                ...googleData,
            })
        );
    }

    if (youtubeData) {
        saves.push(
            db.collection(TRENDS_COLLECTION).doc(YOUTUBE_TRENDS_DOC).set({
                lastCollected: new Date(),
                ...youtubeData,
            })
        );
    }

    if (naverData) {
        saves.push(
            db.collection(TRENDS_COLLECTION).doc(NAVER_TRENDS_DOC).set({
                lastCollected: new Date(),
                ...naverData,
            })
        );
    }

    if (saves.length > 0) {
        await Promise.all(saves);
    }

    const sources = [
        googleData ? 'Google✅' : 'Google❌',
        youtubeData ? 'YouTube✅' : 'YouTube❌',
        naverData ? 'Naver✅' : 'Naver❌',
    ];
    console.log(`[BuzzCollector] 화제성 신호 수집 완료. 소스: ${sources.join(' | ')}`);
}

// ─── 통합 buzzContext 조회 (newsCollector가 호출) ────────

/**
 * newsCollector의 buzzScore 계산에 필요한 외부 트렌드 데이터를 일괄 로드합니다.
 * Google Trends + YouTube + Naver DataLab + X 트렌드 + 내부 트렌드를 모두 포함.
 */
export async function getBuzzContext() {
    if (!db) return { google: null, youtube: null, naver: null, xTrends: null, internalTrends: [] };

    try {
        const [googleDoc, youtubeDoc, naverDoc, xDoc, trendsDoc] = await Promise.all([
            db.collection(TRENDS_COLLECTION).doc(GOOGLE_TRENDS_DOC).get(),
            db.collection(TRENDS_COLLECTION).doc(YOUTUBE_TRENDS_DOC).get(),
            db.collection(TRENDS_COLLECTION).doc(NAVER_TRENDS_DOC).get(),
            db.collection(TRENDS_COLLECTION).doc('external_trends').get(),
            db.collection(TRENDS_COLLECTION).doc('trends').get(),
        ]);

        return {
            google: googleDoc.exists ? googleDoc.data() : null,
            youtube: youtubeDoc.exists ? youtubeDoc.data() : null,
            naver: naverDoc.exists ? naverDoc.data() : null,
            xTrends: xDoc.exists ? xDoc.data() : null,
            internalTrends: trendsDoc.exists ? (trendsDoc.data().topTrends || []) : [],
        };
    } catch (err) {
        console.warn('[BuzzCollector] buzzContext 로드 실패:', err.message);
        return { google: null, youtube: null, naver: null, xTrends: null, internalTrends: [] };
    }
}
