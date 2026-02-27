import { KST_OFFSET_MS } from './config.js';

/**
 * @typedef {object} Draft
 * @property {string} text - SNS 게시물 본문
 * @property {string} category - 포맷 키 (예: 'comeback_lookbook')
 * @property {string} type - 포맷 키 (category와 동일)
 * @property {'x'|'instagram'} platform - 게시 플랫폼
 * @property {string|null} imageUrl - Firebase Storage 이미지 URL
 * @property {string|null} artist - 아티스트명
 * @property {string|null} [imageDirection] - LLM 생성 이미지 프롬프트
 * @property {string} [slotKey] - 예약 슬롯 키 (예: "2026-02-28_x_10")
 * @property {number} [scheduledHour] - 예약 시간 (KST)
 * @property {string} [dateLabel] - 날짜 라벨 (예: "2/28(수)")
 */

/**
 * Draft 객체를 정규화한다.
 * 누락 필드를 기본값으로 채워 일관된 구조를 보장한다.
 *
 * @param {Partial<Draft>} raw
 * @returns {Draft}
 */
export function normalizeDraft(raw) {
    return {
        text: raw.text || '',
        category: raw.category || 'style_editorial',
        type: raw.type || raw.category || 'style_editorial',
        platform: raw.platform || 'x',
        imageUrl: raw.imageUrl || null,
        artist: raw.artist || null,
        imageDirection: raw.imageDirection || null,
        ...(raw.slotKey ? {
            slotKey: raw.slotKey,
            scheduledHour: raw.scheduledHour,
            dateLabel: raw.dateLabel || null,
        } : {}),
    };
}

/**
 * 외부 데이터를 LLM 프롬프트에 삽입하기 전 잠재적 인젝션을 방어한다.
 * 프롬프트 구분 마커(##, ---, ===)와 역할 전환 시도를 무력화한다.
 *
 * @param {string} text - 외부 데이터 (트렌드, 사용자 입력 등)
 * @param {number} [maxLength=2000] - 최대 길이 제한
 * @returns {string}
 */
export function sanitizeForPrompt(text, maxLength = 2000) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/^#{2,}\s/gm, '> ')           // ## 헤더 마커 무력화
        .replace(/^-{3,}$/gm, '...')            // --- 구분선 무력화
        .replace(/^={3,}$/gm, '...')            // === 구분선 무력화
        .replace(/\bsystem\s*:/gi, '[system]:') // "system:" 역할 전환 방지
        .slice(0, maxLength);
}

/**
 * UTC Date를 KST Date로 변환한다.
 * @param {Date} date
 * @returns {Date}
 */
export function toKST(date) {
    return new Date(date.getTime() + KST_OFFSET_MS);
}

/**
 * LLM 응답 텍스트에서 JSON을 추출하고 파싱한다.
 * ```json ... ``` 블록 또는 { ... } 패턴을 찾는다.
 *
 * @param {string} text - LLM 응답 원문
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function extractJSON(text) {
    if (!text || typeof text !== 'string') {
        return { ok: false, error: '입력 텍스트가 비어있거나 문자열이 아닙니다.' };
    }

    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
        return { ok: false, error: 'JSON 패턴을 찾을 수 없습니다.' };
    }

    try {
        const data = JSON.parse(jsonMatch[1]);
        return { ok: true, data };
    } catch (err) {
        return { ok: false, error: `JSON 파싱 실패: ${err.message}` };
    }
}
