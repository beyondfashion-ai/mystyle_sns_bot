import cron from 'node-cron';
import { sendScheduledDraft } from './telegram.js';
import { runAnalytics } from './analytics.js';
import { scrapeExternalTrends } from './trendScraper.js';

/**
 * 자동 초안 스케줄러를 시작한다.
 * 하루 3회 (10:00, 15:00, 20:00 KST) 자동으로 초안을 생성하여 텔레그램으로 전송한다.
 * 사용자가 텔레그램에서 승인해야만 실제 게시된다.
 */
export function startScheduler(bot) {
    // 10:00 KST
    cron.schedule('0 10 * * *', async () => {
        console.log('[Scheduler] 10:00 KST 자동 초안 생성');
        try {
            await sendScheduledDraft(bot);
        } catch (err) {
            console.error('[Scheduler] 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    // 15:00 KST
    cron.schedule('0 15 * * *', async () => {
        console.log('[Scheduler] 15:00 KST 자동 초안 생성');
        try {
            await sendScheduledDraft(bot);
        } catch (err) {
            console.error('[Scheduler] 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    // 20:00 KST
    cron.schedule('0 20 * * *', async () => {
        console.log('[Scheduler] 20:00 KST 자동 초안 생성');
        try {
            await sendScheduledDraft(bot);
        } catch (err) {
            console.error('[Scheduler] 초안 전송 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    // 매일 자정에 통계 업데이트 및 외부 트렌드 수집 (KST)
    cron.schedule('0 0 * * *', async () => {
        console.log('[Scheduler] 00:00 KST SNS 성과 분석 / 외부 트렌드 수집 시작');
        try {
            await runAnalytics();      // 자체 셀프 피드백
            await scrapeExternalTrends(); // 외부 트렌드 크롤링
        } catch (err) {
            console.error('[Scheduler] 성과 분석 / 스크래핑 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    console.log('[Scheduler] 스케줄러 시작 (초안: 10:00, 15:00, 20:00 KST / 통계 분석: 00:00 KST)');
}
