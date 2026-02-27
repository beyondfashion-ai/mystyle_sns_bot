/**
 * 중앙 설정 상수 모듈.
 * 여러 파일에 흩어진 매직 넘버와 설정값을 여기에 통합한다.
 */

// ===== 시간 상수 =====
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;         // UTC→KST 오프셋
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ===== Draft TTL =====
export const DRAFT_TTL_MS = 30 * 60 * 1000;               // 30분 (수동 초안)
export const SCHEDULED_DRAFT_TTL_MS = 72 * 60 * 60 * 1000; // 72시간 (D-2 예약 초안)

// ===== Rate Limit =====
export const X_HOURLY_LIMIT = 5;
export const X_DAILY_LIMIT = 30;

// ===== 이미지 생성 =====
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 10000;
export const IMAGE_GEN_MAX_RETRIES = 2;
export const IMAGE_GEN_RETRY_DELAY_MS = 3000;

// ===== Puppeteer =====
export const PUPPETEER_RENDER_TIMEOUT_MS = 30000;
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;

// ===== URL 검증 =====
export const URL_CHECK_TIMEOUT_MS = 10000;

// ===== Firestore 컬렉션 =====
export const COLLECTIONS = {
    DRAFTS: 'telegram_drafts',
    CARDNEWS: 'telegram_cardnews',
    BOT_SETTINGS: 'bot_settings',
    PENDING_POSTS: 'pending_sns_posts',
};

// ===== 환경변수 검증 =====
const REQUIRED_ENV = [
    { key: 'TELEGRAM_BOT_TOKEN', desc: '텔레그램 봇 제어' },
    { key: 'TELEGRAM_ADMIN_CHAT_ID', desc: '관리자 알림 수신' },
];

const OPTIONAL_ENV = [
    { key: 'FIREBASE_SERVICE_ACCOUNT_KEY_PATH', desc: 'Firestore 분석/포맷 저장' },
    { key: 'FAL_AI_KEY', desc: 'AI 이미지 생성 (fal.ai)' },
    { key: 'GEMINI_API_KEY', desc: 'AI 콘텐츠 생성 (Gemini)' },
    { key: 'ANTHROPIC_API_KEY', desc: 'AI 폴리싱 (Claude)' },
    { key: 'X_API_KEY', desc: 'X(Twitter) 게시' },
    { key: 'X_API_SECRET_KEY', desc: 'X(Twitter) 게시' },
    { key: 'X_ACCESS_TOKEN', desc: 'X(Twitter) 게시' },
    { key: 'X_ACCESS_TOKEN_SECRET', desc: 'X(Twitter) 게시' },
    { key: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', desc: 'Instagram 게시' },
    { key: 'INSTAGRAM_ACCESS_TOKEN', desc: 'Instagram 게시' },
];

/**
 * 환경변수를 검증한다.
 * 필수 변수 누락 시 process.exit(1), 선택 변수 누락 시 경고만 출력.
 */
export function validateEnv() {
    const missing = REQUIRED_ENV.filter(e => !process.env[e.key]);
    if (missing.length > 0) {
        console.error('[Config] 필수 환경변수가 누락되었습니다:');
        missing.forEach(e => console.error(`  - ${e.key}: ${e.desc}`));
        console.error('[Config] .env.local 파일을 확인하세요. (.env.example 참고)');
        process.exit(1);
    }

    const missingOptional = OPTIONAL_ENV.filter(e => !process.env[e.key]);
    if (missingOptional.length > 0) {
        console.warn('[Config] 선택 환경변수 누락 (해당 기능 비활성화):');
        missingOptional.forEach(e => console.warn(`  - ${e.key}: ${e.desc}`));
    }
}

/**
 * 특정 환경변수가 설정되어 있는지 확인한다.
 * @param {string} key
 * @returns {boolean}
 */
export function hasEnv(key) {
    return !!process.env[key];
}
