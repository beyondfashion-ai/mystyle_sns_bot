import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { db } from './firebase.js';
import { getBuzzContext } from './buzzCollector.js';

const NEWS_COLLECTION = 'bot_settings';
const NEWS_DOC = 'news_digest';

// ─── 소스 신뢰도 등급 ────────────────────────────────────
// Tier 1: 전문 K-POP/패션 뉴스 매체 (+3점)
// Tier 2: 일반 뉴스/패션 매체 (+1점)
// Tier 3: 커뮤니티 (루머 가능성, +0점)
// Tier 4: 비정형 크롤링 데이터 (-1점)
const SOURCE_TIER_BONUS = { 1: 3, 2: 1, 3: 0, 4: -1 };

function tierToCredibility(tier) {
    if (tier <= 1) return 'high';
    if (tier <= 2) return 'medium';
    return 'low';
}

// ─── RSS 소스 설정 ───────────────────────────────────────
const RSS_SOURCES = [
    // K-POP 뉴스 (Tier 1)
    { name: 'Soompi', url: 'https://www.soompi.com/feed', category: 'kpop', tier: 1 },
    { name: 'AllKPop', url: 'https://www.allkpop.com/feed', category: 'kpop', tier: 1 },
    { name: 'Koreaboo', url: 'https://www.koreaboo.com/feed', category: 'kpop', tier: 1 },
    // 패션 뉴스 (Tier 2)
    { name: 'FashionNetwork', url: 'https://ww.fashionnetwork.com/rss', category: 'fashion', tier: 2 },
];

// Google Alerts RSS (기본 키워드, Tier 2)
const GOOGLE_ALERTS_RSS = [
    // { name: 'GA: K-POP Fashion', url: 'https://www.google.com/alerts/feeds/...', category: 'kpop', tier: 2 },
    // { name: 'GA: 아이돌 패션', url: 'https://www.google.com/alerts/feeds/...', category: 'kpop', tier: 2 },
    // { name: 'GA: KPOP Comeback', url: 'https://www.google.com/alerts/feeds/...', category: 'kpop', tier: 2 },
];

// ─── Reddit 소스 설정 (Tier 3: 커뮤니티) ─────────────────
const REDDIT_SUBREDDITS = [
    { subreddit: 'kpop', category: 'kpop', tier: 3 },
    { subreddit: 'kpopfashion', category: 'fashion', tier: 3 },
];

// ─── Naver 뉴스 검색 키워드 ──────────────────────────────
const NAVER_QUERIES = [
    { query: 'K-POP 패션', category: 'kpop' },
    { query: '아이돌 공항패션', category: 'kpop' },
    { query: 'K-POP 컴백', category: 'kpop' },
];

// ─── 크롤링 대상 (Phase 4, Tier 4: 비정형) ──────────────
const CRAWL_TARGETS = [
    {
        name: 'Kpop Comeback Schedule',
        url: 'https://www.reddit.com/r/kpop/wiki/upcoming-releases/2026/',
        category: 'kpop',
        tier: 4,
        selectors: { items: 'table tr', title: 'td:first-child' },
    },
];

// ─── 클릭베이트/논란 키워드 (감점 필터) ─────────────────
// 삭제하지 않고 감점만 (-2점) → 재미있는 뉴스일 수 있으므로
const CLICKBAIT_KEYWORDS = [
    // 한국어
    '충격', '경악', '논란', '폭로', '열애', '결별', '사과', '고소', '소송', '탈퇴',
    '대박', '실화', '헐', '미쳤', 'ㄷㄷ',
    // English
    'controversy', 'scandal', 'shocking', 'dating', 'breakup', 'apology',
    'lawsuit', 'leaving', 'kicked out', 'exposed', 'cancelled',
];

