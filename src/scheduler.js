import cron from 'node-cron';
import { sendScheduledDraftX, sendScheduledDraftIG } from './telegram.js';
import { runAnalytics } from './analytics.js';
import { scrapeExternalTrends } from './trendScraper.js';

/**
 * X/IG 분리 스케줄러를 시작한다.
 * X와 IG 시간대를 오프셋하여 fal.ai 동시 부하를 방지한다.
 *
 * 10:00 KST - X 자동 초안
 * 12:00 KST - IG 자동 초안 (이미지 생성)
 * 15:00 KST - X 자동 초안
 * 18:00 KST - IG 자동 초안 (이미지 생성)
 * 20:00 KST - X 자동 초안
 * 00:00 KST - Analytics + 트렌드 분석
 */
export function startScheduler(bot) {
    // --- X 자동 초안 (10:00, 15:00, 20:00 KST) ---
    cron.schedule('0 10 * * *', async () => {
        console.log('[Scheduler] 10:00 KST X 자동 초안 생성');
        try {
            await sendScheduledDraftX(bot);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 15 * * *', async () => {
        console.log('[Scheduler] 15:00 KST X 자동 초안 생성');
        try {
            await sendScheduledDraftX(bot);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 20 * * *', async () => {
        console.log('[Scheduler] 20:00 KST X 자동 초안 생성');
        try {
            await sendScheduledDraftX(bot);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- IG 자동 초안 (12:00, 18:00 KST) ---
    cron.schedule('0 12 * * *', async () => {
        console.log('[Scheduler] 12:00 KST IG 자동 초안 생성 (이미지 포함)');
        try {
            await sendScheduledDraftIG(bot);
        } catch (err) {
            console.error('[Scheduler] IG 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 18 * * *', async () => {
        console.log('[Scheduler] 18:00 KST IG 자동 초안 생성 (이미지 포함)');
        try {
            await sendScheduledDraftIG(bot);
        } catch (err) {
            console.error('[Scheduler] IG 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 매일 자정에 통계 업데이트 및 외부 트렌드 수집 (KST) ---
    cron.schedule('0 0 * * *', async () => {
        console.log('[Scheduler] 00:00 KST SNS 성과 분석 / 외부 트렌드 수집 시작');
        try {
            await runAnalytics();
            await scrapeExternalTrends();
        } catch (err) {
            console.error('[Scheduler] 성과 분석 / 스크래핑 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    console.log('[Scheduler] 스케줄러 시작 (X: 10:00, 15:00, 20:00 / IG: 12:00, 18:00 / 분석: 00:00 KST)');
}
