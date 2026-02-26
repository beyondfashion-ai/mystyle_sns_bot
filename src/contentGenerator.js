import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getEditorialDirectionPrompt } from './editorialEvolution.js';
import { getTrendWeightsPrompt } from './trendAnalyzer.js';
import { getExternalTrendPrompt } from './trendScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 전략서와 SOP 문서를 로드하여 AI 컨텍스트로 사용한다.
 */
function loadStrategyContext() {
    const docsDir = join(__dirname, '..', 'docs');
    const files = [
        { path: join(docsDir, 'brand_strategy.md'), label: '브랜딩 전략' },
        { path: join(docsDir, 'editorial_strategy.md'), label: '에디토리얼 전략' },
        { path: join(docsDir, 'sop', 'editor_sop.md'), label: '에디터 SOP' },
        { path: join(docsDir, 'sop', 'content_marketer_sop.md'), label: '콘텐츠 마케터 SOP' },
    ];

    const sections = [];
    for (const { path, label } of files) {
        if (existsSync(path)) {
            const content = readFileSync(path, 'utf-8');
            sections.push(`=== ${label} ===\n${content}`);
        }
    }
    return sections.join('\n\n');
}

// 포맷별 프롬프트 지시문 (content_calendar_plan.md 10포맷 기반)
const FORMAT_DIRECTIVES = {
    comeback_lookbook: {
        name: '에디터의 컴백 예측 룩북',
        directive: '곧 컴백하는 아이돌의 다음 무대의상을 AI로 픽션화하여 미리 입혀보는 기획. 실명 태그 + Vibe-Alike 가상 모델.',
    },
    airport_fashion: {
        name: '공항 패션 재해석',
        directive: '최근 팬덤 사이에서 화제가 된 공항/사복 패션을 AI 시각으로 더 과감하게 리믹스.',
    },
    weekly_trend: {
        name: '이주의 핫 트렌드 믹스',
        directive: '반응이 좋았던 아키타입과 스타일 키워드를 갈아넣은 매거진 표지 느낌의 스페셜 화보.',
    },
    street_snap: {
        name: '스트릿 스냅 & 긱시크',
        directive: '일상 속에서 덕력과 힙함을 동시에 뽐낼 수 있는 스트릿 패션 스냅샷.',
    },
    archetype_battle: {
        name: '걸그룹 멤버별 아키타입 열전',
        directive: '한 가지 테마를 "막내 아키타입" vs "걸크러시 아키타입"으로 비교하는 투표 유도형 포스트.',
    },
    highfashion_tribute: {
        name: '하이패션 브랜드 헌정',
        directive: 'K-POP 아이돌이 앰버서더로 활동하는 명품 브랜드의 컬렉션을 AI로 재해석.',
    },
    retro_remake: {
        name: '과거 전설의 무대 리메이크',
        directive: '2~3세대 전설적인 무대의상을 2026년 스타일로 리메이크. 향수를 자극하는 레트로 리바이벌.',
    },
    festival_look: {
        name: '글로벌 페스티벌 룩',
        directive: '코첼라, 롤라팔루자 등 대형 음악 페스티벌 무대에 서는 아티스트를 상상한 자유분방한 룩.',
    },
    seasonal_curation: {
        name: '시즌오프/계절맞춤 스타일링',
        directive: '첫눈, 장마철, 폭염 대비 등 특정 계절감에 K-POP 아티스트 컨셉을 곁들인 큐레이션.',
    },
    virtual_influencer_ootd: {
        name: 'AI 버추얼 인플루언서 OOTD',
        directive: '매거진 소속 가상 에디터(NOVA, PRISM)의 시점으로 올리는 일상 OOTD. 셀카 타각, 친근한 톤.',
    },
    // 기존 카테고리 호환
    style_editorial: {
        name: '스타일 에디토리얼',
        directive: '아티스트 화보 촬영 무드의 하이패션 에디토리얼. 시네마틱 연출.',
    },
    vibe_alike: {
        name: 'Vibe-Alike 화보',
        directive: '아티스트 에스테틱을 AI 가상 모델로 재해석한 Vibe-Alike 정면 화보.',
    },
    stage_look: {
        name: '무대 패션 분석',
        directive: '이번 무대에서 선택한 의상/소재/컬러를 퍼포먼스 맥락에서 분석.',
    },
    mv_analysis: {
        name: 'MV 패션 분석',
        directive: 'MV 속 의상 체인지와 컬러 전환이 서사에 미치는 영향을 분석.',
    },
    fan_discussion: {
        name: '팬 오픈 토크',
        directive: '팬 투표/토론을 유도하는 참여형 콘텐츠. 질문으로 끝나는 구조.',
    },
};

