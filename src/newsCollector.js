import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { db } from './firebase.js';

const NEWS_COLLECTION = 'bot_settings';
const NEWS_DOC = 'news_digest';

// ─── RSS 소스 설정 ───────────────────────────────────────
const RSS_SOURCES = [
    // K-POP 뉴스
    { name: 'Soompi', url: 'https://www.soompi.com/feed', category: 'kpop' },
    { name: 'AllKPop', url: 'https://www.allkpop.com/feed', category: 'kpop' },
    { name: 'Koreaboo', url: 'https://www.koreaboo.com/feed', category: 'kpop' },
    // 패션 뉴스
    { name: 'FashionNetwork', url: 'https://ww.fashionnetwork.com/rss', category: 'fashion' },
];

// Google Alerts RSS (기본 키워드)
// 사용법: Google Alerts에서 RSS 생성 후 URL을 여기에 추가
const GOOGLE_ALERTS_RSS = [
    // { name: 'GA: K-POP Fashion', url: 'https://www.google.com/alerts/feeds/...', category: 'kpop' },
    // { name: 'GA: 아이돌 패션', url: 'https://www.google.com/alerts/feeds/...', category: 'kpop' },
    // { name: 'GA: KPOP Comeback', url: 'https://www.google.com/alerts/feeds/...', category: 'kpop' },
];

// ─── Reddit 소스 설정 ────────────────────────────────────
const REDDIT_SUBREDDITS = [
    { subreddit: 'kpop', category: 'kpop' },
    { subreddit: 'kpopfashion', category: 'fashion' },
];

// ─── Naver 뉴스 검색 키워드 ──────────────────────────────
const NAVER_QUERIES = [
    { query: 'K-POP 패션', category: 'kpop' },
    { query: '아이돌 공항패션', category: 'kpop' },
    { query: 'K-POP 컴백', category: 'kpop' },
];

// ─── 크롤링 대상 (Phase 4) ──────────────────────────────
const CRAWL_TARGETS = [
    {
        name: 'Kpop Comeback Schedule',
        url: 'https://www.reddit.com/r/kpop/wiki/upcoming-releases/2026/',
        category: 'kpop',
        selectors: { items: 'table tr', title: 'td:first-child' },
    },
];

// ─── 관련성 키워드 (점수 필터) ───────────────────────────
const RELEVANCE_KEYWORDS = [
    'fashion', 'style', 'outfit', 'look', 'runway', 'brand', 'collaboration',
    'comeback', 'airport', 'red carpet', 'magazine', 'photoshoot', 'vogue',
    'runway', 'luxury', 'chanel', 'dior', 'gucci', 'prada', 'louis vuitton',
    '패션', '스타일', '공항', '화보', '컴백', '무대의상', '브랜드', '럭셔리',
    '런웨이', '컬렉션', '앰버서더', '뮤직비디오', '앨범', '컨셉',
];

const parser = new Parser({
    timeout: 10000,
    headers: { 'User-Agent': 'mystyleKPOP-bot/1.0' },
});

/**
 * 기사 관련성 점수 계산
 */
function calcRelevanceScore(title, description) {
    const text = `${title || ''} ${description || ''}`.toLowerCase();
    let score = 0;
    const matched = [];

    for (const kw of RELEVANCE_KEYWORDS) {
        if (text.includes(kw.toLowerCase())) {
            score += 1;
            matched.push(kw);
        }
    }

    return { score, keywords: matched };
}

/**
 * 기사가 최근 24시간 내인지 확인
 */
function isRecent(dateStr, hoursBack = 24) {
    if (!dateStr) return true; // 날짜 없으면 일단 포함
    const articleDate = new Date(dateStr);
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    return articleDate >= cutoff;
}

// ─── Phase 1: RSS 피드 수집 ──────────────────────────────

async function fetchRSSFeeds() {
    const allSources = [...RSS_SOURCES, ...GOOGLE_ALERTS_RSS];
    const articles = [];

    for (const source of allSources) {
        try {
            const feed = await parser.parseURL(source.url);
            const items = (feed.items || [])
                .filter(item => isRecent(item.pubDate || item.isoDate))
                .slice(0, 10); // 소스당 최대 10개

            for (const item of items) {
                const { score, keywords } = calcRelevanceScore(item.title, item.contentSnippet);
                articles.push({
                    title: (item.title || '').slice(0, 200),
                    source: source.name,
                    category: source.category,
                    link: item.link || '',
                    publishedAt: item.pubDate || item.isoDate || null,
                    relevanceScore: score,
                    keywords,
                });
            }
            console.log(`[NewsCollector] RSS ${source.name}: ${items.length}건 수집`);
        } catch (err) {
            console.warn(`[NewsCollector] RSS ${source.name} 실패:`, err.message);
        }
    }

    return articles;
}

// ─── Phase 2: Reddit 수집 ────────────────────────────────

