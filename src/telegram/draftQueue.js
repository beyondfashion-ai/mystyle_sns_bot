import { db } from '../firebase.js';

/**
 * 승인된 초안 예약 큐
 * 9AM에 생성된 초안을 관리자가 승인하면 여기에 저장되고,
 * 예약 시간(10/12/15/18/20 KST)에 자동 게시된다.
 *
 * slotKey 형식: "x_10", "x_15", "x_20", "ig_12", "ig_18"
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
 */
export function clearDailyQueue() {
    for (const key of approvedQueue.keys()) {
        removeFromFirestore(key);
    }
    approvedQueue.clear();
}

/**
 * 봇 시작 시 Firestore에서 오늘의 승인 큐 복구
 */
export async function restoreDraftQueue() {
    if (!db) return;
    try {
        const snapshot = await db.collection(QUEUE_COLLECTION).get();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const approvedAt = data.approvedAt?.toDate?.();

            // 오늘 승인된 것만 복구, 어제 이전 것은 삭제
            if (approvedAt && approvedAt >= today) {
                approvedQueue.set(doc.id, {
                    draft: data.draft,
                    scheduledHour: data.scheduledHour,
                    platform: data.platform,
                    formatKey: data.formatKey,
                });
            } else {
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
