/**
 * 콘텐츠 캘린더 모듈
 *
 * content_calendar_plan.md의 10포맷×7일 편성표를 코드로 구현하여
 * 스케줄러가 요일/시간대에 맞는 포맷을 자동으로 선택하도록 한다.
 *
 * X: 10:00, 15:00, 20:00 KST
 * IG: 12:00, 18:00 KST
 */

// 요일별 X 포맷 편성표 (content_calendar_plan.md 기반)
// 0=일요일, 1=월요일, ..., 6=토요일
const X_CALENDAR = {
    0: { // 일요일
        10: 'airport_fashion',
        15: 'retro_remake',
        20: 'festival_look',
    },
    1: { // 월요일
        10: 'virtual_influencer_ootd',
        15: 'highfashion_tribute',
        20: 'comeback_lookbook',
    },
    2: { // 화요일
        10: 'airport_fashion',
        15: 'street_snap',
        20: 'weekly_trend',
    },
    3: { // 수요일
        10: 'seasonal_curation',
        15: 'archetype_battle',
        20: 'retro_remake',
    },
    4: { // 목요일
        10: 'street_snap',
        15: 'festival_look',
        20: 'airport_fashion',
    },
    5: { // 금요일
        10: 'virtual_influencer_ootd',
        15: 'highfashion_tribute',
        20: 'comeback_lookbook',
    },
    6: { // 토요일
        10: 'seasonal_curation',
        15: 'weekly_trend',
        20: 'archetype_battle',
    },
};

// 요일별 IG 포맷 편성표
// IG는 비주얼 중심이므로 이미지가 강한 포맷을 배치
const IG_CALENDAR = {
    0: { 12: 'style_editorial', 18: 'vibe_alike' },
    1: { 12: 'comeback_lookbook', 18: 'highfashion_tribute' },
    2: { 12: 'airport_fashion', 18: 'weekly_trend' },
    3: { 12: 'stage_look', 18: 'retro_remake' },
    4: { 12: 'festival_look', 18: 'street_snap' },
    5: { 12: 'style_editorial', 18: 'comeback_lookbook' },
    6: { 12: 'vibe_alike', 18: 'seasonal_curation' },
};

/**
 * 현재 KST 시각 기준으로 X 포맷을 반환한다.
 * @param {Date} [now] - 기준 시각 (테스트용, 미지정 시 현재)
 * @returns {string} formatKey
 */
export function getXFormatForNow(now) {
    const kst = toKST(now || new Date());
    const day = kst.getDay();
    const hour = kst.getHours();

    const daySchedule = X_CALENDAR[day];
    if (!daySchedule) return 'style_editorial'; // fallback

    // 가장 가까운 시간대 매칭
    const hours = Object.keys(daySchedule).map(Number).sort((a, b) => a - b);
    let matched = hours[0];
    for (const h of hours) {
        if (hour >= h) matched = h;
    }

    return daySchedule[matched] || 'style_editorial';
}

/**
 * 현재 KST 시각 기준으로 IG 포맷을 반환한다.
 * @param {Date} [now] - 기준 시각 (테스트용, 미지정 시 현재)
 * @returns {string} formatKey
 */
export function getIGFormatForNow(now) {
    const kst = toKST(now || new Date());
    const day = kst.getDay();
    const hour = kst.getHours();

    const daySchedule = IG_CALENDAR[day];
    if (!daySchedule) return 'style_editorial';

    const hours = Object.keys(daySchedule).map(Number).sort((a, b) => a - b);
    let matched = hours[0];
    for (const h of hours) {
        if (hour >= h) matched = h;
    }

    return daySchedule[matched] || 'style_editorial';
}

/**
 * 지정된 요일/시간의 편성 정보를 반환한다.
 * @param {string} platform - 'x' | 'instagram'
 * @param {number} dayOfWeek - 0(일)~6(토)
 * @param {number} hour - 시간 (10, 12, 15, 18, 20)
 * @returns {string|null} formatKey
 */
export function getScheduledFormat(platform, dayOfWeek, hour) {
    const calendar = platform === 'instagram' ? IG_CALENDAR : X_CALENDAR;
    const daySchedule = calendar[dayOfWeek];
    if (!daySchedule) return null;
    return daySchedule[hour] || null;
}

/**
 * 오늘의 전체 편성표를 반환한다 (텔레그램 표시용).
 * @param {Date} [now]
 * @returns {{ x: Array<{hour: number, format: string}>, ig: Array<{hour: number, format: string}> }}
 */
export function getTodaySchedule(now) {
    const kst = toKST(now || new Date());
    const day = kst.getDay();

    const xSchedule = X_CALENDAR[day] || {};
    const igSchedule = IG_CALENDAR[day] || {};

    return {
        x: Object.entries(xSchedule).map(([h, f]) => ({ hour: Number(h), format: f })),
        ig: Object.entries(igSchedule).map(([h, f]) => ({ hour: Number(h), format: f })),
    };
}

/**
 * 포맷 키를 한글 이름으로 변환한다.
 */
const FORMAT_NAMES = {
    comeback_lookbook: '컴백 예측 룩북',
    airport_fashion: '공항 패션 재해석',
    weekly_trend: '이주의 트렌드 믹스',
    street_snap: '스트릿 스냅 & 긱시크',
    archetype_battle: '아키타입 배틀',
    highfashion_tribute: '하이패션 헌정',
    retro_remake: '레트로 리메이크',
    festival_look: '페스티벌 룩',
    seasonal_curation: '계절 큐레이션',
    virtual_influencer_ootd: '가상 에디터 OOTD',
    style_editorial: '스타일 에디토리얼',
    vibe_alike: 'Vibe-Alike 화보',
    stage_look: '무대 패션 분석',
    mv_analysis: 'MV 패션 분석',
    fan_discussion: '팬 오픈 토크',
};

export function getFormatName(formatKey) {
    return FORMAT_NAMES[formatKey] || formatKey;
}

/**
 * 요일 번호를 한글로 변환
 */
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function getDayName(dayOfWeek) {
    return DAY_NAMES[dayOfWeek] || '';
}

/**
 * UTC Date → KST Date 변환 헬퍼
 */
function toKST(date) {
    const offset = 9 * 60 * 60 * 1000; // KST = UTC+9
    return new Date(date.getTime() + offset);
}
