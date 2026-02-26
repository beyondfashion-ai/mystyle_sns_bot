import { db } from '../firebase.js';

// ===== 스케줄러 상태 =====
let schedulerPaused = false;

const SETTINGS_COLLECTION = 'bot_settings';
const SCHEDULER_DOC = 'scheduler_state';

/**
 * 스케줄러가 일시정지 상태인지 확인 (동기 — cron 콜백에서 사용)
 */
export function isSchedulerPaused() {
    return schedulerPaused;
}

/**
 * 스케줄러 일시정지
 */
export async function pauseScheduler() {
    schedulerPaused = true;
    if (!db) return;
    try {
        await db.collection(SETTINGS_COLLECTION).doc(SCHEDULER_DOC).set({
            paused: true,
            pausedAt: new Date(),
        }, { merge: true });
    } catch (err) {
        console.error('[SchedulerControl] Firestore pause 저장 실패:', err.message);
    }
}

/**
 * 스케줄러 재개
 */
export async function resumeScheduler() {
    schedulerPaused = false;
    if (!db) return;
    try {
        await db.collection(SETTINGS_COLLECTION).doc(SCHEDULER_DOC).set({
            paused: false,
            resumedAt: new Date(),
        }, { merge: true });
    } catch (err) {
        console.error('[SchedulerControl] Firestore resume 저장 실패:', err.message);
    }
}

/**
 * 봇 시작 시 Firestore에서 스케줄러 상태 복구
 */
export async function restoreSchedulerState() {
    if (!db) return;
    try {
        const doc = await db.collection(SETTINGS_COLLECTION).doc(SCHEDULER_DOC).get();
        if (doc.exists && doc.data().paused) {
            schedulerPaused = true;
            console.log('[SchedulerControl] Firestore에서 일시정지 상태 복구');
        }
    } catch (err) {
        console.error('[SchedulerControl] 상태 복구 실패:', err.message);
    }
}
