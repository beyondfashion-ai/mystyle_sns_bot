import { TwitterApi } from "twitter-api-v2";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { db } from "./firebase.js";

dotenv.config();

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
