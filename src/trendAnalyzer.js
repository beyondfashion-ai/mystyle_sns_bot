import { db } from "./firebase.js";

const PENDING_COLLECTION = 'pending_sns_posts';
const TRENDS_COLLECTION = 'bot_settings';
const TRENDS_DOC_ID = 'trends';

// 얼마나 오래된 게시물까지 분석 대상으로 삼을 것인가 (일)
const TREND_LOOKBACK_DAYS = 7;

/**
 * 해시태그나 아키타입 키워드를 추출하여 가중치를 누적하는 헬퍼 함수
 */
function extractAndScoreTags(text, baseScore, trendMap) {
    if (!text) return;

    // 간단한 해시태그 추출 정규식
    const hashtags = text.match(/#[a-zA-Z0-9_\uAC00-\uD7A3]+/g) || [];

    // Vibe-Alike 아키타입이 있는지 확인 (예: 아키타입 A, B, C)
    // 이 봇은 Vibe-Alike 가상 모델만 사용해야 하므로, 관련 키워드가 텍스트에 있으면 함께 가중치를 줌
    const archetypes = ["비주얼 센터", "메인 댄서", "메인 보컬", "막내", "걸크러시", "청순", "힙합", "Y2K"];
    const foundArchetypes = archetypes.filter(arch => text.includes(arch));

    const allTags = [...hashtags, ...foundArchetypes.map(a => `Archetype:${a}`)];

    // 중복 제거 후 점수 더하기
    const uniqueTags = [...new Set(allTags)];
    for (const tag of uniqueTags) {
        const normalized = tag.toLowerCase(); // 대소문자 무시
        if (!trendMap[normalized]) {
            trendMap[normalized] = 0;
        }
        trendMap[normalized] += baseScore;
    }
}

/**
 * 최근 게시물들의 반응도 점수(engagement_score)를 바탕으로 
 * 어떤 키워드/스타일이 유행하는지 분석하여 저장합니다.
 */
export async function updateTrends() {
    if (!db) {
        console.warn("[Trends] Firebase DB not initialized. Skipping trend analysis.");
        return;
    }

    console.log(`[Trends] 트렌드 가중치 분석 시작...`);

    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - TREND_LOOKBACK_DAYS);

    try {
        const snapshot = await db.collection(PENDING_COLLECTION)
            .where('status', '==', 'published')
            .where('publishedAt', '>=', lookbackDate)
            .orderBy('publishedAt', 'desc')
            .get();

        if (snapshot.empty) {
            console.log(`[Trends] 지난 ${TREND_LOOKBACK_DAYS}일간 발행된 게시물이 없어 트렌드를 분석할 수 없습니다.`);
            return;
        }

        const trendMap = {};

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const score = data.engagement_score || 0;

            // 반응도 점수가 0인 게시물은 제외하거나, 약간의 기본 가중치만 부여
            if (score <= 0) continue;

            // 게시물 텍스트에서 태그와 아키타입 추출
            extractAndScoreTags(data.text, score, trendMap);
        }

        // 점수 순으로 정렬
        const sortedTrends = Object.entries(trendMap)
            .sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // 내림차순 정렬
            .map(([tag, score]) => ({ tag, score }));

        // 상위 10개만 보관
        const topTrends = sortedTrends.slice(0, 10);

        if (topTrends.length > 0) {
            // Firestore bot_settings/trends 문서에 저장
            await db.collection(TRENDS_COLLECTION).doc(TRENDS_DOC_ID).set({
                lastAnalyzed: new Date(),
                topTrends: topTrends
            });
            console.log(`[Trends] 트렌드 가중치 업데이트 완료. 상위 태그:`, topTrends.slice(0, 3).map(t => t.tag).join(', '));
        } else {
            console.log(`[Trends] 유의미한 가중치 데이터가 추출되지 않았습니다.`);
        }

    } catch (err) {
        console.error("[Trends] 분석 중 오류 발생:", err);
    }
}

/**
 * 텔레그램 초안 생성기 등에서 가장 반응이 좋았던 
 * 상위 가중치 트렌드를 문자열 프롬프트 형태로 가져올 때 사용합니다.
 */
export async function getTrendWeightsPrompt() {
    if (!db) return "";

    try {
        const doc = await db.collection(TRENDS_COLLECTION).doc(TRENDS_DOC_ID).get();
        if (!doc.exists) return "";

        const data = doc.data();
        const topTrends = data.topTrends || [];

        if (topTrends.length === 0) return "";

        // 상위 3개의 트렌드만 프롬프트에 활용
        const top3Tags = topTrends.slice(0, 3).map(t => t.tag.replace('archetype:', '아키타입:'));

        return `[최근 반응도 높은 인기 키워드 가중치: ${top3Tags.join(', ')} - 이 키워드들의 스타일을 우선적으로 고려해서 초안을 생성해줘.]`;
    } catch (err) {
        console.error("[Trends] 트렌드 가져오기 실패:", err);
        return "";
    }
}
