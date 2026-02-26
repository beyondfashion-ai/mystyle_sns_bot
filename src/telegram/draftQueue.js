import { db } from '../firebase.js';

/**
 * 승인된 초안 예약 큐
 * 9AM에 D+2 초안을 생성하고 관리자가 승인하면 여기에 저장되어,
 * 해당 날짜의 예약 시간(10/12/15/18/20 KST)에 자동 게시된다.
 *
 * slotKey 형식: "YYYY-MM-DD_x_10", "YYYY-MM-DD_ig_12" 등
 * (레거시: "x_10", "ig_12" 도 호환 지원)
 */

const QUEUE_COLLECTION = 'draft_queue';

// slotKey -> { draft, scheduledHour, platform, formatKey }
export const approvedQueue = new Map();

// ===== Firestore 영속화 (fire-and-forget) =====

async function persistToFirestore(slotKey, entry) {
    if (!db) return;
    try {
        await db.collection(QUEUE_COLLECTION).doc(slotKey).set({
            draft: entry.draft,
            scheduledHour: entry.scheduledHour,
            platform: entry.platform,
            formatKey: entry.formatKey,
            approvedAt: new Date(),
        });
    } catch (err) {
        console.error('[DraftQueue] Firestore persist failed:', err.message);
    }
}

async function removeFromFirestore(slotKey) {
    if (!db) return;
    try {
        await db.collection(QUEUE_COLLECTION).doc(slotKey).delete();
    } catch (err) {
        console.error('[DraftQueue] Firestore delete failed:', err.message);
    }
}

// ===== 큐 조작 함수 =====

/**
 * 승인된 초안을 예약 큐에 추가
 */
export function queueApprovedDraft(slotKey, draft) {
    const entry = {
        draft,
        scheduledHour: draft.scheduledHour,
        platform: draft.platform,
        formatKey: draft.category,
    };
    approvedQueue.set(slotKey, entry);
    persistToFirestore(slotKey, entry);
}

/**
 * 예약 큐에서 승인된 초안 조회
 */
export function getApprovedDraft(slotKey) {
    return approvedQueue.get(slotKey) || null;
}

/**
 * 예약 큐에서 제거 (게시 완료 후)
 */
export function removeFromQueue(slotKey) {
    approvedQueue.delete(slotKey);
    removeFromFirestore(slotKey);
}

/**
 * 하루 시작 시 큐 초기화 (전날 잔여 데이터 제거)
 * @deprecated clearQueueForDate() 사용 권장
 */
export function clearDailyQueue() {
    for (const key of approvedQueue.keys()) {
        removeFromFirestore(key);
    }
    approvedQueue.clear();
}

/**
 * 특정 날짜의 큐만 초기화 (D-2 생성 시 해당 날짜만 삭제)
 * @param {string} dateStr - "YYYY-MM-DD" 형식
 */
export function clearQueueForDate(dateStr) {
    for (const key of approvedQueue.keys()) {
        if (key.startsWith(dateStr + '_')) {
            removeFromFirestore(key);
            approvedQueue.delete(key);
        }
    }
}

/**
 * KST 날짜 문자열 반환 ("YYYY-MM-DD")
 */
function getKSTDateStr(date) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

/**
 * 봇 시작 시 Firestore에서 승인 큐 복구.
 * 오늘~모레 범위의 큐만 복구, 과거 데이터는 삭제.
 */
export async function restoreDraftQueue() {
    if (!db) return;
    try {
        const snapshot = await db.collection(QUEUE_COLLECTION).get();
        const now = new Date();

        // 오늘, 내일, 모레 KST 날짜 (D-2 생성이므로 최대 D+2까지 유효)
        const validDates = new Set();
        for (let i = 0; i <= 2; i++) {
            const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
            validDates.add(getKSTDateStr(d));
        }

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const slotKey = doc.id;

            // 날짜 포함 slotKey: "2026-02-28_x_10" → 앞 10글자가 날짜
            const datePrefix = slotKey.match(/^(\d{4}-\d{2}-\d{2})_/)?.[1];

            if (datePrefix && validDates.has(datePrefix)) {
                // 오늘~모레 범위: 복구
                approvedQueue.set(slotKey, {
                    draft: data.draft,
                    scheduledHour: data.scheduledHour,
                    platform: data.platform,
                    formatKey: data.formatKey,
                });
            } else if (!datePrefix) {
                // 레거시 형식 (날짜 없음): 오늘 승인된 것만 복구
                const approvedAt = data.approvedAt?.toDate?.();
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (approvedAt && approvedAt >= today) {
                    approvedQueue.set(slotKey, {
                        draft: data.draft,
                        scheduledHour: data.scheduledHour,
                        platform: data.platform,
                        formatKey: data.formatKey,
                    });
                } else {
                    await db.collection(QUEUE_COLLECTION).doc(doc.id).delete();
                }
            } else {
                // 과거 날짜: 삭제
                await db.collection(QUEUE_COLLECTION).doc(doc.id).delete();
            }
        }

        if (approvedQueue.size > 0) {
            console.log(`[DraftQueue] ${approvedQueue.size}개 승인 초안 복구`);
        }
    } catch (err) {
        console.error('[DraftQueue] 복구 실패:', err.message);
    }
}
