// ===== 인라인 키보드 정의 =====

// X 전용 (이미지 없는 경우)
export const X_DRAFT_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '✅ X 게시', callback_data: 'approve_x' },
            { text: '✏️ 수정', callback_data: 'edit' },
        ],
        [
            { text: '🔄 다시 생성', callback_data: 'regenerate_x' },
            { text: '❌ 거부', callback_data: 'reject' },
        ],
    ],
};

// IG 전용 (레거시 호환, 이미지 없이 IG 도달 시)
export const IG_DRAFT_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '✅ IG 게시', callback_data: 'approve_ig' },
            { text: '✏️ 수정', callback_data: 'edit' },
        ],
        [
            { text: '🖼️ 이미지 재생성', callback_data: 'regenerate_image' },
            { text: '🔄 다시 생성', callback_data: 'regenerate_ig' },
        ],
        [
            { text: '❌ 거부', callback_data: 'reject' },
        ],
    ],
};

// 크로스포스팅 (이미지 있는 초안 — X+IG 동시 가능)
export const CROSS_POST_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '✅ X 게시', callback_data: 'approve_x' },
            { text: '✅ IG 게시', callback_data: 'approve_ig' },
            { text: '✅ X+IG 동시', callback_data: 'approve_both' },
        ],
        [
            { text: '✏️ 수정', callback_data: 'edit' },
            { text: '🔄 다시 생성', callback_data: 'regenerate_x' },
        ],
        [
            { text: '🖼️ 이미지 재생성', callback_data: 'regenerate_image' },
            { text: '❌ 거부', callback_data: 'reject' },
        ],
    ],
};

// 카드뉴스 승인 키보드
export function makeCnKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '✅ X 스레드 게시', callback_data: 'approve_cn_x' },
                { text: '✅ IG 캐러셀 게시', callback_data: 'approve_cn_ig' },
            ],
            [
                { text: '🔄 다시 생성', callback_data: 'regenerate_cn' },
                { text: '❌ 거부', callback_data: 'reject' },
            ],
        ],
    };
}

// 카드뉴스 타입 선택
export const CN_TYPE_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '📊 트렌드 TOP 5', callback_data: 'cn_type_trend_top5' },
        ],
        [
            { text: '📸 룩북 분석', callback_data: 'cn_type_lookbook' },
        ],
        [
            { text: '👗 스타일 팁', callback_data: 'cn_type_style_tip' },
        ],
    ],
};

// 메인 메뉴 키보드
export const MAIN_MENU_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '📝 X 초안 생성', callback_data: 'menu_dx' },
            { text: '📸 IG 화보 생성', callback_data: 'menu_di' },
        ],
        [
            { text: '📰 카드뉴스 제작', callback_data: 'menu_cn' },
            { text: '🤖 AI 기획 회의', callback_data: 'menu_askai' },
        ],
        [
            { text: '📊 시스템 현황', callback_data: 'menu_status' },
            { text: '📈 주간 리포트', callback_data: 'menu_report' },
        ],
        [
            { text: '📋 포맷 관리', callback_data: 'menu_listformat' },
            { text: '📅 오늘 편성표', callback_data: 'menu_schedule' },
        ],
        [
            { text: '⏰ 스케줄러 관리', callback_data: 'menu_scheduler' },
            { text: '📜 초안 이력', callback_data: 'menu_history' },
        ],
    ],
};

/**
 * 초안의 이미지 유무에 따라 적절한 키보드 반환
 */
export function getDraftKeyboard(draft) {
    if (draft.imageUrl) {
        return CROSS_POST_KEYBOARD;
    }
    if (draft.platform === 'instagram') {
        return IG_DRAFT_KEYBOARD;
    }
    return X_DRAFT_KEYBOARD;
}

/**
 * 초안 미리보기 텍스트 포맷팅
 */
export function formatDraftPreview(draft, prefix = '') {
    const platformLabel = draft.platform === 'instagram' ? '[IG]' : '[X]';
    const imageLabel = draft.imageUrl ? '🖼️ 이미지 포함' : '📝 텍스트만';
    return `📝 *${prefix}${platformLabel} 초안 미리보기* ${imageLabel}\n\n${draft.text}\n\n---\n📁 카테고리: \`${draft.category}\`\n🏷️ 타입: \`${draft.type || 'custom'}\``;
}