/**
 * 아티스트 목록
 */
const ARTISTS = [
    "BLACKPINK", "aespa", "NewJeans", "IVE", "LE SSERAFIM",
    "TWICE", "ITZY", "Stray Kids", "ENHYPEN", "TXT",
    "(G)I-DLE", "NMIXX", "RIIZE", "BABYMONSTER", "ILLIT"
];

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Claude로 Gemini 초안을 최종 SNS 본문으로 폴리싱한다.
 */
async function polishWithClaude(platform, geminiBrief) {
    if (!process.env.ANTHROPIC_API_KEY) return geminiBrief;

    const platformTone = platform === 'instagram'
        ? '매거진 에디토리얼 캡션 톤 (오프닝→K-POP 맥락→패션 분석→클로저→CTA). 해시태그 10~15개.'
        : '짧고 강한 오프닝 + K-POP 팩트 + 패션 포인트 1개 + CTA. 해시태그 3~5개.';

    const polishPrompt = `당신은 'mystyleKPOP' 글로벌 AI 패션 K-POP 매거진의 최종 에디터입니다.
아래는 Gemini AI가 작성한 SNS 게시물 초안입니다. 이것을 바로 ${platform === 'instagram' ? 'Instagram' : 'X(Twitter)'}에 게시할 수 있는 최종 본문으로 다듬어주세요.

## 플랫폼 톤
${platformTone}

## 폴리싱 규칙
1. **K-POP 비율 최소 50% (절대 규칙)**: K-POP 맥락이 반드시 50% 이상.
2. **브랜드 톤**: 전문적이면서 팬이 공감할 수 있는 톤.
3. **금지 표현**: "~인 것 같다", "~하게 된다", "대박", "레전드" 절대 금지.
4. **강한 오프닝**: 숫자/팩트/대비로 시작. 감정적 감탄사 금지.
5. **에디토리얼 클로저**: 도입부 키워드를 마무리에서 회수.
6. **CTA**: "👉 my-style.ai" 포함 필수.
7. **Bot Disclosure**: 맨 마지막 줄에 "(Generated by mystyleKPOP AI)" 절대 넣지 마세요. 시스템이 자동 삽입합니다.
8. 출력은 SNS 본문 텍스트만. 메타 설명/주석 없이 바로 게시할 수 있는 텍스트.

## Gemini 초안
${geminiBrief}`;

    try {
        const client = new Anthropic();
        const response = await client.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 1024,
            messages: [{ role: 'user', content: polishPrompt }],
        });
        return response.content[0].text;
    } catch (err) {
        console.error('[ContentGen] Claude 폴리싱 오류, Gemini 결과 사용:', err.message);
        return geminiBrief;
    }
}

/**
 * Hybrid LLM 파이프라인으로 SNS 게시물을 생성한다.
 *
 * @param {object} params
 * @param {string} params.platform - 'x' | 'instagram'
 * @param {string} params.formatKey - FORMAT_DIRECTIVES 키 (예: 'comeback_lookbook')
 * @param {string} [params.artist] - 아티스트명 (미지정 시 랜덤)
 * @returns {{ text: string, category: string, type: string, platform: string, artist: string, imageDirection: string|null }}
 */
