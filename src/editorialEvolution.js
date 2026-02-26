import { GoogleGenAI } from '@google/genai';
import { db } from './firebase.js';

const COLLECTION = 'bot_settings';
const DOC_IDS = {
    daily: 'editorial_daily',
    weekly: 'editorial_weekly',
    monthly: 'editorial_monthly',
    quarterly: 'editorial_quarterly',
};

/**
 * Gemini로 에디토리얼 방향을 분석하고 Firestore에 저장하는 공통 함수.
 * 내부 분석용이므로 Gemini 2.5 Flash만 사용 (저비용).
 */
async function runEditorialAnalysis(level, prompt) {
    if (!db) {
        console.log(`[Editorial] Firestore 미설정. ${level} 에디토리얼 분석 건너뜀.`);
        return;
    }
    if (!process.env.GEMINI_API_KEY) {
        console.log(`[Editorial] GEMINI_API_KEY 미설정. ${level} 에디토리얼 분석 건너뜀.`);
        return;
    }

    const docId = DOC_IDS[level];

    try {
        // 이전 지시문 가져오기
        const prevDoc = await db.collection(COLLECTION).doc(docId).get();
        const previousDirective = prevDoc.exists ? prevDoc.data().directive || '' : '';

        // 상위 레벨 지시문 컨텍스트 수집
        const hierarchy = ['quarterly', 'monthly', 'weekly', 'daily'];
        const currentIdx = hierarchy.indexOf(level);
        const parentContextParts = [];
        for (let i = 0; i < currentIdx; i++) {
            const parentDoc = await db.collection(COLLECTION).doc(DOC_IDS[hierarchy[i]]).get();
            if (parentDoc.exists && parentDoc.data().directive) {
                parentContextParts.push(`[${hierarchy[i]} 방향]: ${parentDoc.data().directive}`);
            }
        }
        const parentContext = parentContextParts.length > 0
            ? `\n\n## 상위 에디토리얼 방향 (참조)\n${parentContextParts.join('\n')}`
            : '';

        const fullPrompt = `${prompt}${parentContext}

## 이전 ${level} 지시문
${previousDirective || '(없음)'}

## 핵심 규칙
1. K-POP 50% + Fashion 50% 균형 반드시 유지.
2. 카테고리 비율 변경은 최대 ±15%p까지만 허용 (보수적 변경).
3. 지시문은 100자 이내 자연어로 작성.
4. "~인 것 같다", "대박", "레전드" 등 금지 표현 사용 금지.

JSON 형식으로만 응답하세요:
{"directive": "100자 이내 에디토리얼 지시문", "analysis": "분석 요약 200자 이내"}`;

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: fullPrompt,
        });

        const text = response.text.trim();
        // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
        const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) {
            console.error(`[Editorial] ${level} Gemini 응답에서 JSON을 추출할 수 없습니다.`);
            return;
        }

        const parsed = JSON.parse(jsonMatch[1]);

        await db.collection(COLLECTION).doc(docId).set({
            updatedAt: new Date(),
            directive: parsed.directive || '',
            analysis: parsed.analysis || '',
            previousDirective,
        });

        console.log(`[Editorial] ${level} 에디토리얼 방향 업데이트 완료: ${parsed.directive}`);
    } catch (err) {
        console.error(`[Editorial] ${level} 분석 실패:`, err.message);
    }
}

/**
 * 매일 01:00 KST - 일간 에디토리얼 미세 조정
 */
export async function runDailyEditorial() {
    console.log('[Editorial] 일간 에디토리얼 분석 시작');
    await runEditorialAnalysis('daily', `당신은 mystyleKPOP AI 패션 매거진의 에디토리얼 디렉터입니다.

## 임무: 일간 에디토리얼 미세 조정
어제의 SNS 게시물 반응과 트렌드를 기반으로 오늘의 콘텐츠 톤과 초점을 미세 조정하세요.

고려 사항:
- 어제 반응이 좋았던 콘텐츠 유형은 더 강화
- 반응이 낮았던 요소는 방향 수정
- K-POP 일정(컴백, 음방, 시상식)에 맞춘 실시간 대응
- 패션 시즌 이벤트(패션위크, 컬렉션 발표) 반영`);
}