// ─── 날짜 신선도 판정 ───────────────────────────────────
function getFreshnessLabel(publishedAt) {
    if (!publishedAt) return 'unknown';
    const ageMs = Date.now() - new Date(publishedAt).getTime();
    const hours = ageMs / (1000 * 60 * 60);
    if (hours <= 6) return 'fresh';       // 6시간 이내
    if (hours <= 24) return 'today';      // 24시간 이내
    return 'stale';                        // 24시간+
}

function freshnessToKorean(freshness) {
    const map = { fresh: '최신', today: '오늘', stale: '이전', unknown: '시간미상' };
    return map[freshness] || '시간미상';
}

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

// ─── 중복 제거 ──────────────────────────────────────────

/**
 * 제목을 정규화하여 중복 비교용 키를 생성
 */
function normalizeTitle(title) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9가-힣\s]/g, '') // 특수문자 제거
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 중복 기사 제거: 같은 제목 → 가장 높은 tier 소스의 것만 유지
 */
function deduplicateArticles(articles) {
    const seen = new Map(); // normalizedTitle → article

    for (const article of articles) {
        const key = normalizeTitle(article.title);
        if (!key || key.length < 5) continue; // 너무 짧은 제목 무시

        const existing = seen.get(key);
        if (!existing || article.tier < existing.tier) {
            seen.set(key, article);
        }
    }

    return [...seen.values()];
}

// ─── 교차 검증 (Cross-Source Validation) ────────────────

/**
 * 제목에서 핵심 단어(3글자 이상)를 추출
 */
function extractKeyWords(title) {
    const stopWords = new Set(['the', 'and', 'for', 'with', 'has', 'was', 'are', 'from', 'that', 'this', 'will', 'about']);
    return normalizeTitle(title)
        .split(' ')
        .filter(w => w.length >= 3 && !stopWords.has(w));
}

/**
 * 두 기사의 유사도 판정: 공통 핵심 단어 3개 이상이면 같은 뉴스
 */
function areSimilar(wordsA, wordsB) {
    let common = 0;
    const setB = new Set(wordsB);
    for (const w of wordsA) {
        if (setB.has(w)) common++;
        if (common >= 3) return true;
    }
    return false;
}

/**
 * 교차 검증: 2개+ 소스에서 비슷한 뉴스 → crossVerified + 보너스
 */
function crossValidate(articles) {
    const wordCache = articles.map(a => ({
        article: a,
        words: extractKeyWords(a.title),
    }));

    for (let i = 0; i < wordCache.length; i++) {
        for (let j = i + 1; j < wordCache.length; j++) {
            const a = wordCache[i];
            const b = wordCache[j];

            // 같은 소스는 교차 검증 대상이 아님
            if (a.article.source === b.article.source) continue;

            if (areSimilar(a.words, b.words)) {
                a.article.crossVerified = true;
                b.article.crossVerified = true;
                a.article.crossSourceCount = (a.article.crossSourceCount || 1) + 1;
                b.article.crossSourceCount = (b.article.crossSourceCount || 1) + 1;
                a.article.relevanceScore += 3;
                b.article.relevanceScore += 3;
            }
        }
    }

    return articles;
}

// ─── buzzScore 계산 함수들 (5개 컴포넌트, 각 0~20) ──────

/**
 * Reddit 기사 화제성: num_comments, upvote_ratio, score velocity
 * @returns {number} 0~20
 */
function calcRedditBuzz(redditData) {
    if (!redditData) return 0;
    const { score, numComments, upvoteRatio, ageHours } = redditData;

    // velocity: 시간당 점수 (빨리 뜨는 포스트일수록 높음)
    const velocity = Math.min((score / Math.max(ageHours, 1)) * 0.4, 8);
    // 댓글 활발도
    const commentBuzz = Math.min((numComments || 0) / 15, 6);
    // 공감도 (upvote_ratio 높으면 = 논란 적음, 공감 높음)
    const ratio = upvoteRatio || 0.5;
    const consensus = ratio >= 0.9 ? 4 : ratio >= 0.75 ? 3 : ratio < 0.6 ? 2 : 1;
    // 절대 규모
    const magnitude = Math.min(score / 500, 2);

    return Math.min(Math.round(velocity + commentBuzz + consensus + magnitude), 20);
}