export async function generateSNSContent({ platform, formatKey, artist }) {
    artist = artist || pickRandom(ARTISTS);
    const format = FORMAT_DIRECTIVES[formatKey] || FORMAT_DIRECTIVES.style_editorial;

    // GEMINI_API_KEY 미설정 시 fallback (기존 템플릿 방식)
    if (!process.env.GEMINI_API_KEY) {
        console.log('[ContentGen] GEMINI_API_KEY 미설정. 기본 템플릿 fallback.');
        return null; // caller가 기존 getRandomDraft()로 fallback
    }

    const strategyContext = loadStrategyContext();
    const editorialPrompt = await getEditorialDirectionPrompt();
    const trendPrompt = await getTrendWeightsPrompt();
    const externalPrompt = await getExternalTrendPrompt();

    const platformGuide = platform === 'instagram'
        ? `**Instagram 게시물**: 매거진 에디토리얼 캡션. 오프닝→K-POP 맥락→패션 분석→클로저→CTA 구조. 해시태그 10~15개 (한국어+영문 믹스).`
        : `**X(Twitter) 게시물**: 짧고 강한 오프닝 1문장 + K-POP 팩트 + 패션 포인트 1개 + CTA. 해시태그 3~5개. 280자 내외 권장.`;

    const geminiPrompt = `당신은 'mystyleKPOP' 글로벌 AI 패션 K-POP 매거진의 수석 에디터입니다.
아래 전략서, 트렌드 데이터, 에디토리얼 방향을 참고하여 **바로 SNS에 게시할 수 있는 완성된 본문**을 작성하세요.

## 브랜드 전략 및 에디토리얼 가이드
${strategyContext}
${editorialPrompt ? `\n${editorialPrompt}\n` : ''}
${trendPrompt ? `\n${trendPrompt}\n` : ''}
${externalPrompt ? `\n${externalPrompt}\n` : ''}

## 이번 게시물 지시
- **플랫폼:** ${platformGuide}
- **포맷:** [${format.name}] — ${format.directive}
- **아티스트:** ${artist}

## 핵심 규칙
1. **K-POP 비율 최소 50% (절대 규칙)**: K-POP 맥락(아티스트/컴백/활동)이 중심. 패션은 이를 보강.
2. 강한 오프닝: 숫자/팩트/대비로 시작. 감정적 감탄사 금지.
3. 본문 3단계: K-POP 맥락(50% 이상) → 패션 분석 → 팬 적용/참여 유도.
4. 에디토리얼 클로저: 도입부 키워드를 마무리에서 회수.
5. "~인 것 같다", "~하게 된다", "대박", "레전드" 금지.
6. CTA: "👉 my-style.ai" 포함.
7. #mystyleKPOP 해시태그 필수 포함.
8. **Bot Disclosure 문구 넣지 말 것** (시스템 자동 삽입).

## 출력 형식
아래 JSON만 출력하세요. 다른 텍스트 없이 JSON만:
{
  "text": "바로 게시할 수 있는 SNS 본문 (CTA + 해시태그 포함)",
  "image_direction": "이 게시물에 어울리는 AI 이미지 프롬프트 (영어, 패션 사진 디렉션 50자 이내). 예: dark chiaroscuro studio, metallic cropped jacket, neon blue accent"
}`;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: geminiPrompt,
        });

        const rawText = response.text.trim();
        const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);

        let text, imageDirection;
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            text = parsed.text;
            imageDirection = parsed.image_direction || null;
        } else {
            // JSON 파싱 실패 시 전체를 텍스트로 사용
            text = rawText;
            imageDirection = null;
        }

        // Claude 폴리싱
        const polished = await polishWithClaude(platform, text);

        return {
            text: polished,
            category: formatKey,
            type: formatKey,
            platform,
            artist,
            imageDirection,
        };
    } catch (err) {
        console.error('[ContentGen] LLM 생성 실패:', err.message);
        return null; // caller가 기존 getRandomDraft()로 fallback
    }
}

/**
 * 사용 가능한 포맷 키 목록을 반환한다.
 */
export function getFormatKeys() {
    return Object.keys(FORMAT_DIRECTIVES);
}

/**
 * 포맷 키로 포맷 정보를 반환한다.
 */
export function getFormatInfo(formatKey) {
    return FORMAT_DIRECTIVES[formatKey] || null;
}