async function fetchRedditPosts() {
    const articles = [];

    for (const { subreddit, category } of REDDIT_SUBREDDITS) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=15`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'mystyleKPOP-bot/1.0 (news collection)' },
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                console.warn(`[NewsCollector] Reddit r/${subreddit}: HTTP ${res.status}`);
                continue;
            }

            const data = await res.json();
            const posts = (data?.data?.children || [])
                .map(c => c.data)
                .filter(p => !p.stickied && p.score > 50);

            for (const post of posts) {
                const { score, keywords } = calcRelevanceScore(post.title, post.selftext);
                articles.push({
                    title: (post.title || '').slice(0, 200),
                    source: `Reddit r/${subreddit}`,
                    category,
                    link: `https://reddit.com${post.permalink}`,
                    publishedAt: new Date(post.created_utc * 1000).toISOString(),
                    relevanceScore: score + Math.min(Math.floor(post.score / 100), 5), // Reddit score 보너스
                    keywords,
                });
            }
            console.log(`[NewsCollector] Reddit r/${subreddit}: ${posts.length}건 수집`);
        } catch (err) {
            console.warn(`[NewsCollector] Reddit r/${subreddit} 실패:`, err.message);
        }
    }

    return articles;
}

// ─── Phase 3: Naver 뉴스 API ─────────────────────────────

async function fetchNaverNews() {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.log('[NewsCollector] Naver API 키 미설정 → 스킵');
        return [];
    }

    const articles = [];

    for (const { query, category } of NAVER_QUERIES) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
            const res = await fetch(url, {
                headers: {
                    'X-Naver-Client-Id': clientId,
                    'X-Naver-Client-Secret': clientSecret,
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                console.warn(`[NewsCollector] Naver "${query}": HTTP ${res.status}`);
                continue;
            }

            const data = await res.json();
            const items = (data.items || []).filter(item => isRecent(item.pubDate));

            for (const item of items) {
                // Naver 응답에는 HTML 태그가 포함될 수 있어서 제거
                const cleanTitle = (item.title || '').replace(/<[^>]*>/g, '');
                const cleanDesc = (item.description || '').replace(/<[^>]*>/g, '');

                const { score, keywords } = calcRelevanceScore(cleanTitle, cleanDesc);
                articles.push({
                    title: cleanTitle.slice(0, 200),
                    source: 'Naver News',
                    category,
                    link: item.originallink || item.link || '',
                    publishedAt: item.pubDate || null,
                    relevanceScore: score,
                    keywords,
                });
            }
            console.log(`[NewsCollector] Naver "${query}": ${items.length}건 수집`);
        } catch (err) {
            console.warn(`[NewsCollector] Naver "${query}" 실패:`, err.message);
        }
    }

    return articles;
}

// ─── Phase 4: 웹 크롤링 (cheerio) ───────────────────────

async function fetchCrawledPages() {
    const articles = [];

    for (const target of CRAWL_TARGETS) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            const res = await fetch(target.url, {
                headers: {
                    'User-Agent': 'mystyleKPOP-bot/1.0 (news collection)',
                    'Accept': 'text/html',
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                console.warn(`[NewsCollector] Crawl ${target.name}: HTTP ${res.status}`);
                continue;
            }

            const html = await res.text();
            const $ = cheerio.load(html);

            // 테이블 기반 스케줄 파싱 (Reddit wiki 등)
            const rows = $(target.selectors.items).toArray().slice(0, 20);
            for (const row of rows) {
                const title = $(row).find(target.selectors.title).text().trim();
                if (title && title.length > 2) {
                    const { score, keywords } = calcRelevanceScore(title, '');
                    articles.push({
                        title: title.slice(0, 200),
                        source: target.name,
                        category: target.category,
                        link: target.url,
                        publishedAt: null,
                        relevanceScore: score,
                        keywords,
                    });
                }
            }
            console.log(`[NewsCollector] Crawl ${target.name}: ${Math.min(rows.length, 20)}건 파싱`);

            // 도메인당 10초 대기 (예의 준수)
            await new Promise(r => setTimeout(r, 10000));
        } catch (err) {
            console.warn(`[NewsCollector] Crawl ${target.name} 실패:`, err.message);
        }
    }

    return articles;
}

// ─── 메인 수집 함수 ──────────────────────────────────────

/**
 * 모든 뉴스 소스에서 데이터를 수집하고 Firestore에 저장합니다.
 * 개별 소스 실패는 다른 소스에 영향을 주지 않습니다.
 */
