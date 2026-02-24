import { db } from './firebase.js';

const FORMATS_COLLECTION = 'bot_settings';
const FORMATS_DOC = 'formats';

function substituteVariables(text, variables) {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] !== undefined ? variables[key] : match;
    });
}

// 템플릿 변환용 기본 아티스트/이모지 목록
const ARTISTS = [
    "BLACKPINK", "aespa", "NewJeans", "IVE", "LE SSERAFIM",
    "TWICE", "ITZY", "Stray Kids", "ENHYPEN", "TXT",
    "(G)I-DLE", "NMIXX", "RIIZE", "BABYMONSTER", "ILLIT"
];
const EMOJIS = ["🔥", "✨", "💫", "🌟", "💜", "🖤", "💖", "⚡", "🎵", "👑"];

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * DB에서 플랫폼에 맞는 포맷 목록을 가져옵니다.
 */
export async function getFormats(platform = null) {
    if (!db) return [];

    try {
        const doc = await db.collection(FORMATS_COLLECTION).doc(FORMATS_DOC).get();
        if (!doc.exists) return [];

        let formats = doc.data().items || [];
        if (platform) {
            formats = formats.filter(f => f.platform === platform || f.platform === 'both');
        }
        return formats;
    } catch (err) {
        console.error('[FormatManager] 포맷 로드 실패:', err.message);
        return [];
    }
}

/**
 * 새로운 포맷을 DB에 추가합니다.
 */
export async function addFormat(platform, name, text) {
    if (!db) throw new Error("Firebase DB not initialized.");

    // id 생성 (fmt_ + timestamp)
    const newFormat = {
        id: `fmt_${Date.now()}`,
        platform,
        name,
        text,
        createdAt: new Date().toISOString()
    };

    const docRef = db.collection(FORMATS_COLLECTION).doc(FORMATS_DOC);
    const doc = await docRef.get();

    let items = [];
    if (doc.exists) {
        items = doc.data().items || [];
    }

    items.push(newFormat);
    await docRef.set({ items });

    return newFormat;
}

/**
 * 포맷을 삭제합니다.
 */
export async function deleteFormat(id) {
    if (!db) throw new Error("Firebase DB not initialized.");

    const docRef = db.collection(FORMATS_COLLECTION).doc(FORMATS_DOC);
    const doc = await docRef.get();

    if (!doc.exists) return false;

    let items = doc.data().items || [];
    const initialLength = items.length;
    items = items.filter(f => f.id !== id);

    if (items.length === initialLength) return false; // 삭제된 것 없음

    await docRef.set({ items });
    return true;
}

/**
 * 플랫폼별 랜덤 포맷을 선택하여 변수가 치환된 Draft 객체를 반환합니다.
 */
export async function getRandomFormatDraft(platform) {
    const formats = await getFormats(platform);

    if (formats.length === 0) {
        return null;
    }

    const format = pickRandom(formats);
    const artist = pickRandom(ARTISTS);
    const emoji = pickRandom(EMOJIS);
    const artistTag = artist.replace(/[^a-zA-Z0-9가-힣]/g, '_');

    const text = substituteVariables(format.text, {
        artist,
        emoji,
        artist_tag: artistTag,
    });

    return {
        text,
        category: format.name, // 포맷 이름을 카테고리처럼 사용
        type: format.id,
        platform: format.platform === 'both' ? platform : format.platform,
        artist
    };
}
