import { TwitterApi } from "twitter-api-v2";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { existsSync } from "fs";
import { db } from "./firebase.js";

if (existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
} else {
    dotenv.config();
}

// The collection names
const PENDING_COLLECTION = 'pending_sns_posts';
const TRENDS_COLLECTION = 'bot_settings';
const TRENDS_DOC_ID = 'trends';

// We fetch metrics for posts published within the last X hours
const LOOKBACK_HOURS = 48;

/**
 * Weights for the engagement score
 */
const SCORE_WEIGHTS = {
    x: {
        like: 1,
        retweet: 2,
        reply: 1.5,
        impression: 0.01 // views
    },
    instagram: {
        like: 1,
        comments: 2,
    }
};

/**
 * Queries X API for public metrics of a given tweet ID
 */
async function getXMetrics(tweetId) {
    try {
        const client = new TwitterApi(process.env.X_ACCESS_TOKEN); // using bearer token or user token based on v2 access level
        // For app-only authentication (Bearer Token) we might prefer that over user context if only reading metrics
        const roClient = process.env.X_BEARER_TOKEN ?
            new TwitterApi(process.env.X_BEARER_TOKEN).readOnly :
            new TwitterApi({
                appKey: process.env.X_API_KEY,
                appSecret: process.env.X_API_SECRET_KEY,
                accessToken: process.env.X_ACCESS_TOKEN,
                accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
            }).readOnly;

        const tweet = await roClient.v2.singleTweet(tweetId, {
            "tweet.fields": ["public_metrics"]
        });

        if (tweet.data && tweet.data.public_metrics) {
            return tweet.data.public_metrics;
        }
        return null;
    } catch (err) {
        console.error(`Error fetching X metrics for ${tweetId}:`, err.message);
        return null;
    }
}

/**
 * Queries Instagram Graph API for insights of a given media ID
 */
