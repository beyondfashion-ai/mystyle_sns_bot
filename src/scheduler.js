import cron from 'node-cron';
import { sendScheduledDraftX, sendScheduledDraftIG } from './telegram.js';
import { runAnalyticsWithReport } from './analytics.js';
import { scrapeExternalTrends } from './trendScraper.js';
import { runDailyEditorial, runWeeklyEditorial, runMonthlyEditorial, runQuarterlyEditorial } from './editorialEvolution.js';
import { updateTrends } from './trendAnalyzer.js';
import { getXFormatForNow, getIGFormatForNow, getFormatName } from './contentCalendar.js';
import { isSchedulerPaused } from './telegram/schedulerControl.js';
import { notifyError, resetErrorCount, initErrorNotifier } from './telegram/errorNotifier.js';

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
    // 중앙 에러 알림 초기화
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    initErrorNotifier(bot, adminChatId);

    // --- X 자동 초안 (10:00, 15:00, 20:00 KST) ---
    cron.schedule('0 10 * * *', async () => {
        if (isSchedulerPaused()) {
            console.log('[Scheduler] 10:00 KST X — 스케줄러 일시정지 상태. 건너뜀.');
            return;
        }
        const jobName = 'X_10:00';
        const format = getXFormatForNow();
        console.log(`[Scheduler] 10:00 KST X 자동 초안 생성 (포맷: ${getFormatName(format)})`);
        try {
            await sendScheduledDraftX(bot, format);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 15 * * *', async () => {
        if (isSchedulerPaused()) {
            console.log('[Scheduler] 15:00 KST X — 스케줄러 일시정지 상태. 건너뜀.');
            return;
        }
        const jobName = 'X_15:00';
        const format = getXFormatForNow();
        console.log(`[Scheduler] 15:00 KST X 자동 초안 생성 (포맷: ${getFormatName(format)})`);
        try {
            await sendScheduledDraftX(bot, format);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 20 * * *', async () => {
        if (isSchedulerPaused()) {
            console.log('[Scheduler] 20:00 KST X — 스케줄러 일시정지 상태. 건너뜀.');
            return;
        }
        const jobName = 'X_20:00';
        const format = getXFormatForNow();
        console.log(`[Scheduler] 20:00 KST X 자동 초안 생성 (포맷: ${getFormatName(format)})`);
        try {
            await sendScheduledDraftX(bot, format);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] X 초안 전송 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    // --- IG 자동 초안 (12:00, 18:00 KST) ---
    cron.schedule('0 12 * * *', async () => {
        if (isSchedulerPaused()) {
            console.log('[Scheduler] 12:00 KST IG — 스케줄러 일시정지 상태. 건너뜀.');
            return;
        }
        const jobName = 'IG_12:00';
        const format = getIGFormatForNow();
        console.log(`[Scheduler] 12:00 KST IG 자동 초안 생성 (포맷: ${getFormatName(format)})`);
        try {
            await sendScheduledDraftIG(bot, format);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] IG 초안 전송 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 18 * * *', async () => {
        if (isSchedulerPaused()) {
            console.log('[Scheduler] 18:00 KST IG — 스케줄러 일시정지 상태. 건너뜀.');
            return;
        }
        const jobName = 'IG_18:00';
        const format = getIGFormatForNow();
        console.log(`[Scheduler] 18:00 KST IG 자동 초안 생성 (포맷: ${getFormatName(format)})`);
        try {
            await sendScheduledDraftIG(bot, format);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] IG 초안 전송 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 매일 자정에 통계 업데이트 및 외부 트렌드 수집 + 내부 트렌드 가중치 분석 + 리포트 전송 (KST) ---
    cron.schedule('0 0 * * *', async () => {
        const jobName = 'analytics_00:00';
        console.log('[Scheduler] 00:00 KST SNS 성과 분석 / 외부 트렌드 수집 / 내부 트렌드 가중치 분석 + 리포트 전송 시작');
        try {
            const report = await runAnalyticsWithReport();
            await scrapeExternalTrends();
            await updateTrends();

            if (bot && adminChatId) {
                await bot.sendMessage(adminChatId, report, { parse_mode: 'Markdown' });
                console.log('[Scheduler] 주간 리포트 전송 완료');
            }
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] 성과 분석 / 스크래핑 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 에디토리얼 진화 (Editorial Evolution) — 일시정지 무관하게 항상 실행 ---
    cron.schedule('0 1 * * *', async () => {
        const jobName = 'editorial_daily';
        console.log('[Scheduler] 01:00 KST 일간 에디토리얼 분석');
        try {
            await runDailyEditorial();
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] 일간 에디토리얼 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 2 * * 0', async () => {
        const jobName = 'editorial_weekly';
        console.log('[Scheduler] 02:00 KST 주간 에디토리얼 분석');
        try {
            await runWeeklyEditorial();
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] 주간 에디토리얼 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 3 1 * *', async () => {
        const jobName = 'editorial_monthly';
        console.log('[Scheduler] 03:00 KST 월간 에디토리얼 분석');
        try {
            await runMonthlyEditorial();
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] 월간 에디토리얼 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 4 1 1,4,7,10 *', async () => {
        const jobName = 'editorial_quarterly';
        console.log('[Scheduler] 04:00 KST 분기 에디토리얼 분석');
        try {
            await runQuarterlyEditorial();
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] 분기 에디토리얼 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    console.log('[Scheduler] 스케줄러 시작 (X: 10:00, 15:00, 20:00 / IG: 12:00, 18:00 / 분석: 00:00 / 에디토리얼: 01-04:00 KST)');
}
