import cron from 'node-cron';
import { generateDailyDrafts, postScheduledSlot, getKSTDateStr, remindUnapprovedSlot, remindTomorrowUnapproved } from './telegram/scheduled.js';
import { runAnalyticsWithReport } from './analytics.js';
import { scrapeExternalTrends } from './trendScraper.js';
import { runDailyEditorial, runWeeklyEditorial, runMonthlyEditorial, runQuarterlyEditorial } from './editorialEvolution.js';
import { updateTrends } from './trendAnalyzer.js';
import { isSchedulerPaused } from './telegram/schedulerControl.js';
import { notifyError, resetErrorCount, initErrorNotifier } from './telegram/errorNotifier.js';

/**
 * 스케줄러를 시작한다.
 *
 * 09:00 KST - D+2 초안 일괄 생성 (관리자 검수용, 이틀 후 게시)
 * 10:00, 15:00, 20:00 KST - 승인된 X 초안 자동 게시
 * 12:00, 18:00 KST - 승인된 IG 초안 자동 게시
 * 00:00 KST - Analytics + 트렌드 분석
 */
export function startScheduler(bot) {
    // 중앙 에러 알림 초기화
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    initErrorNotifier(bot, adminChatId);

    // --- 09:00 KST: D+2 초안 일괄 생성 (검수용) ---
    cron.schedule('0 9 * * *', async () => {
        if (isSchedulerPaused()) {
            console.log('[Scheduler] 09:00 KST — 스케줄러 일시정지 상태. 건너뜀.');
            return;
        }
        const jobName = 'daily_generation';
        console.log('[Scheduler] 09:00 KST D+2 초안 일괄 생성 시작');
        try {
            await generateDailyDrafts(bot);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] 초안 일괄 생성 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    // --- X 예약 게시 (10:00, 15:00, 20:00 KST) ---
    // slotKey에 오늘 KST 날짜를 포함하여 D-2 생성분과 매칭
    cron.schedule('0 10 * * *', async () => {
        if (isSchedulerPaused()) return;
        const jobName = 'X_10:00';
        const today = getKSTDateStr(new Date());
        console.log(`[Scheduler] 10:00 KST X 예약 게시 (${today})`);
        try {
            await postScheduledSlot(bot, `${today}_x_10`);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] X 10:00 게시 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 15 * * *', async () => {
        if (isSchedulerPaused()) return;
        const jobName = 'X_15:00';
        const today = getKSTDateStr(new Date());
        console.log(`[Scheduler] 15:00 KST X 예약 게시 (${today})`);
        try {
            await postScheduledSlot(bot, `${today}_x_15`);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] X 15:00 게시 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 20 * * *', async () => {
        if (isSchedulerPaused()) return;
        const jobName = 'X_20:00';
        const today = getKSTDateStr(new Date());
        console.log(`[Scheduler] 20:00 KST X 예약 게시 (${today})`);
        try {
            await postScheduledSlot(bot, `${today}_x_20`);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] X 20:00 게시 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    // --- IG 예약 게시 (12:00, 18:00 KST) ---
    cron.schedule('0 12 * * *', async () => {
        if (isSchedulerPaused()) return;
        const jobName = 'IG_12:00';
        const today = getKSTDateStr(new Date());
        console.log(`[Scheduler] 12:00 KST IG 예약 게시 (${today})`);
        try {
            await postScheduledSlot(bot, `${today}_ig_12`);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] IG 12:00 게시 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 18 * * *', async () => {
        if (isSchedulerPaused()) return;
        const jobName = 'IG_18:00';
        const today = getKSTDateStr(new Date());
        console.log(`[Scheduler] 18:00 KST IG 예약 게시 (${today})`);
        try {
            await postScheduledSlot(bot, `${today}_ig_18`);
            resetErrorCount(jobName);
        } catch (err) {
            console.error('[Scheduler] IG 18:00 게시 실패:', err.message);
            await notifyError(`scheduler:${jobName}`, err, { jobName });
        }
    }, { timezone: 'Asia/Seoul' });

    // --- D-1 21:00 KST: 내일 미승인 일괄 리마인더 ---
    cron.schedule('0 21 * * *', async () => {
        try {
            await remindTomorrowUnapproved(bot);
        } catch (err) {
            console.error('[Scheduler] D-1 리마인더 실패:', err.message);
        }
    }, { timezone: 'Asia/Seoul' });

    // --- 30분 전 미승인 리마인더 (게시 시간별) ---
    const reminderSlots = [
        { cronExpr: '30 9 * * *', platform: 'x', hour: 10 },
        { cronExpr: '30 11 * * *', platform: 'ig', hour: 12 },
        { cronExpr: '30 14 * * *', platform: 'x', hour: 15 },
        { cronExpr: '30 17 * * *', platform: 'ig', hour: 18 },
        { cronExpr: '30 19 * * *', platform: 'x', hour: 20 },
    ];
    for (const { cronExpr, platform, hour } of reminderSlots) {
        cron.schedule(cronExpr, async () => {
            if (isSchedulerPaused()) return;
            const today = getKSTDateStr(new Date());
            try {
                await remindUnapprovedSlot(bot, `${today}_${platform}_${hour}`);
            } catch (err) {
                console.error(`[Scheduler] ${hour}:00 리마인더 실패:`, err.message);
            }
        }, { timezone: 'Asia/Seoul' });
    }

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

    console.log('[Scheduler] 스케줄러 시작 (D+2 초안생성: 09:00 / 리마인더: 30분전 / D-1 알림: 21:00 / X 게시: 10:00, 15:00, 20:00 / IG 게시: 12:00, 18:00 / 분석: 00:00 / 에디토리얼: 01-04:00 KST)');
}