/**
 * X 트렌드 매칭 화제성: 기사 제목이 X 핫 해시태그/바이럴 트윗과 겹치는지
 * @returns {number} 0~20
 */
function calcTrendMatchBuzz(title, description, buzzContext) {
    const xTrends = buzzContext?.xTrends;
    if (!xTrends) return 0;

    const text = `${title || ''} ${description || ''}`.toLowerCase();
    let buzz = 0;

    // X 인기 해시태그 매칭 (태그당 5점, 최대 15)
    const hashtags = xTrends.popularHashtags || [];
    for (const tag of hashtags.slice(0, 10)) {
        const clean = (tag || '').replace(/^#/, '').toLowerCase();
        if (clean.length >= 2 && text.includes(clean)) {
            buzz += 5;
            if (buzz >= 15) break;
        }
    }

    // X 바이럴 트윗 키워드 중복 (0~5)
    const viralTweets = xTrends.topViralTweets || [];
    for (const tweet of viralTweets) {
        const tweetWords = normalizeTitle(tweet).split(' ').filter(w => w.length >= 3);
        const titleWords = normalizeTitle(title).split(' ').filter(w => w.length >= 3);
        let overlap = 0;
        const tweetSet = new Set(tweetWords);
        for (const w of titleWords) {
            if (tweetSet.has(w)) overlap++;
        }
        if (overlap >= 2) { buzz += 5; break; }
    }

    return Math.min(buzz, 20);
}

/**
 * 외부 트렌드 매칭 화제성: Google Trends + YouTube + Naver DataLab
 * @returns {number} 0~20
 */
function calcExternalBuzz(title, description, buzzContext) {
    const text = `${title || ''} ${description || ''}`.toLowerCase();
    let buzz = 0;

    // Google Trends 인기검색어 매칭 (0~8)
    const google = buzzContext?.google;
    if (google) {
        const keywords = [...(google.kpopRelated || []), ...(google.trendingKeywords || []).slice(0, 10)];
        for (const kw of keywords) {
            if (kw && kw.length >= 2 && text.includes(kw.toLowerCase())) {
                buzz += 4;
                if (buzz >= 8) break;
            }
        }
        buzz = Math.min(buzz, 8);
    }

    // YouTube 트렌딩 아티스트/키워드 매칭 (0~6)
    const youtube = buzzContext?.youtube;
    if (youtube) {
        const artists = youtube.trendingArtists || [];
        const videoTitles = (youtube.hotVideos || []).map(v => v.title || '');
        for (const artist of artists) {
            if (artist && artist.length >= 2 && text.includes(artist.toLowerCase())) {
                buzz += 3;
                break;
            }
        }
        for (const vTitle of videoTitles.slice(0, 5)) {
            const vWords = normalizeTitle(vTitle).split(' ').filter(w => w.length >= 3);
            const tWords = normalizeTitle(title).split(' ').filter(w => w.length >= 3);
            let overlap = 0;
            const vSet = new Set(vWords);
            for (const w of tWords) {
                if (vSet.has(w)) overlap++;
            }
            if (overlap >= 2) { buzz += 3; break; }
        }
        buzz = Math.min(buzz, 8 + 6); // Google(8) + YouTube(6) cap
    }

    // Naver DataLab 상승 키워드 매칭 (0~6)
    const naver = buzzContext?.naver;
    if (naver) {
        const risingKeywords = (naver.keywordTrends || []).filter(t => t.trend === 'rising');
        for (const trend of risingKeywords) {
            const kw = (trend.keyword || '').toLowerCase();
            // 키워드 그룹의 단어들과 매칭
            const words = kw.split(/\s+/);
            for (const w of words) {
                if (w.length >= 2 && text.includes(w)) {
                    buzz += 3;
                    break;
                }
            }
            if (buzz >= 20) break;
        }
    }

    return Math.min(buzz, 20);
}

/**
 * 교차 소스 화제성: 여러 매체에서 동시 보도
 * @returns {number} 0~20
 */
function calcCrossSourceBuzz(article) {
    if (!article.crossVerified) return 0;
    const count = article.crossSourceCount || 1;
    if (count >= 3) return 20;
    if (count >= 2) return 12;
    return 8;
}

/**
 * 시간 가속도 화제성: 최신일수록 + 고관련성일수록 높음
 * @returns {number} 0~20
 */
function calcFreshnessBuzz(publishedAt, relevanceScore) {
    if (!publishedAt) return 0;
    const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
    if (ageHours < 0) return 0;

    let buzz = 0;
    if (ageHours <= 2) buzz = 12;        // 속보급
    else if (ageHours <= 6) buzz = 8;    // 매우 최신
    else if (ageHours <= 12) buzz = 5;   // 당일 오전
    else if (ageHours <= 24) buzz = 3;   // 오늘

    // 보너스: 최신 + 고관련성 = 핫토픽
    if (ageHours <= 6 && relevanceScore >= 5) buzz += 8;
    else if (ageHours <= 12 && relevanceScore >= 3) buzz += 4;

    return Math.min(buzz, 20);
}

/**
 * 기사의 종합 화제성(buzzScore)를 계산 (0~100)
 */
function calculateBuzzScore(article, buzzContext) {
    const reddit = calcRedditBuzz(article._redditData || null);
    const xTrend = calcTrendMatchBuzz(article.title, '', buzzContext);
    const external = calcExternalBuzz(article.title, '', buzzContext);
    const crossSource = calcCrossSourceBuzz(article);
    const freshness = calcFreshnessBuzz(article.publishedAt, article.relevanceScore);

    return Math.min(reddit + xTrend + external + crossSource + freshness, 100);
}

/**
 * 기사 관련성 점수 계산 + 클릭베이트 감지
 * @returns {{ score: number, keywords: string[], flagged: string|null }}
 */
function calcRelevanceScore(title, description) {
    const text = `${title || ''} ${description || ''}`.toLowerCase();
    let score = 0;
    const matched = [];
    let flagged = null;

    // 관련성 키워드 매칭 (+1점씩)
    for (const kw of RELEVANCE_KEYWORDS) {
        if (text.includes(kw.toLowerCase())) {
            score += 1;
            matched.push(kw);
        }
    }

    // 클릭베이트/논란 키워드 감지 (-2점)
    for (const kw of CLICKBAIT_KEYWORDS) {
        if (text.includes(kw.toLowerCase())) {
            score -= 2;
            flagged = 'clickbait';
            break; // 한 번만 감점
        }
    }

    return { score, keywords: matched, flagged };
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
                const { score, keywords, flagged } = calcRelevanceScore(item.title, item.contentSnippet);
                const publishedAt = item.pubDate || item.isoDate || null;
                const freshness = getFreshnessLabel(publishedAt);
                const tierBonus = SOURCE_TIER_BONUS[source.tier] || 0;
                const freshnessDeduct = freshness === 'stale' ? -1 : 0;

                articles.push({
                    title: (item.title || '').slice(0, 200),
                    source: source.name,
                    category: source.category,
                    link: item.link || '',
                    publishedAt,
                    relevanceScore: score + tierBonus + freshnessDeduct,
                    keywords,
                    tier: source.tier,
                    credibility: tierToCredibility(source.tier),
                    freshness,
                    flagged,
                    crossVerified: false,
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

    for (const { subreddit, category, tier } of REDDIT_SUBREDDITS) {
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
                const { score, keywords, flagged } = calcRelevanceScore(post.title, post.selftext);
                const publishedAt = new Date(post.created_utc * 1000).toISOString();
                const freshness = getFreshnessLabel(publishedAt);
                const tierBonus = SOURCE_TIER_BONUS[tier] || 0;
                const freshnessDeduct = freshness === 'stale' ? -1 : 0;
                const redditBonus = Math.min(Math.floor(post.score / 100), 5);

                const ageHours = Math.max((Date.now() - new Date(publishedAt).getTime()) / 3600000, 0.1);

                articles.push({
                    title: (post.title || '').slice(0, 200),
                    source: `Reddit r/${subreddit}`,
                    category,
                    link: `https://reddit.com${post.permalink}`,
                    publishedAt,
                    relevanceScore: score + tierBonus + freshnessDeduct + redditBonus,
                    keywords,
                    tier,
                    credibility: tierToCredibility(tier),
                    freshness,
                    flagged,
                    crossVerified: false,
                    // buzzScore 계산용 Reddit 메타데이터 (저장 후 삭제)
                    _redditData: {
                        score: post.score,
                        numComments: post.num_comments || 0,
                        upvoteRatio: post.upvote_ratio || 0.5,
                        ageHours,
                    },
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

            const naverTier = 1; // Naver News = Tier 1 (전문 뉴스)
            for (const item of items) {
                // Naver 응답에는 HTML 태그가 포함될 수 있어서 제거
                const cleanTitle = (item.title || '').replace(/<[^>]*>/g, '');
                const cleanDesc = (item.description || '').replace(/<[^>]*>/g, '');

                const { score, keywords, flagged } = calcRelevanceScore(cleanTitle, cleanDesc);
                const publishedAt = item.pubDate || null;
                const freshness = getFreshnessLabel(publishedAt);
                const tierBonus = SOURCE_TIER_BONUS[naverTier] || 0;
                const freshnessDeduct = freshness === 'stale' ? -1 : 0;

                articles.push({
                    title: cleanTitle.slice(0, 200),
                    source: 'Naver News',
                    category,
                    link: item.originallink || item.link || '',
                    publishedAt,
                    relevanceScore: score + tierBonus + freshnessDeduct,
                    keywords,
                    tier: naverTier,
                    credibility: tierToCredibility(naverTier),
                    freshness,
                    flagged,
                    crossVerified: false,
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
            const crawlTier = target.tier || 4;
            for (const row of rows) {
                const title = $(row).find(target.selectors.title).text().trim();
                if (title && title.length > 2) {
                    const { score, keywords, flagged } = calcRelevanceScore(title, '');
                    const tierBonus = SOURCE_TIER_BONUS[crawlTier] || 0;

                    articles.push({
                        title: title.slice(0, 200),
                        source: target.name,
                        category: target.category,
                        link: target.url,
                        publishedAt: null,
                        relevanceScore: score + tierBonus,
                        keywords,
                        tier: crawlTier,
                        credibility: tierToCredibility(crawlTier),
                        freshness: 'unknown',
                        flagged,
                        crossVerified: false,
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

        let allArticles = [...rssArticles, ...redditArticles, ...naverArticles, ...crawledArticles];

        // 검증 파이프라인: 중복 제거 → 교차 검증 → 정렬
        const beforeDedup = allArticles.length;
        allArticles = deduplicateArticles(allArticles);
        const afterDedup = allArticles.length;
        if (beforeDedup !== afterDedup) {
            console.log(`[NewsCollector] 중복 제거: ${beforeDedup} → ${afterDedup}건 (${beforeDedup - afterDedup}건 제거)`);
        }

        allArticles = crossValidate(allArticles);
        const crossVerifiedCount = allArticles.filter(a => a.crossVerified).length;
        if (crossVerifiedCount > 0) {
            console.log(`[NewsCollector] 교차 검증: ${crossVerifiedCount}건 확인됨`);
        }

        const flaggedCount = allArticles.filter(a => a.flagged).length;
        if (flaggedCount > 0) {
            console.log(`[NewsCollector] 클릭베이트 감지: ${flaggedCount}건 감점`);
        }

        // buzzScore 계산: 외부 트렌드 데이터 로드 → 각 기사에 화제성 점수 부여
        const buzzContext = await getBuzzContext().catch(err => {
            console.warn('[NewsCollector] buzzContext 로드 실패, buzzScore 없이 진행:', err.message);
            return { google: null, youtube: null, naver: null, xTrends: null, internalTrends: [] };
        });

        for (const article of allArticles) {
            article.buzzScore = calculateBuzzScore(article, buzzContext);

            // buzzScore를 relevanceScore에 반영 (100점 = +15점 보너스)
            const buzzBonus = Math.round(article.buzzScore * 0.15);
            article.relevanceScore += buzzBonus;

            // Reddit 임시 데이터 삭제 (Firestore에 저장하지 않음)
            delete article._redditData;
        }

        const hotCount = allArticles.filter(a => a.buzzScore >= 50).length;
        const warmCount = allArticles.filter(a => a.buzzScore >= 20 && a.buzzScore < 50).length;
        if (hotCount > 0 || warmCount > 0) {
            console.log(`[NewsCollector] 화제성 분석: 🔥높음 ${hotCount}건 | 💬보통 ${warmCount}건`);
        }

        // 관련성+화제성 종합 점수 기준 정렬 → 상위 15개만 저장
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
            verificationStats: {
                duplicatesRemoved: beforeDedup - afterDedup,
                crossVerified: crossVerifiedCount,
                clickbaitFlagged: flaggedCount,
            },
            buzzStats: {
                highBuzz: hotCount,
                mediumBuzz: warmCount,
                avgBuzzScore: allArticles.length > 0
                    ? Math.round(allArticles.reduce((s, a) => s + (a.buzzScore || 0), 0) / allArticles.length)
                    : 0,
                sourcesAvailable: {
                    google: !!buzzContext.google,
                    youtube: !!buzzContext.youtube,
                    naver: !!buzzContext.naver,
                    xTrends: !!buzzContext.xTrends,
                },
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

        // 상위 3개 기사 제목 + 소스 + 검증 메타데이터
        const topArticles = articles.slice(0, 3);
        const headlines = topArticles.map(a => {
            const parts = [a.source];

            // 신뢰도 표시
            if (a.credibility === 'high') parts.push('신뢰도:높음');
            else if (a.credibility === 'low') parts.push('커뮤니티');

            // 교차 검증 표시
            if (a.crossVerified) parts.push('교차검증됨');

            // 신선도 표시
            parts.push(freshnessToKorean(a.freshness));

            // 클릭베이트 경고
            if (a.flagged === 'clickbait') parts.push('미검증');

            // 화제성 표시
            if (a.buzzScore >= 50) parts.push('🔥화제');
            else if (a.buzzScore >= 20) parts.push('화제성:보통');

            return `"${a.title}" (${parts.join(', ')})`;
        }).join('; ');

        const kwStr = topKeywords.slice(0, 5).join(', ');

        // 고화제성 기사에 대한 추가 강조
        const hotArticle = topArticles.find(a => (a.buzzScore || 0) >= 50);
        const buzzNote = hotArticle
            ? ` 특히 "${hotArticle.title}"은 현재 SNS에서 화제가 되고 있으니 적극 반영 고려.`
            : '';

        return `[최신 K-POP/패션 뉴스 동향: ${headlines}. 핵심 키워드: ${kwStr} - 신뢰도가 높은 뉴스는 적극 반영하고, 🔥 표시된 화제성 높은 뉴스를 우선, 미검증/커뮤니티 뉴스는 참고만 하여 AI 룩북 화보 컨셉에 자연스럽게 반영해줘.${buzzNote}]`;
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
        const vStats = data.verificationStats || {};
        const bStats = data.buzzStats || {};
        const topKeywords = data.topKeywords || [];
        const lastCollected = data.lastCollected?.toDate?.() || data.lastCollected;

        if (articles.length === 0) return "수집된 뉴스 기사가 없습니다.";

        let msg = `📰 *뉴스 다이제스트*\n`;
        msg += `수집 시간: ${lastCollected ? new Date(lastCollected).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '알 수 없음'}\n`;
        msg += `소스별: RSS ${stats.rss || 0} | Reddit ${stats.reddit || 0} | Naver ${stats.naver || 0} | Crawl ${stats.crawl || 0}\n`;

        // 검증 통계 표시
        const vParts = [];
        if (vStats.duplicatesRemoved > 0) vParts.push(`중복제거 ${vStats.duplicatesRemoved}`);
        if (vStats.crossVerified > 0) vParts.push(`교차검증 ${vStats.crossVerified}`);
        if (vStats.clickbaitFlagged > 0) vParts.push(`클릭베이트 ${vStats.clickbaitFlagged}`);
        if (vParts.length > 0) {
            msg += `🔍 검증: ${vParts.join(' | ')}\n`;
        }

        // 화제성 통계 표시
        if (bStats.highBuzz > 0 || bStats.mediumBuzz > 0) {
            const buzzParts = [];
            if (bStats.highBuzz > 0) buzzParts.push(`🔥높음 ${bStats.highBuzz}`);
            if (bStats.mediumBuzz > 0) buzzParts.push(`💬보통 ${bStats.mediumBuzz}`);
            if (bStats.avgBuzzScore > 0) buzzParts.push(`평균 ${bStats.avgBuzzScore}`);
            msg += `🔥 화제성: ${buzzParts.join(' | ')}`;

            // 트렌드 소스 상태
            const src = bStats.sourcesAvailable || {};
            const srcParts = [];
            if (src.google) srcParts.push('Google✅');
            if (src.youtube) srcParts.push('YouTube✅');
            if (src.naver) srcParts.push('Naver✅');
            if (src.xTrends) srcParts.push('X✅');
            if (srcParts.length > 0) msg += ` (${srcParts.join(' ')})`;
            msg += '\n';
        }
        msg += '\n';

        // 상위 기사 (최대 7개) + 검증 상태 + 화제성 아이콘
        const display = articles.slice(0, 7);
        for (let i = 0; i < display.length; i++) {
            const a = display[i];
            const scoreBar = '⭐'.repeat(Math.min(Math.max(a.relevanceScore, 0), 5));

            // 검증 상태 아이콘
            let verifyIcon = '🔶'; // 기본: 보통
            if (a.crossVerified) verifyIcon = '✅';       // 교차 검증됨
            else if (a.flagged === 'clickbait') verifyIcon = '⚠️'; // 클릭베이트
            else if (a.credibility === 'high') verifyIcon = '✅';   // 고신뢰 소스
            else if (a.credibility === 'low') verifyIcon = '❓';    // 저신뢰

            // 화제성 불꽃 바
            const buzz = a.buzzScore || 0;
            let buzzBar = '';
            if (buzz >= 70) buzzBar = '🔥🔥🔥';
            else if (buzz >= 50) buzzBar = '🔥🔥';
            else if (buzz >= 30) buzzBar = '🔥';

            // 신선도 표시
            const freshnessTag = a.freshness ? ` [${freshnessToKorean(a.freshness)}]` : '';

            msg += `*${i + 1}.* ${verifyIcon}${buzzBar} ${a.title}\n`;
            msg += `   _${a.source}_ ${scoreBar}${freshnessTag}`;
            if (buzz >= 20) msg += ` (화제성:${buzz})`;
            msg += '\n';
            if (a.link) msg += `   [링크](${a.link})\n`;
            msg += '\n';
        }

        if (topKeywords.length > 0) {
            msg += `🔑 *트렌드 키워드:* ${topKeywords.slice(0, 7).join(', ')}\n`;
        }

        // 아이콘 범례
        msg += `\n_✅ 검증됨 | 🔶 보통 | ⚠️ 클릭베이트 | ❓ 커뮤니티 | 🔥 화제_`;

        return msg;
    } catch (err) {
        console.error("[NewsCollector] 다이제스트 생성 실패:", err.message);
        return "뉴스 다이제스트를 불러오는 중 오류가 발생했습니다.";
    }
}
