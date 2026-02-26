// ===== 중앙 에러 알림 모듈 =====

let botInstance = null;
let adminChatId = null;

// 연속 실패 추적
const errorCounts = new Map(); // jobName -> consecutive failure count
const CONSECUTIVE_THRESHOLD = 3;

/**
 * 에러 알림 모듈 초기화
 */
export function initErrorNotifier(bot, chatId) {
    botInstance = bot;
    adminChatId = chatId;
}

/**
 * 관리자에게 에러 알림 전송
 * @param {string} source - 에러 발생 소스 (예: 'imageGen', 'scheduler:X_10:00')
 * @param {Error|string} error - 에러 객체 또는 메시지
 * @param {object} options
 * @param {'warning'|'critical'} options.severity - 심각도
 * @param {string} [options.jobName] - 연속 실패 추적용 작업 이름
 */
export async function notifyError(source, error, { severity = 'warning', jobName = null } = {}) {
    if (!botInstance || !adminChatId) return;

    // 연속 실패 추적
    if (jobName) {
        const count = (errorCounts.get(jobName) || 0) + 1;
        errorCounts.set(jobName, count);

        if (count >= CONSECUTIVE_THRESHOLD) {
            severity = 'critical';
        }
    }

    const emoji = severity === 'critical' ? '🚨' : '⚠️';
    const label = severity === 'critical' ? '긴급 에러' : '에러 알림';
    const countInfo = jobName && errorCounts.get(jobName) > 1
        ? ` (연속 ${errorCounts.get(jobName)}회)`
        : '';

    const errorMsg = error instanceof Error ? error.message : String(error);
    const kstTime = new Date(Date.now() + 9 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').substring(0, 19);

    const msg = [
        `${emoji} *${label}${countInfo}*`,
        `📍 Source: \`${source}\``,
        `💬 ${errorMsg}`,
        `🕐 ${kstTime} KST`,
    ].join('\n');

    try {
        await botInstance.sendMessage(adminChatId, msg, { parse_mode: 'Markdown' });
    } catch (sendErr) {
        console.error('[ErrorNotifier] 알림 전송 실패:', sendErr.message);
    }
}

/**
 * 작업 성공 시 연속 실패 카운트 초기화
 */
export function resetErrorCount(jobName) {
    errorCounts.delete(jobName);
}
