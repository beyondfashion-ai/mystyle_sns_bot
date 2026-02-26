import { db } from '../firebase.js';

// ===== 상태 컨테이너 =====
export const pendingDrafts = new Map();   // messageId -> { text, category, type, platform, imageUrl, artist }
export const pendingCardNews = new Map(); // messageId -> { type, title, imageUrls, caption, artist }
export const editMode = new Map();        // chatId -> messageId

// ===== TTL 설정 =====
const DRAFT_TTL_MS = 30 * 60 * 1000; // 30분
const draftTimestamps = new Map();    // messageId -> timestamp

// ===== Firestore 컬렉션 =====
const DRAFTS_COLLECTION = 'telegram_drafts';
const CARDNEWS_COLLECTION = 'telegram_cardnews';

// ===== Firestore 영속화 (fire-and-forget) =====

async function persistDraftToFirestore(messageId, draft) {
    if (!db) return;
    try {
        await db.collection(DRAFTS_COLLECTION).doc(String(messageId)).set({
            ...draft,
            status: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
        });
    } catch (err) {
        console.error('[State] Firestore draft persist failed:', err.message);
    }
}

async function removeDraftFromFirestore(messageId) {
    if (!db) return;
    try {
        await db.collection(DRAFTS_COLLECTION).doc(String(messageId)).delete();
    } catch (err) {
        console.error('[State] Firestore draft delete failed:', err.message);
    }
}

async function persistCardNewsToFirestore(messageId, cnData) {
    if (!db) return;
    try {
        await db.collection(CARDNEWS_COLLECTION).doc(String(messageId)).set({
            ...cnData,
            status: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
        });
    } catch (err) {
        console.error('[State] Firestore cardnews persist failed:', err.message);
    }
}

async function removeCardNewsFromFirestore(messageId) {
    if (!db) return;
    try {
        await db.collection(CARDNEWS_COLLECTION).doc(String(messageId)).delete();
    } catch (err) {
        console.error('[State] Firestore cardnews delete failed:', err.message);
    }
}

/**
 * 초안 상태를 Firestore에서 갱신 (이력용: approved/rejected)
 */
export async function updateDraftStatus(messageId, status, extra = {}) {
    pendingDrafts.delete(messageId);
    if (!db) return;
    try {
        await db.collection(DRAFTS_COLLECTION).doc(String(messageId)).update({
            status,
            updatedAt: new Date(),
            ...extra,
        });
    } catch (err) {
        console.error('[State] Firestore draft status update failed:', err.message);
    }
}

/**
 * 카드뉴스 상태를 Firestore에서 갱신
 */
export async function updateCardNewsStatus(messageId, status, extra = {}) {
    pendingCardNews.delete(messageId);
    if (!db) return;
    try {
        await db.collection(CARDNEWS_COLLECTION).doc(String(messageId)).update({
            status,
            updatedAt: new Date(),
            ...extra,
        });
    } catch (err) {
        console.error('[State] Firestore cardnews status update failed:', err.message);
    }
}

// ===== TTL 정리 + Map 인터셉터 =====

export function setupTTLCleanup() {
    // pendingDrafts.set/delete 인터셉트
    const originalDraftSet = pendingDrafts.set.bind(pendingDrafts);
    pendingDrafts.set = (key, value) => {
        draftTimestamps.set(key, Date.now());
        persistDraftToFirestore(key, value); // fire-and-forget
        return originalDraftSet(key, value);
    };
    const originalDraftDelete = pendingDrafts.delete.bind(pendingDrafts);
    pendingDrafts.delete = (key) => {
        draftTimestamps.delete(key);
        removeDraftFromFirestore(key); // fire-and-forget
        return originalDraftDelete(key);
    };

    // pendingCardNews.set/delete 인터셉트
    const originalCnSet = pendingCardNews.set.bind(pendingCardNews);
    pendingCardNews.set = (key, value) => {
        persistCardNewsToFirestore(key, value); // fire-and-forget
        return originalCnSet(key, value);
    };
    const originalCnDelete = pendingCardNews.delete.bind(pendingCardNews);
    pendingCardNews.delete = (key) => {
        removeCardNewsFromFirestore(key); // fire-and-forget
        return originalCnDelete(key);
    };

    // 5분 주기 TTL 정리
    setInterval(() => {
        const now = Date.now();
        for (const [key, ts] of draftTimestamps) {
            if (now - ts > DRAFT_TTL_MS) {
                pendingDrafts.delete(key);
            }
        }
        // editMode 중 대응하는 draft가 없는 항목 정리
        for (const [chatId] of editMode) {
            const entry = editMode.get(chatId);
            const msgId = typeof entry === 'object' ? entry.messageId : entry;
            if (!pendingDrafts.has(msgId)) {
                editMode.delete(chatId);
            }
        }
    }, 5 * 60 * 1000);
}

// ===== Firestore에서 상태 복구 (봇 시작 시) =====

export async function restoreStateFromFirestore() {
    if (!db) return;

    try {
        const now = new Date();

        // 대기 중인 초안 복구
        const draftSnapshot = await db.collection(DRAFTS_COLLECTION)
            .where('status', '==', 'pending')
            .where('expiresAt', '>', now)
            .get();

        for (const doc of draftSnapshot.docs) {
            const data = doc.data();
            const messageId = Number(doc.id);
            pendingDrafts.set(messageId, {
                text: data.text,
                category: data.category,
                type: data.type,
                platform: data.platform,
                imageUrl: data.imageUrl || null,
                artist: data.artist || null,
                imageDirection: data.imageDirection || null,
            });
        }

        // 대기 중인 카드뉴스 복구
        const cnSnapshot = await db.collection(CARDNEWS_COLLECTION)
            .where('status', '==', 'pending')
            .where('expiresAt', '>', now)
            .get();

        for (const doc of cnSnapshot.docs) {
            const data = doc.data();
            const messageId = Number(doc.id);
            pendingCardNews.set(messageId, {
                type: data.type,
                title: data.title,
                caption: data.caption,
                imageUrls: data.imageUrls || [],
                artist: data.artist || null,
            });
        }

        const totalRestored = draftSnapshot.size + cnSnapshot.size;
        if (totalRestored > 0) {
            console.log(`[State] Firestore에서 ${draftSnapshot.size}개 초안 + ${cnSnapshot.size}개 카드뉴스 복구`);
        }
    } catch (err) {
        console.error('[State] Firestore 상태 복구 실패:', err.message);
    }
}
