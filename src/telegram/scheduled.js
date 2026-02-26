import { getRandomDraft } from '../templates.js';
import { generateImageForDraft } from '../imageGen.js';
import { getTrendWeightsPrompt } from '../trendAnalyzer.js';
import { getExternalTrendPrompt } from '../trendScraper.js';
import { getRandomFormatDraft } from '../formatManager.js';
import { getEditorialDirectionPrompt } from '../editorialEvolution.js';
import { generateSNSContent } from '../contentGenerator.js';
import { getXFormatForNow, getIGFormatForNow, getFormatName } from '../contentCalendar.js';

import { pendingDrafts } from './state.js';
import { getDraftKeyboard, formatDraftPreview } from './keyboards.js';

/**
 * X 자동 초안 생성 (스케줄러에서 호출, Hybrid LLM 파이프라인 사용)
 * @param {object} bot - 텔레그램 봇 인스턴스
 * @param {string} [formatKey] - 콘텐츠 캘린더 포맷 키 (미지정 시 현재 시간 기반 자동 선택)
 */
export async function sendScheduledDraftX(bot, formatKey) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    formatKey = formatKey || getXFormatForNow();
    const formatName = getFormatName(formatKey);

    // Step 1: Hybrid LLM으로 콘텐츠 생성 시도
    let draft = await generateSNSContent({ platform: 'x', formatKey });

    // Fallback: LLM 실패 시 기존 방식
    if (!draft) {
        draft = await getRandomFormatDraft('x');
        if (!draft) draft = getRandomDraft();
        if (!draft) return;

        const editorialPrompt = await getEditorialDirectionPrompt();
        const trendPrompt = await getTrendWeightsPrompt();
        const externalPrompt = await getExternalTrendPrompt();
        const prompts = [editorialPrompt, trendPrompt, externalPrompt].filter(Boolean).join('\n');
        if (prompts) {
            draft.text = `${prompts}\n\n${draft.text}`;
        }
    }

    draft.platform = 'x';
    draft.imageUrl = null;

    // 이미지 생성 (fan_discussion 제외)
    const noImageFormats = ['fan_discussion'];
    if (!noImageFormats.includes(formatKey)) {
        try {
            draft.imageUrl = await generateImageForDraft(draft);
        } catch (err) {
            console.error('[Scheduler] X 이미지 생성 실패:', err.message);
        }
    }

    const preview = formatDraftPreview(draft, `[자동:${formatName}] `);
    const keyboard = getDraftKeyboard(draft);

    let sent;
    if (draft.imageUrl) {
        const caption = preview.length > 1024 ? preview.substring(0, 1021) + '...' : preview;
        sent = await bot.sendPhoto(adminChatId, draft.imageUrl, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    } else {
        sent = await bot.sendMessage(adminChatId, preview, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    }
    pendingDrafts.set(sent.message_id, draft);
}

/**
 * IG 자동 초안 생성 (스케줄러에서 호출, Hybrid LLM 파이프라인 사용, 항상 이미지 포함)
 * @param {object} bot - 텔레그램 봇 인스턴스
 * @param {string} [formatKey] - 콘텐츠 캘린더 포맷 키 (미지정 시 현재 시간 기반 자동 선택)
 */
export async function sendScheduledDraftIG(bot, formatKey) {
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!bot || !adminChatId) return;

    formatKey = formatKey || getIGFormatForNow();
    const formatName = getFormatName(formatKey);

    // Step 1: Hybrid LLM으로 콘텐츠 생성 시도
    let draft = await generateSNSContent({ platform: 'instagram', formatKey });

    // Fallback: LLM 실패 시 기존 방식
    if (!draft) {
        draft = await getRandomFormatDraft('instagram');
        if (!draft) draft = getRandomDraft(['editorial', 'fashion_report']);
        if (!draft) return;

        const editorialPrompt = await getEditorialDirectionPrompt();
        const trendPrompt = await getTrendWeightsPrompt();
        const externalPrompt = await getExternalTrendPrompt();
        const prompts = [editorialPrompt, trendPrompt, externalPrompt].filter(Boolean).join('\n');
        if (prompts) {
            draft.text = `${prompts}\n\n${draft.text}`;
        }
    }

    draft.platform = 'instagram';

    try {
        draft.imageUrl = await generateImageForDraft(draft);
    } catch (err) {
        console.error('[Scheduler] IG 이미지 생성 실패:', err.message);
        return; // IG는 이미지 필수이므로 중단
    }

    if (!draft.imageUrl) return;

    const preview = formatDraftPreview(draft, `[자동:${formatName}] `);
    const caption = preview.length > 1024 ? preview.substring(0, 1021) + '...' : preview;
    const keyboard = getDraftKeyboard(draft);

    const sent = await bot.sendPhoto(adminChatId, draft.imageUrl, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
    });
    pendingDrafts.set(sent.message_id, draft);
}

/**
 * 하위 호환성: 기존 sendScheduledDraft → X 초안으로 동작
 */
export async function sendScheduledDraft(bot) {
    return sendScheduledDraftX(bot);
}
