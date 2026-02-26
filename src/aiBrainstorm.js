import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getEditorialDirectionPrompt } from './editorialEvolution.js';

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

/**
 * Step 2: Claude Sonnet으로 Gemini 초안을 최종 SNS 본문으로 폴리싱한다.
 * ANTHROPIC_API_KEY 미설정 시 Gemini 결과 그대로 반환 (fallback).
 */
async function polishWithClaude(geminiBrief) {
    if (!process.env.ANTHROPIC_API_KEY) return geminiBrief;

    const polishPrompt = `당신은 'mystyleKPOP' 글로벌 AI 패션 K-POP 매거진의 최종 에디터입니다.
아래는 Gemini AI가 작성한 콘텐츠 기획 초안(Brief)입니다.
이 초안을 세련되고 전문적인 최종 SNS 본문으로 다듬어주세요.

## 폴리싱 규칙
1. **K-POP 비율 최소 50% (절대 규칙)**: K-POP 맥락이 반드시 50% 이상이어야 하며, 패션이 K-POP을 넘어서는 안 됩니다.
2. **브랜드 톤**: 전문적이면서 팬이 공감할 수 있는 톤. 지나치게 격식적이거나 캐주얼하지 않게.
3. **금지 표현**: "~인 것 같다", "~하게 된다", "대박", "레전드" 절대 금지.
4. **강한 오프닝**: 숫자/팩트/대비로 시작. 감정적 감탄사 금지.
5. **구조**: K-POP 맥락(중심, 50% 이상) → 패션 분석(보강) → 팬 적용 포인트 3단계.
6. **에디토리얼 클로저**: 도입부 키워드를 마무리에서 회수.
7. **CTA**: my-style.ai 서비스 유도 포함.
8. 초안의 [포맷명], [컨셉 설명], [프롬프트 원문] 구조는 유지하되 내용을 다듬으세요.

## Gemini 초안
${geminiBrief}`;

    try {
        const client = new Anthropic();
        const response = await client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 1024,
            messages: [{ role: 'user', content: polishPrompt }],
        });
        return response.content[0].text;
    } catch (err) {
        console.error('[Claude] 폴리싱 중 오류 발생, Gemini 결과 사용:', err.message);
        return geminiBrief;
    }
}

/**
 * Gemini→Claude 2단계 하이브리드 파이프라인으로 SNS 기획(포맷)을 생성한다.
 * Step 1 (Gemini 2.5 Flash - Drafting): 전략서 + 트렌드 + 에디토리얼 방향 기반 Brief 생성
 * Step 2 (Claude Sonnet - Polishing): Brief를 최종 SNS 본문으로 다듬기
 * Fallback: ANTHROPIC_API_KEY 미설정 시 Gemini 결과 그대로 반환
 */
export async function brainstormFormat(platform, requestText) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. .env를 확인해주세요.");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const strategyContext = loadStrategyContext();
    const editorialPrompt = await getEditorialDirectionPrompt();

    const systemPrompt = `당신은 'mystyleKPOP' 글로벌 AI 패션 매거진의 수석 에디터입니다.
이 매거진은 K-POP 아티스트의 실명을 언급하며, 실제 사진이 아닌 Vibe-Alike(분위기 유사) AI 가상 모델 이미지와 함께 다음 컴백/사복/무대의상을 제안합니다.

## 브랜드 전략 및 에디토리얼 가이드
아래 전략서를 반드시 참고하여 브랜드 톤, 글쓰기 규칙, 분석 구조를 따르세요.

${strategyContext}
${editorialPrompt ? `\n${editorialPrompt}\n` : ''}
## 요청
지금 봇 관리자가 텔레그램을 통해 "${platform}" 플랫폼에 올릴 **새로운 콘텐츠 기획 포맷(템플릿)** 아이디어를 물어봤습니다.
사용자의 요청사항: "${requestText}"

## 핵심 규칙
1. **K-POP 비율 최소 50% (절대 규칙)**: K-POP 맥락(아티스트/컴백/활동)이 반드시 50% 이상이어야 하며, 패션 분석이 K-POP을 넘어서는 안 된다.
2. 강한 오프닝: 숫자/팩트/대비로 시작. 감정적 감탄사 금지.
3. 본문 3단계: K-POP 맥락(중심, 50% 이상) → 패션 분석(보강) → 팬 적용 포인트.
4. 에디토리얼 클로저: 도입부 키워드를 마무리에서 회수.
5. "~인 것 같다", "~하게 된다", "대박", "레전드" 금지.

아래의 양식에 맞춰 K-POP 팬덤 반응을 자극하면서 패션 분석이 담긴 포맷 템플릿 초안을 1개 제안해주세요.

--- 출력 양식 ---
[포맷명]: (직관적이고 매력적인 이름, ex: 컴백 룩 해부 시리즈)
[컨셉 설명]: (K-POP 맥락이 중심, 패션 분석은 이를 보강하는 앵글)
[프롬프트 원문]: (봇이 치환할 본문. {artist} 사용. K-POP 맥락(50% 이상) → 패션 분석(보강) → 팬 참여 유도 + my-style.ai CTA 필수.)
------------------
`;

    try {
        // Step 1: Gemini가 전략서+트렌드 읽고 Brief 생성
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: systemPrompt,
        });
        const geminiBrief = response.text;

        // Step 2: Claude가 Brief를 최종 SNS 본문으로 polishing
        const polished = await polishWithClaude(geminiBrief);
        return polished;
    } catch (err) {
        console.error('[Gemini] 아이데이션 중 오류 발생:', err.message);
        throw new Error(`AI 호출 중 문제가 발생했습니다: ${err.message}`);
    }
}
