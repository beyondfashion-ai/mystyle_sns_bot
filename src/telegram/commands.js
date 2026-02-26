import { getRandomDraft, getTemplateList } from '../templates.js';
import { getRateLimitStatus } from '../bot.js';
import { generateImageForDraft } from '../imageGen.js';
import { getTrendWeightsPrompt } from '../trendAnalyzer.js';
import { getExternalTrendPrompt } from '../trendScraper.js';
import { addFormat, getFormats, deleteFormat, getRandomFormatDraft } from '../formatManager.js';
import { brainstormFormat } from '../aiBrainstorm.js';
import { runAnalyticsWithReport } from '../analytics.js';
import { getEditorialDirectionPrompt } from '../editorialEvolution.js';
import { generateSNSContent } from '../contentGenerator.js';
import { getXFormatForNow, getIGFormatForNow, getTodaySchedule, getFormatName, getDayName } from '../contentCalendar.js';

import { db } from '../firebase.js';

import { MAIN_MENU_KEYBOARD, CN_TYPE_KEYBOARD } from './keyboards.js';
import { createIsAdmin, sendDraftPreview } from './helpers.js';
import { isSchedulerPaused, pauseScheduler, resumeScheduler } from './schedulerControl.js';

/**
 * 모든 명령어 핸들러를 등록한다.
 * @returns 콜백 라우팅에 필요한 핸들러 참조 객체
 */
