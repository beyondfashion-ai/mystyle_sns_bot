import cron from 'node-cron';
import { sendScheduledDraftX, sendScheduledDraftIG } from './telegram.js';
import { runAnalyticsWithReport } from './analytics.js';
import { scrapeExternalTrends } from './trendScraper.js';
import { runDailyEditorial, runWeeklyEditorial, runMonthlyEditorial, runQuarterlyEditorial } from './editorialEvolution.js';
import { updateTrends } from './trendAnalyzer.js';
import { collectNews } from './newsCollector.js';
import { collectBuzzSignals } from './buzzCollector.js';

/**
 * 스케줄러 에러를 관리자에게 텔레그램으로 알린다.
 */
async function notifyError(bot, jobName, error) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;
    try {
        const msg = `⚠️ *스케줄러 에러*\nJob: \`${jobName}\`\nError: ${error.message}`;
        await bot.sendMessage(adminChatId, msg, { parse_mode: 'Markdown' });
    } catch (sendErr) {
        console.error('[Scheduler] 에러 알림 전송 실패:', sendErr.message);
    }
}

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
            await notifyError(bot, 'X 초안 (10:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 15 * * *', async () => {
        console.log('[Scheduler] 15:00 KST X 자동 초안 생성');
        try {
            await sendScheduledDraftX(bot);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
            await notifyError(bot, 'X 초안 (15:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 20 * * *', async () => {
        console.log('[Scheduler] 20:00 KST X 자동 초안 생성');
        try {
            await sendScheduledDraftX(bot);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
            await notifyError(bot, 'X 초안 (20:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- IG 자동 초안 (12:00, 18:00 KST) ---
    cron.schedule('0 12 * * *', async () => {
        console.log('[Scheduler] 12:00 KST IG 자동 초안 생성 (이미지 포함)');
        try {
            await sendScheduledDraftIG(bot);
        } catch (err) {
            console.error('[Scheduler] IG 초안 전송 실패:', err.message);
            await notifyError(bot, 'IG 초안 (12:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 18 * * *', async () => {
        console.log('[Scheduler] 18:00 KST IG 자동 초안 생성 (이미지 포함)');
        try {
            await sendScheduledDraftIG(bot);
        } catch (err) {
            console.error('[Scheduler] IG 초안 전송 실패:', err.message);
            await notifyError(bot, 'IG 초안 (18:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 매일 자정에 통계 업데이트 및 외부 트렌드 수집 + 내부 트렌드 가중치 분석 + 리포트 전송 (KST) ---
    cron.schedule('0 0 * * *', async () => {
        console.log('[Scheduler] 00:00 KST SNS 성과 분석 / 외부 트렌드 수집 / 내부 트렌드 가중치 분석 + 리포트 전송 시작');
        try {
            const report = await runAnalyticsWithReport();
            await scrapeExternalTrends();
            await updateTrends(); // 내부 engagement 기반 트렌드 가중치 분석

            // Send report to admin
            const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
            if (bot && adminChatId) {
                await bot.sendMessage(adminChatId, report, { parse_mode: 'Markdown' });
                console.log('[Scheduler] 주간 리포트 전송 완료');
            }
        } catch (err) {
            console.error('[Scheduler] 성과 분석 / 스크래핑 실패:', err.message);
            await notifyError(bot, '성과 분석/트렌드 (00:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 05:30 KST 화제성 신호 수집 (Google Trends + YouTube + Naver DataLab) ---
    cron.schedule('30 5 * * *', async () => {
        console.log('[Scheduler] 05:30 KST 화제성 신호 수집 시작');
        try {
            await collectBuzzSignals();
        } catch (err) {
            console.error('[Scheduler] 화제성 수집 실패:', err.message);
            await notifyError(bot, '화제성 수집 (05:30)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 06:00 KST 뉴스 수집 (05:30에 수집한 화제성 데이터 활용) ---
    cron.schedule('0 6 * * *', async () => {
        console.log('[Scheduler] 06:00 KST 뉴스 수집 시작');
        try {
            await collectNews();
        } catch (err) {
            console.error('[Scheduler] 뉴스 수집 실패:', err.message);
            await notifyError(bot, '뉴스 수집 (06:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 에디토리얼 진화 (Editorial Evolution) ---
    // 매일 01:00 KST - 일간 에디토리얼 미세 조정
    cron.schedule('0 1 * * *', async () => {
        console.log('[Scheduler] 01:00 KST 일간 에디토리얼 분석');
        try {
            await runDailyEditorial();
        } catch (err) {
            console.error('[Scheduler] 일간 에디토리얼 실패:', err.message);
            await notifyError(bot, '일간 에디토리얼 (01:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // 매주 일요일 02:00 KST - 주간 에디토리얼 방향 조정
    cron.schedule('0 2 * * 0', async () => {
        console.log('[Scheduler] 02:00 KST 주간 에디토리얼 분석');
        try {
            await runWeeklyEditorial();
        } catch (err) {
            console.error('[Scheduler] 주간 에디토리얼 실패:', err.message);
            await notifyError(bot, '주간 에디토리얼 (02:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // 매월 1일 03:00 KST - 월간 에디토리얼 전략 재평가
    cron.schedule('0 3 1 * *', async () => {
        console.log('[Scheduler] 03:00 KST 월간 에디토리얼 분석');
        try {
            await runMonthlyEditorial();
        } catch (err) {
            console.error('[Scheduler] 월간 에디토리얼 실패:', err.message);
            await notifyError(bot, '월간 에디토리얼 (03:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    // 분기 첫 달 1일 04:00 KST - 분기 에디토리얼 비전 재설정
    cron.schedule('0 4 1 1,4,7,10 *', async () => {
        console.log('[Scheduler] 04:00 KST 분기 에디토리얼 분석');
        try {
            await runQuarterlyEditorial();
        } catch (err) {
            console.error('[Scheduler] 분기 에디토리얼 실패:', err.message);
            await notifyError(bot, '분기 에디토리얼 (04:00)', err);
        }
    }, { timezone: 'Asia/Seoul' });

    console.log('[Scheduler] 스케줄러 시작 (X: 10:00, 15:00, 20:00 / IG: 12:00, 18:00 / 분석: 00:00 / 화제성: 05:30 / 뉴스: 06:00 / 에디토리얼: 01-04:00 KST)');
}