/**
 * 매주 일요일 02:00 KST - 주간 에디토리얼 방향 조정
 */
export async function runWeeklyEditorial() {
    console.log('[Editorial] 주간 에디토리얼 분석 시작');
    await runEditorialAnalysis('weekly', `당신은 mystyleKPOP AI 패션 매거진의 에디토리얼 디렉터입니다.

## 임무: 주간 에디토리얼 방향 조정
지난 1주일의 성과 데이터와 트렌드를 분석하여 다음 주 콘텐츠 방향을 제시하세요.

고려 사항:
- 주간 평균 engagement rate 변화 추이
- 가장 성과가 좋은 콘텐츠 카테고리 비율 조정 (±15%p 이내)
- 다음 주 K-POP 주요 일정 반영
- 팬덤 트렌드 키워드 반영`);
}

/**
 * 매월 1일 03:00 KST - 월간 에디토리얼 전략 재평가
 */
export async function runMonthlyEditorial() {
    console.log('[Editorial] 월간 에디토리얼 분석 시작');
    await runEditorialAnalysis('monthly', `당신은 mystyleKPOP AI 패션 매거진의 에디토리얼 디렉터입니다.

## 임무: 월간 에디토리얼 전략 재평가
지난 한 달의 전체 성과와 트렌드를 기반으로 다음 달 전략을 수립하세요.

고려 사항:
- 월간 팔로워 성장률과 engagement 추이
- 상위/하위 성과 콘텐츠 패턴 분석
- 다음 달 K-POP 컴백 스케줄과 패션 시즌 연동
- 브랜드 톤 일관성 점검`);
}

/**
 * 분기 첫 달 1일 04:00 KST - 분기 에디토리얼 비전 재설정
 */
export async function runQuarterlyEditorial() {
    console.log('[Editorial] 분기 에디토리얼 분석 시작');
    await runEditorialAnalysis('quarterly', `당신은 mystyleKPOP AI 패션 매거진의 에디토리얼 디렉터입니다.

## 임무: 분기 에디토리얼 비전 재설정
지난 분기의 전체 성과를 리뷰하고 다음 분기의 큰 방향성을 설정하세요.

고려 사항:
- 분기 성장 목표 대비 실적 분석
- K-POP 산업 트렌드 (새 그룹 데뷔, 월드투어, 컬래버레이션)
- 패션 업계 시즌 트렌드 (S/S, F/W, 리조트, 프리폴)
- 콘텐츠 믹스 최적화 (에디토리얼 vs 카드뉴스 vs 숏폼)
- my-style.ai 유입 전환률 분석 기반 CTA 전략`);
}

/**
 * 현재 저장된 에디토리얼 방향을 프롬프트 문자열로 반환한다.
 * 초안 생성 시 컨텍스트로 주입하기 위해 사용한다.
 * Firestore 미연결 시 빈 문자열 반환 (graceful).
 */
export async function getEditorialDirectionPrompt() {
    if (!db) return '';

    try {
        const levels = ['quarterly', 'monthly', 'weekly', 'daily'];
        const labels = { quarterly: '분기', monthly: '월간', weekly: '주간', daily: '오늘' };
        const parts = [];

        for (const level of levels) {
            const doc = await db.collection(COLLECTION).doc(DOC_IDS[level]).get();
            if (doc.exists && doc.data().directive) {
                parts.push(`- ${labels[level]}: ${doc.data().directive}`);
            }
        }

        if (parts.length === 0) return '';

        return `[에디토리얼 방향 가이드:\n${parts.join('\n')}\n이 방향을 참고하되, 템플릿의 기본 구조는 유지하라.]`;
    } catch (err) {
        console.error('[Editorial] 방향 프롬프트 로드 실패:', err.message);
        return '';
    }
}