export function registerCommands(bot, adminChatId) {
    const isAdmin = createIsAdmin(adminChatId);

    // /start - 봇 소개 + 메인 메뉴 버튼
    bot.onText(/\/start/, (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const schedule = getTodaySchedule();
        const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const dayName = getDayName(kstNow.getDay());

        const nextX = schedule.x.find(s => s.hour > kstNow.getHours());
        const nextIG = schedule.ig.find(s => s.hour > kstNow.getHours());
        const nextInfo = [];
        if (nextX) nextInfo.push(`X ${nextX.hour}:00 — ${getFormatName(nextX.format)}`);
        if (nextIG) nextInfo.push(`IG ${nextIG.hour}:00 — ${getFormatName(nextIG.format)}`);

        const welcome = [
            '🤖 *mystyleKPOP SNS Bot*',
            '',
            `📅 오늘 (${dayName}요일) 편성:`,
            ...schedule.x.map(s => `  X ${s.hour}:00 — ${getFormatName(s.format)}`),
            ...schedule.ig.map(s => `  IG ${s.hour}:00 — ${getFormatName(s.format)}`),
            '',
            nextInfo.length > 0 ? `⏰ 다음 예정: ${nextInfo[0]}` : '',
            '',
            '📋 *운영 흐름:*',
            '  9:00 — 하루 초안 일괄 생성 → 검수 요청',
            '  승인 → 예약 시간에 자동 게시',
            '  거부 → 새 초안 자동 재생성',
        ].filter(Boolean).join('\n');

        bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD });
    });

    // /dx - X 초안 생성 (Hybrid LLM 파이프라인)
    async function handleDx(msg, formatOverride) {
        if (!isAdmin(msg.chat.id)) return;

        const formatKey = formatOverride || getXFormatForNow();
        const formatName = getFormatName(formatKey);

        await bot.sendMessage(msg.chat.id, `🤖 X 초안 생성 중... (포맷: ${formatName})\nGemini→Claude 파이프라인 실행 중`);

        let draft = await generateSNSContent({ platform: 'x', formatKey });

        // Fallback: LLM 실패 시 기존 방식
        if (!draft) {
            draft = await getRandomFormatDraft('x');
            if (!draft) draft = getRandomDraft();

            if (!draft) {
                bot.sendMessage(msg.chat.id, '❌ 초안을 생성할 수 없습니다.');
                return;
            }

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
                await bot.sendMessage(msg.chat.id, '🎨 이미지 생성 중...');
                draft.imageUrl = await generateImageForDraft(draft);
            } catch (err) {
                console.error('[Telegram] X 이미지 생성 실패:', err.message);
                await bot.sendMessage(msg.chat.id, `⚠️ 이미지 생성 실패 (텍스트만 초안): ${err.message}`);
            }
        }

        await sendDraftPreview(bot, msg.chat.id, draft);
    }
    bot.onText(/\/dx/, (msg) => handleDx(msg));

    // /di - IG 초안 생성 (Hybrid LLM 파이프라인 + 이미지 필수)
    async function handleDi(msg, formatOverride) {
        if (!isAdmin(msg.chat.id)) return;

        const formatKey = formatOverride || getIGFormatForNow();
        const formatName = getFormatName(formatKey);

        await bot.sendMessage(msg.chat.id, `🤖 IG 화보 생성 중... (포맷: ${formatName})\nGemini→Claude 파이프라인 실행 중`);

        let draft = await generateSNSContent({ platform: 'instagram', formatKey });

        // Fallback
        if (!draft) {
            draft = await getRandomFormatDraft('instagram');
            if (!draft) draft = getRandomDraft(['editorial', 'fashion_report']);

            if (!draft) {
                bot.sendMessage(msg.chat.id, '❌ 초안을 생성할 수 없습니다.');
                return;
            }

            const editorialPrompt = await getEditorialDirectionPrompt();
            const trendPrompt = await getTrendWeightsPrompt();
            const externalPrompt = await getExternalTrendPrompt();
            const prompts = [editorialPrompt, trendPrompt, externalPrompt].filter(Boolean).join('\n');
            if (prompts) {
                draft.text = `${prompts}\n\n${draft.text}`;
            }
        }

        draft.platform = 'instagram';

        // IG는 이미지 필수
        try {
            await bot.sendMessage(msg.chat.id, '🎨 이미지 생성 중...');
            draft.imageUrl = await generateImageForDraft(draft);
        } catch (err) {
            console.error('[Telegram] IG 이미지 생성 실패:', err.message);
            await bot.sendMessage(msg.chat.id, `❌ IG는 이미지가 필수입니다. 이미지 생성 실패: ${err.message}`);
            return;
        }

        if (!draft.imageUrl) {
            await bot.sendMessage(msg.chat.id, '❌ IG는 이미지가 필수입니다. 이미지 생성에 실패했습니다.');
            return;
        }

        await sendDraftPreview(bot, msg.chat.id, draft);
    }
    bot.onText(/\/di/, (msg) => handleDi(msg));

    // /cn - 카드뉴스 생성
    async function handleCn(msg) {
        if (!isAdmin(msg.chat.id)) return;
        await bot.sendMessage(msg.chat.id, '📰 카드뉴스 타입을 선택하세요:', {
            reply_markup: CN_TYPE_KEYBOARD,
        });
    }
    bot.onText(/\/cn/, handleCn);

    // /post <텍스트> - X 직접 작성
    bot.onText(/\/post (.+)/s, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const text = match[1].trim();
        const draft = { text, category: 'custom', type: 'custom', platform: 'x', imageUrl: null };
        await sendDraftPreview(bot, msg.chat.id, draft);
    });

    // /status - rate limit 현황
    async function handleStatus(msg) {
        if (!isAdmin(msg.chat.id)) return;

        const status = getRateLimitStatus();
        const statusText = [
            '📊 *게시 현황*',
            '',
            `⏰ 시간당: ${status.hourlyCount}/${status.hourlyLimit}`,
            `📅 일일: ${status.dailyCount}/${status.dailyLimit}`,
            '',
            `⏳ 시간당 리셋: ${status.hourlyResetIn}`,
            `⏳ 일일 리셋: ${status.dailyResetIn}`,
        ].join('\n');

        bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
    }
    bot.onText(/\/status/, handleStatus);

    // /templates - 하드코딩된 템플릿 목록 (레거시)
    bot.onText(/\/templates/, async (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const list = getTemplateList();
        const lines = ['📋 *기본 템플릿 (JSON)*', ''];
        for (const [cat, count] of Object.entries(list)) {
            lines.push(`• ${cat}: ${count}개`);
        }
        bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    });

    // /addformat <platform> <name> \n <text>
    bot.onText(/\/addformat (\w+) ([^\n]+)\n([\s\S]+)/, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const platform = match[1].toLowerCase();
        const name = match[2].trim();
        const text = match[3].trim();

        if (!['x', 'instagram', 'both'].includes(platform)) {
            bot.sendMessage(msg.chat.id, '❌ 플랫폼은 x, instagram, both 중 하나여야 합니다. 예: `/addformat x 컴백포맷`', { parse_mode: 'Markdown' });
            return;
        }

        try {
            const added = await addFormat(platform, name, text);
            bot.sendMessage(msg.chat.id, `✅ 새로운 DB 포맷이 추가되었습니다!\nID: \`${added.id}\`\nName: ${added.name}`, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(msg.chat.id, `❌ 추가 실패: ${err.message}`);
        }
    });

    // /listformat
    async function handleListFormat(msg) {
        if (!isAdmin(msg.chat.id)) return;
        try {
            const formats = await getFormats();
            if (formats.length === 0) {
                bot.sendMessage(msg.chat.id, '📁 현재 등록된 DB 포맷이 없습니다. 기본 JSON 템플릿으로 떨어집니다.');
                return;
            }

            const lines = ['📋 *DB 동적 포맷 목록*\n'];
            formats.forEach((f) => {
                lines.push(`• *[${f.platform}]* ${f.name} (\`${f.id}\`)`);
            });
            bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(msg.chat.id, `❌ 오류: ${err.message}`);
        }
    }
    bot.onText(/\/listformat/, handleListFormat);

    // /delformat <id>
    bot.onText(/\/delformat (.+)/, async (msg, match) => {
        if (!isAdmin(msg.chat.id)) return;
        const id = match[1].trim();
        try {
            const success = await deleteFormat(id);
            if (success) {
                bot.sendMessage(msg.chat.id, `✅ 포맷 (\`${id}\`)이(가) 삭제되었습니다.`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(msg.chat.id, `❌ 해당 ID(\`${id}\`)의 포맷을 찾을 수 없습니다.`, { parse_mode: 'Markdown' });
            }
        } catch (err) {
            bot.sendMessage(msg.chat.id, `❌ 오류: ${err.message}`);
        }
    });

    // /askai <요청사항> - AI 포맷 브레인스토밍
    async function handleAskAi(msg, match) {
        if (!isAdmin(msg.chat.id)) return;

        const requestText = match ? match[1]?.trim() : null;

        if (!requestText) {
            await bot.sendMessage(msg.chat.id, '🤖 AI에게 기획 아이디어를 물어보려면 텍스트와 함께 입력해주세요.\n\n예시:\n`/askai 뉴진스 컴백인데 Y2K 룩 기획해줘`', { parse_mode: 'Markdown' });
            return;
        }

        await bot.sendMessage(msg.chat.id, '🤖 AI 에디터가 기획을 고민 중입니다... \n(이 결과물을 바로 적용하려면 `/addformat` 명령어를 쓰세요)');

        try {
            const result = await brainstormFormat('Both(통합)', requestText);
            bot.sendMessage(msg.chat.id, result, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(msg.chat.id, `❌ AI 요청 실패: ${err.message}`);
        }
    }
    bot.onText(/\/askai(?:\s+(.+))?/s, handleAskAi);

    // /schedule - 오늘 편성표 보기
    async function handleSchedule(msg) {
        if (!isAdmin(msg.chat.id)) return;
        const schedule = getTodaySchedule();
        const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const dayName = getDayName(kstNow.getDay());
        const currentHour = kstNow.getHours();

        const lines = [
            `📅 *오늘 (${dayName}요일) 콘텐츠 편성표*`,
            '',
            '*X (Twitter):*',
            ...schedule.x.map(s => {
                const marker = s.hour <= currentHour ? '✅' : '⏳';
                return `  ${marker} ${s.hour}:00 — ${getFormatName(s.format)}`;
            }),
            '',
            '*Instagram:*',
            ...schedule.ig.map(s => {
                const marker = s.hour <= currentHour ? '✅' : '⏳';
                return `  ${marker} ${s.hour}:00 — ${getFormatName(s.format)}`;
            }),
        ];
        bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    }
    bot.onText(/\/schedule/, handleSchedule);

    // /report - 주간 성과 리포트
    async function handleReport(msg) {
        if (!isAdmin(msg.chat.id)) return;

        await bot.sendMessage(msg.chat.id, '📊 주간 성과 리포트를 생성하는 중...');

        try {
            const report = await runAnalyticsWithReport();
            await bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
        } catch (err) {
            await bot.sendMessage(msg.chat.id, `❌ 리포트 생성 실패: ${err.message}`);
        }
    }
    bot.onText(/\/report/, handleReport);

    // /help - 전체 명령어 안내
    bot.onText(/\/help/, (msg) => {
        if (!isAdmin(msg.chat.id)) return;

        const helpText = [
            '📖 *mystyleKPOP Bot 명령어 가이드*',
            '',
            '*콘텐츠 생성:*',
            '  /dx — X(Twitter) 초안 생성 (Hybrid LLM)',
            '  /di — Instagram 화보 생성 (이미지 포함)',
            '  /cn — 카드뉴스 스튜디오',
            '  /post <텍스트> — X 직접 작성',
            '',
            '*AI & 기획:*',
            '  /askai <요청> — AI 에디터와 기획 브레인스토밍',
            '',
            '*포맷 관리:*',
            '  /listformat — DB 동적 포맷 목록',
            '  /addformat <플랫폼> <이름> — 새 포맷 추가',
            '  /delformat <ID> — 포맷 삭제',
            '  /templates — 기본 JSON 템플릿 목록',
            '',
            '*모니터링:*',
            '  /status — API 호출 현황 (rate limit)',
            '  /report — 주간 성과 리포트',
            '  /schedule — 오늘 콘텐츠 편성표',
            '  /scheduler — 스케줄러 관리 (일시정지/재개)',
            '  /history — 최근 초안 이력',
            '',
            '*기타:*',
            '  /start — 메인 메뉴',
            '  /help — 이 도움말',
            '',
            '*자동 운영 흐름:*',
            '  매일 9:00 → 하루 초안 일괄 생성 → 검수',
            '  승인 → 예약 시간에 자동 게시',
            '  거부 → 새 초안 자동 재생성',
            '',
            '💡 수동 초안(/dx, /di)은 승인 즉시 게시됩니다.',
            '🔗 수동 초안에 이미지가 있으면 X+IG 동시 게시도 가능합니다.',
        ].join('\n');

        bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
    });

    // /scheduler - 스케줄러 관리
    const SCHEDULER_KEYBOARD = {
        inline_keyboard: [
            [
                { text: '⏸️ 일시정지', callback_data: 'scheduler_pause' },
                { text: '▶️ 재개', callback_data: 'scheduler_resume' },
            ],
            [
                { text: '📋 다음 예정 작업', callback_data: 'scheduler_next' },
            ],
        ],
    };

    async function handleScheduler(msg) {
        if (!isAdmin(msg.chat.id)) return;
        const paused = isSchedulerPaused();
        const statusEmoji = paused ? '⏸️' : '▶️';
        const statusText = paused ? '일시정지 중' : '실행 중';

        await bot.sendMessage(msg.chat.id, `${statusEmoji} *스케줄러 상태:* ${statusText}\n\n에디토리얼 진화 작업은 일시정지와 무관하게 항상 실행됩니다.`, {
            parse_mode: 'Markdown',
            reply_markup: SCHEDULER_KEYBOARD,
        });
    }
    bot.onText(/\/scheduler/, handleScheduler);

    // /history - 초안 이력 조회
    const HISTORY_KEYBOARD = {
        inline_keyboard: [
            [
                { text: '✅ 최근 승인 5건', callback_data: 'history_approved' },
                { text: '❌ 최근 거부 5건', callback_data: 'history_rejected' },
            ],
        ],
    };

    async function handleHistory(msg) {
        if (!isAdmin(msg.chat.id)) return;

        if (!db) {
            await bot.sendMessage(msg.chat.id, '⚠️ Firestore 미연결. 이력 조회가 불가합니다.');
            return;
        }

        await bot.sendMessage(msg.chat.id, '📜 *초안 이력 조회*\n조회할 항목을 선택하세요:', {
            parse_mode: 'Markdown',
            reply_markup: HISTORY_KEYBOARD,
        });
    }
    bot.onText(/\/history/, handleHistory);

    // 콜백 라우팅에 필요한 핸들러 참조 반환
    return {
        handleDx,
        handleDi,
        handleCn,
        handleStatus,
        handleListFormat,
        handleReport,
        handleAskAi,
        handleSchedule,
        handleScheduler,
        handleHistory,
    };
}