async function getInstagramMetrics(mediaId) {
    try {
        const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
        // The Instagram Graph API for media insights
        // basic metrics: like_count, comments_count
        const url = `https://graph.facebook.com/v19.0/${mediaId}?fields=like_count,comments_count&access_token=${accessToken}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data && !data.error) {
            return {
                like_count: data.like_count || 0,
                comments_count: data.comments_count || 0
            };
        } else {
            console.error(`Instagram API Error for ${mediaId}:`, data.error);
        }
        return null;
    } catch (err) {
        console.error(`Error fetching Instagram metrics for ${mediaId}:`, err.message);
        return null;
    }
}

/**
 * Calculates the combined engagement score
 */
function calculateScore(xMetrics, igMetrics) {
    let score = 0;

    if (xMetrics) {
        score += (xMetrics.like_count || 0) * SCORE_WEIGHTS.x.like;
        score += (xMetrics.retweet_count || 0) * SCORE_WEIGHTS.x.retweet;
        score += (xMetrics.reply_count || 0) * SCORE_WEIGHTS.x.reply;
        score += (xMetrics.impression_count || 0) * SCORE_WEIGHTS.x.impression;
    }

    if (igMetrics) {
        score += (igMetrics.like_count || 0) * SCORE_WEIGHTS.instagram.like;
        score += (igMetrics.comments_count || 0) * SCORE_WEIGHTS.instagram.comments;
    }

    return score;
}

/**
 * Main Analytics Loop
 * Finds recently published posts, queries APIs, and updates their score in Firestore.
 */
export async function runAnalytics() {
    if (!db) {
        console.warn("Firebase DB not initialized. Skipping analytics.");
        return;
    }

    console.log(`[Analytics] Starting SNS Engagement Tracker...`);

    // Look back window
    const lookbackDate = new Date();
    lookbackDate.setHours(lookbackDate.getHours() - LOOKBACK_HOURS);

    try {
        // Find posts published within the window
        const snapshot = await db.collection(PENDING_COLLECTION)
            .where('status', '==', 'published')
            .where('publishedAt', '>=', lookbackDate)
            .get();

        if (snapshot.empty) {
            console.log(`[Analytics] No recent published posts found in the last ${LOOKBACK_HOURS} hours.`);
            return;
        }

        console.log(`[Analytics] Found ${snapshot.size} posts to analyze.`);

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const results = data.results || {};

            let xMetrics = null;
            let igMetrics = null;

            // 1. Fetch X Metrics
            if (results.x && results.x.success && results.x.id) {
                xMetrics = await getXMetrics(results.x.id);
            }

            // 2. Fetch IG Metrics
            if (results.instagram && results.instagram.success && results.instagram.id) {
                igMetrics = await getInstagramMetrics(results.instagram.id);
            }

            // 3. Compute Score
            const newScore = calculateScore(xMetrics, igMetrics);

            // 4. Update Document
            if (xMetrics !== null || igMetrics !== null) {
                const updatePayload = {
                    engagement_score: newScore,
                    metrics_last_updated: new Date()
                };

                // Store raw metrics for debugging/display
                if (xMetrics) updatePayload['raw_metrics_x'] = xMetrics;
                if (igMetrics) updatePayload['raw_metrics_ig'] = igMetrics;

                await doc.ref.update(updatePayload);
                console.log(`[Analytics] Updated Post ${doc.id} - Score: ${newScore}`);
            }

            // Artificial delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`[Analytics] Completed Engagement Tracking.`);
    } catch (err) {
        console.error("[Analytics] Error during execution:", err);
    }
}

/**
 * Generates a weekly performance report for Telegram
 */
export async function generateReport() {
    if (!db) {
        return '⚠️ Firebase가 설정되지 않아 리포트를 생성할 수 없습니다.';
    }

    try {
        // Last 7 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);

        const snapshot = await db.collection(PENDING_COLLECTION)
            .where('status', '==', 'published')
            .where('publishedAt', '>=', startDate)
            .orderBy('publishedAt', 'desc')
            .get();

        if (snapshot.empty) {
            return '📊 지난 7일간 게시된 포스트가 없습니다.';
        }

        const posts = [];
        let xCount = 0, xSuccess = 0;
        let igCount = 0, igSuccess = 0;
        let totalScore = 0, maxScore = 0;
        const hashtags = new Map();

        snapshot.forEach(doc => {
            const data = doc.data();
            posts.push(data);

            // Platform stats
            if (data.platforms?.includes('x')) {
                xCount++;
                if (data.results?.x?.success) xSuccess++;
            }
            if (data.platforms?.includes('instagram')) {
                igCount++;
                if (data.results?.instagram?.success) igSuccess++;
            }

            // Score stats
            const score = data.engagement_score || 0;
            totalScore += score;
            if (score > maxScore) maxScore = score;

            // Extract hashtags
            const tags = (data.text || '').match(/#[\wㄱ-ㅎㅏ-ㅣ가-힣]+/g) || [];
            tags.forEach(tag => {
                hashtags.set(tag, (hashtags.get(tag) || 0) + 1);
            });
        });

        // Top 3 posts by engagement score
        const topPosts = posts
            .sort((a, b) => (b.engagement_score || 0) - (a.engagement_score || 0))
            .slice(0, 3);

        // Top 3 hashtags
        const topHashtags = Array.from(hashtags.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tag]) => tag);

        const avgScore = posts.length > 0 ? Math.round(totalScore / posts.length) : 0;

        const formatDate = (date) => {
            const d = date instanceof Date ? date : new Date(date);
            return `${d.getMonth() + 1}/${d.getDate()}`;
        };

        const truncate = (text, maxLen = 40) => {
            if (!text) return '(내용 없음)';
            const cleaned = text.replace(/\n/g, ' ').trim();
            return cleaned.length > maxLen ? cleaned.substring(0, maxLen) + '...' : cleaned;
        };

        const report = [
            '📊 *주간 성과 리포트*',
            '',
            `📅 기간: ${formatDate(startDate)} ~ ${formatDate(new Date())}`,
            '',
            `📝 총 게시물: ${posts.length}건`,
            `  ├ X: ${xCount}건 (성공: ${xSuccess}건)`,
            `  └ IG: ${igCount}건 (성공: ${igSuccess}건)`,
            '',
            '🔥 *TOP 3 인기 게시물*',
            ...topPosts.map((post, i) => {
                const score = post.engagement_score || 0;
                return `${i + 1}. [${score}점] ${truncate(post.text)}`;
            }),
            '',
            `📈 총 Engagement Score: ${totalScore}`,
            `  ├ 평균: ${avgScore}`,
            `  └ 최고: ${maxScore}`,
            '',
            `🏷️ 인기 키워드: ${topHashtags.length > 0 ? topHashtags.join(', ') : '(없음)'}`,
        ].join('\n');

        return report;
    } catch (err) {
        console.error('[Analytics] 리포트 생성 실패:', err.message);
        return `❌ 리포트 생성 중 오류 발생: ${err.message}`;
    }
}

/**
 * Runs analytics and generates a report for Telegram
 */
export async function runAnalyticsWithReport() {
    await runAnalytics();
    return await generateReport();
}