export async function collectNews() {
    if (!db) {
        console.warn("[NewsCollector] Firebase DB not initialized. Skipping news collection.");
        return;
    }

    try {
        console.log('[NewsCollector] 뉴스 수집 시작...');

        // 모든 소스를 병렬로 수집
        const [rssArticles, redditArticles, naverArticles, crawledArticles] = await Promise.all([
            fetchRSSFeeds().catch(err => { console.error('[NewsCollector] RSS 전체 실패:', err.message); return []; }),
            fetchRedditPosts().catch(err => { console.error('[NewsCollector] Reddit 전체 실패:', err.message); return []; }),
            fetchNaverNews().catch(err => { console.error('[NewsCollector] Naver 전체 실패:', err.message); return []; }),
            fetchCrawledPages().catch(err => { console.error('[NewsCollector] Crawl 전체 실패:', err.message); return []; }),
        ]);

        const allArticles = [...rssArticles, ...redditArticles, ...naverArticles, ...crawledArticles];

        // 관련성 점수 기준 정렬 → 상위 15개만 저장
        allArticles.sort((a, b) => b.relevanceScore - a.relevanceScore);
        const topArticles = allArticles.slice(0, 15);

        // 전체에서 가장 많이 등장한 키워드 추출
        const keywordCounts = {};
        for (const article of allArticles) {
            for (const kw of article.keywords) {
                keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
            }
        }
        const topKeywords = Object.entries(keywordCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([kw]) => kw);

        // Firestore 저장
        await db.collection(NEWS_COLLECTION).doc(NEWS_DOC).set({
            lastCollected: new Date(),
            articles: topArticles,
            topKeywords,
            sourceStats: {
                rss: rssArticles.length,
                reddit: redditArticles.length,
                naver: naverArticles.length,
                crawl: crawledArticles.length,
                total: allArticles.length,
            },
        });

        console.log(`[NewsCollector] 뉴스 수집 완료. 총 ${allArticles.length}건 중 상위 ${topArticles.length}건 저장. 핫 키워드: ${topKeywords.slice(0, 5).join(', ')}`);

    } catch (err) {
        console.error("[NewsCollector] 뉴스 수집 중 오류:", err.message);
    }
}

// ─── 프롬프트 빌더 ──────────────────────────────────────

/**
 * 봇 생성기에서 최신 뉴스를 읽어와 프롬프트화 시켜주는 유틸리티
 */
export async function getNewsPrompt() {
    if (!db) return "";

    try {
        const doc = await db.collection(NEWS_COLLECTION).doc(NEWS_DOC).get();
        if (!doc.exists) return "";

        const data = doc.data();
        const articles = data.articles || [];
        const topKeywords = data.topKeywords || [];

        if (articles.length === 0) return "";

        // 상위 3개 기사 제목 + 소스
        const topArticles = articles.slice(0, 3);
        const headlines = topArticles.map(a => `"${a.title}" (${a.source})`).join('; ');
        const kwStr = topKeywords.slice(0, 5).join(', ');

        return `[최신 K-POP/패션 뉴스 동향: ${headlines}. 핵심 키워드: ${kwStr} - 이 최신 뉴스 트렌드를 AI 룩북 화보 컨셉에 자연스럽게 반영해줘.]`;
    } catch (err) {
        console.error("[NewsCollector] 프롬프트 로딩 실패:", err.message);
        return "";
    }
}

// ─── 다이제스트 메시지 (텔레그램용) ──────────────────────

/**
 * 텔레그램 관리자용 뉴스 다이제스트 메시지를 생성합니다.
 */
export async function getNewsDigestMessage() {
    if (!db) return "Firebase 미연결 상태입니다.";

    try {
        const doc = await db.collection(NEWS_COLLECTION).doc(NEWS_DOC).get();
        if (!doc.exists) return "아직 수집된 뉴스가 없습니다. 스케줄러가 06:00 KST에 자동 수집합니다.";

        const data = doc.data();
        const articles = data.articles || [];
        const stats = data.sourceStats || {};
        const topKeywords = data.topKeywords || [];
        const lastCollected = data.lastCollected?.toDate?.() || data.lastCollected;

        if (articles.length === 0) return "수집된 뉴스 기사가 없습니다.";

        let msg = `📰 *뉴스 다이제스트*\n`;
        msg += `수집 시간: ${lastCollected ? new Date(lastCollected).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '알 수 없음'}\n`;
        msg += `소스별: RSS ${stats.rss || 0} | Reddit ${stats.reddit || 0} | Naver ${stats.naver || 0} | Crawl ${stats.crawl || 0}\n\n`;

        // 상위 기사 (최대 7개)
        const display = articles.slice(0, 7);
        for (let i = 0; i < display.length; i++) {
            const a = display[i];
            const scoreBar = '⭐'.repeat(Math.min(a.relevanceScore, 5));
            msg += `*${i + 1}.* ${a.title}\n`;
            msg += `   _${a.source}_ ${scoreBar}\n`;
            if (a.link) msg += `   [링크](${a.link})\n`;
            msg += '\n';
        }

        if (topKeywords.length > 0) {
            msg += `🔑 *트렌드 키워드:* ${topKeywords.slice(0, 7).join(', ')}\n`;
        }

        return msg;
    } catch (err) {
        console.error("[NewsCollector] 다이제스트 생성 실패:", err.message);
        return "뉴스 다이제스트를 불러오는 중 오류가 발생했습니다.";
    }
}
