import { TwitterApi } from "twitter-api-v2";
import { db } from "./firebase.js";

const EXTERNAL_TRENDS_DOC = 'external_trends';
const TRENDS_COLLECTION = 'bot_settings';

// X 검색 키워드 및 필터 (리트윗 제외, 미디어 포함 등)
// 트렌드와 K-POP 패션을 주로 탐색
const SEARCH_QUERIES = [
    "KPOP 패션 -is:retweet",
    "공항패션 -is:retweet",
    "무대의상 -is:retweet"
];

/**
 * 텍스트 속에서 많이 나오는 해시태그를 빈도순으로 뽑아줍니다.
 */
function extractPopularHashtags(texts) {
    const counts = {};
    for (const text of texts) {
        if (!text) continue;
        const hashtags = text.match(/#[a-zA-Z0-9_\uAC00-\uD7A3]+/g) || [];
        for (const tag of hashtags) {
            const normalized = tag.toLowerCase();
            counts[normalized] = (counts[normalized] || 0) + 1;
        }
    }

    // 빈도순 정렬
    const sorted = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .map(([tag]) => tag);

    // 상위 10개만 저장
    return sorted.slice(0, 10);
}

/**
 * X API를 사용해 최근 가장 대중적(조회수, 리트윗 높은)인 외부 K-POP 트렌드 및 해시태그를 수집합니다.
 */
export async function scrapeExternalTrends() {
    if (!db) {
        console.warn("[Scraper] Firebase DB not initialized. Skipping external scraping.");
        return;
    }

    try {
        console.log(`[Scraper] 외부 K-POP 패션 트렌드 수집 시작...`);

        const roClient = process.env.X_BEARER_TOKEN ?
            new TwitterApi(process.env.X_BEARER_TOKEN).readOnly :
            new TwitterApi({
                appKey: process.env.X_API_KEY,
                appSecret: process.env.X_API_SECRET_KEY,
                accessToken: process.env.X_ACCESS_TOKEN,
                accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
            }).readOnly;

        let allTexts = [];
        let highEngagementTweets = [];

        // 각 쿼리 당 최신 10개 (API Rate Limit 및 비용을 고려해 최소화)
        for (const query of SEARCH_QUERIES) {
            const searchResult = await roClient.v2.search(query, {
                'tweet.fields': ['public_metrics'],
                'max_results': 10
            });

            for (const tweet of searchResult.data.data || []) {
                allTexts.push(tweet.text);

                const metrics = tweet.public_metrics || {};
                const score = (metrics.like_count || 0) + (metrics.retweet_count || 0) * 2;

                // 반응이 꽤 있는 글들만 골라내기 위함
                if (score > 10) {
                    highEngagementTweets.push({
                        text: tweet.text,
                        score: score
                    });
                }
            }
        }

        const popularHashtags = extractPopularHashtags(allTexts);

        // 가장 점수가 높은 상위 트윗 (영감 도출용)
        highEngagementTweets.sort((a, b) => b.score - a.score);
        const topViralTweets = highEngagementTweets.slice(0, 3).map(t => t.text);

        // Firestore 저장 (텔레그램 초안 생성기에 인젝션할 때 사용)
        await db.collection(TRENDS_COLLECTION).doc(EXTERNAL_TRENDS_DOC).set({
            lastScraped: new Date(),
            popularHashtags,
            topViralTweets
        });

        console.log(`[Scraper] 외부 트렌드 수집 완료. 핫 해시태그:`, popularHashtags.join(', '));

    } catch (err) {
        console.error("[Scraper] 트렌드 수집 중 오류:", err.message);
    }
}

/**
 * 봇 생성기에서 외부 트렌드를 읽어와 프롬프트화 시켜주는 유틸리티
 */
export async function getExternalTrendPrompt() {
    if (!db) return "";

    try {
        const doc = await db.collection(TRENDS_COLLECTION).doc(EXTERNAL_TRENDS_DOC).get();
        if (!doc.exists) return "";

        const data = doc.data();
        const hashtags = data.popularHashtags || [];

        if (hashtags.length === 0) return "";

        // 상위 3~5개만 노출
        return `[외부 K-POP/패션 최신 유행 키워드: ${hashtags.slice(0, 4).join(' ')} - 이 런 최근의 유행 요소를 이번 AI 룩북 화보 컨셉에 어울리게 반영해줘.]`;
    } catch (err) {
        console.error("[Scraper] 프롬프트 로딩 실패:", err.message);
        return "";
    }
}
