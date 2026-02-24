import { db } from './firebase.js';
import { postToSNS } from './bot.js';
import cron from 'node-cron';

// The collection name in mystyleKPOP's Firestore where pending posts are stored
const PENDING_COLLECTION = 'pending_sns_posts';

async function processPendingPosts() {
    if (!db) {
        console.warn("Firebase DB is not initialized. Skipping scheduled check.");
        return;
    }

    try {
        console.log(`[${new Date().toISOString()}] Checking for pending SNS posts...`);

        // Fetch posts that are ready to be published (status: 'pending')
        // We limit to 1 per check to avoid hitting rate limits too quickly
        const snapshot = await db.collection(PENDING_COLLECTION)
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'asc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            console.log("No pending posts found.");
            return;
        }

        for (const doc of snapshot.docs) {
            const postData = doc.data();
            const { text, imageUrls, platforms } = postData;

            console.log(`Processing post ID: ${doc.id}`);

            // We mark as processing to avoid duplicate pickups during long API calls
            await doc.ref.update({ status: 'processing' });

            try {
                // Call the existing X and Instagram bot logic
                const results = await postToSNS({
                    platforms: platforms || ['x', 'instagram'], // Default to both if not specified
                    text: text,
                    imageUrls: imageUrls
                });

                console.log('SNS Post Results:', results);

                // Mark as published on success
                await doc.ref.update({
                    status: 'published',
                    publishedAt: new Date(),
                    results: results
                });

                console.log(`Successfully published post ID: ${doc.id}`);
            } catch (postError) {
                console.error(`Failed to post ID ${doc.id}:`, postError);
                // Ensure we mark it back to failed so we know what happened
                await doc.ref.update({
                    status: 'failed',
                    error: postError.message
                });
            }
        }
    } catch (error) {
        console.error("Error checking pending posts:", error);
    }
}

// Ensure database connection is logged
if (db) {
    console.log("Scheduler is ready and linked to Firebase.");
}

// --------------------------------------------------------------------------
// Schedulers
// --------------------------------------------------------------------------

// Example: Run every 30 minutes (Adjust as needed based on your X rate limits)
// The cron expression '0,30 * * * *' means "Run at minute 0 and 30 past every hour"
cron.schedule('0,30 * * * *', () => {
    processPendingPosts();
});

console.log("SNS Bot Scheduler is running. Waiting for next cron tick...");

// We can also trigger it once right away upon startup to clear out backlog
// processPendingPosts();
