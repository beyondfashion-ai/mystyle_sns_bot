import { GoogleGenAI } from '@google/genai';

/**
 * Gemini 2.0 API를 사용하여 SNS 기획(포맷) 생성/아이데이션을 지원합니다.
 */
export async function brainstormFormat(platform, requestText) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. .env를 확인해주세요.");
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const systemPrompt = `당신은 'mystyleKPOP' 글로벌 AI 패션 매거진의 수석 에디터입니다.
이 매거진은 K-POP 아티스트의 실명을 언급하며, 실제 사진이 아닌 Vibe-Alike(분위기 유사) AI 가상 모델 이미지와 함께 다음 컴백/사복/무대의상을 제안합니다.

지금 봇 관리자가 텔레그램을 통해 "${platform}" 플랫폼에 올릴 **새로운 콘텐츠 기획 포맷(템플릿)** 아이디어를 물어봤습니다.
사용자의 요청사항: "${requestText}"

아래의 양식에 맞춰 창의적이고 팬덤 반응을 자극할 만한 포맷 템플릿 초안을 1개 제안해주세요.

--- 출력 양식 ---
[포맷명]: (직관적이고 매력적인 이름, ex: 주말 가로수길 파파라치 스냅)
[컨셉 설명]: (어떤 의도와 앵글로 생성되는 이미지인지)
[프롬프트 원문]: (실제로 봇이 치환해서 쓸 본문 내용. 아이돌 이름은 {artist}, 유저 반응 유도 문구와 마지막 무료 체험 유도 링크 my-style.ai 은 필수 배치.)
------------------
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: systemPrompt,
        });

        return response.text;
    } catch (err) {
        console.error('[Gemini] 아이데이션 중 오류 발생:', err.message);
        throw new Error(`AI 호출 중 문제가 발생했습니다: ${err.message}`);
    }
}
