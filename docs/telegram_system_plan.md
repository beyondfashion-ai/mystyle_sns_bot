# 텔레그램 시스템 개선 기획안

## 현황 진단

### 잘 작동하는 것
- 초안 워크플로 (생성 → 미리보기 → 승인/거부/수정/재생성)
- Hybrid LLM 파이프라인 (Gemini→Claude) — `/askai`에서 사용
- fal.ai 이미지 생성 (FLUX 1.1 Ultra + Recraft V3)
- 카드뉴스 생성 (Puppeteer + Firebase Storage)
- cron 자동 스케줄러 (X 3회/일, IG 2회/일)
- 에디토리얼 자동 진화 (4단계 시간 스케일)
- Analytics + 주간 리포트
- 트렌드 분석 (내부 engagement + 외부 X 스크래핑)
- DB 동적 포맷 관리

### 핵심 문제점

| # | 영역 | 문제 | 영향도 |
|---|------|------|--------|
| 1 | **콘텐츠 품질** | `/dx`, `/di`가 LLM을 거치지 않음. `templates.json` 치환만 수행 → Hybrid LLM은 `/askai`에서만 작동 | 높음 |
| 2 | **콘텐츠 캘린더** | `content_calendar_plan.md`에 10포맷×7일 편성표가 정의되어 있으나 스케줄러에 연동되지 않음. 현재 랜덤 선택 | 높음 |
| 3 | **아키텍처** | `telegram.js` 910줄 단일 파일. 명령어, 콜백, 상태, 미리보기가 모두 결합됨 | 중간 |
| 4 | **상태 관리** | `pendingDrafts`/`editMode`가 in-memory Map. 봇 재시작 시 모든 대기 초안 유실 | 중간 |
| 5 | **크로스포스팅** | 초안이 X 또는 IG 중 하나만 선택 가능. 동일 콘텐츠를 양쪽에 동시 게시하는 흐름 없음 | 중간 |
| 6 | **스케줄러 제어** | 텔레그램에서 자동 스케줄러를 일시정지/재개할 수 없음. 예정 작업 확인 불가 | 낮음 |
| 7 | **메인 메뉴** | `/dx`, `/di` 버튼이 메인 메뉴에 없음. `/help` 명령어도 없음 | 낮음 |

---

## Phase 1: 콘텐츠 품질 혁신 (Critical)

> 가장 시급한 문제: 실제 게시물 텍스트가 LLM을 거치지 않아 전략서 품질과 실제 출력 품질 사이에 큰 간극이 존재함.

### 1-1. Hybrid LLM 초안 생성 파이프라인 도입

**현재:** `/dx` → `getRandomFormatDraft()` → 템플릿 변수 치환 → 미리보기
**개선:** `/dx` → 포맷 선택 → **Gemini(전략서+트렌드+에디토리얼 방향 분석) → Claude(폴리싱)** → 미리보기

**구현 방향:**
- `src/contentGenerator.js` 신규 모듈 생성
- `brainstormFormat()`의 로직을 확장하여 "최종 게시물 본문 생성용" 함수 추가
- 입력: 카테고리, 아티스트, 트렌드 데이터, 에디토리얼 방향
- 출력: 바로 게시 가능한 완성된 SNS 본문

```
generateSNSContent({ platform, category, artist, trends, editorial })
  ├─ Step 1 (Gemini): 전략서 + SOP + 트렌드 + 에디토리얼 방향 → 초안
  ├─ Step 2 (Claude): 브랜드 톤 + 금지어 + K-POP ≥50% → 최종본
  └─ Fallback: ANTHROPIC_API_KEY 미설정 시 Gemini 결과 사용
```

**변경 파일:** `src/contentGenerator.js` (신규), `src/telegram.js` (handleDx/handleDi 수정)

### 1-2. 콘텐츠 캘린더 스케줄러 연동

**현재:** 스케줄러가 시간에만 기반하여 랜덤 포맷 선택
**개선:** `content_calendar_plan.md`의 요일×시간대별 10포맷 편성표를 실제 스케줄러에 연동

**구현 방향:**
- `src/contentCalendar.js` 신규 모듈 생성
- 요일(0~6) × 시간대(10시/15시/20시) → 포맷 매핑 테이블
- 스케줄러가 현재 요일/시간에 맞는 포맷을 선택하여 `contentGenerator`에 전달

```javascript
// 예시 매핑 구조
const CALENDAR = {
  1: { // 월요일
    10: 'virtual_influencer_ootd',
    15: 'highfashion_tribute',
    20: 'comeback_lookbook'
  },
  // ...
};
```

**변경 파일:** `src/contentCalendar.js` (신규), `src/scheduler.js` (수정)

### 1-3. 이미지 프롬프트 컨텍스트 강화

**현재:** `buildImagePrompt()`가 카테고리별 고정 프롬프트만 사용. 실제 텍스트 내용을 반영하지 않음
**개선:** LLM이 생성한 텍스트에서 핵심 비주얼 키워드를 추출하여 이미지 프롬프트에 반영

**구현 방향:**
- `contentGenerator`가 텍스트 생성 시 `image_direction` 필드도 함께 생성
- 예: `"dark chiaroscuro studio, metallic cropped jacket, neon blue accent"`
- `buildImagePrompt()`가 `draft.imageDirection`을 우선 사용, 없으면 기존 카테고리 프롬프트 fallback

**변경 파일:** `src/contentGenerator.js`, `src/imageGen.js` (buildImagePrompt 수정)

---

## Phase 2: 아키텍처 개선

### 2-1. telegram.js 모듈 분리

**현재:** 910줄 단일 파일에 모든 로직이 혼재
**개선:** 역할별 모듈 분리

```
src/telegram/
  ├── index.js          # createTelegramBot() 진입점 + 봇 초기화
  ├── commands.js       # 명령어 핸들러 (/dx, /di, /cn, /askai, ...)
  ├── callbacks.js      # 인라인 버튼 콜백 핸들러
  ├── cardnews.js       # 카드뉴스 전용 핸들러
  ├── keyboards.js      # 인라인 키보드 정의
  ├── state.js          # pendingDrafts, editMode 상태 관리
  └── scheduled.js      # 스케줄러용 export 함수 (sendScheduledDraftX/IG)
```

**원칙:**
- 기능 변경 없이 순수 리팩토링 (동작 동일)
- 기존 export 인터페이스 유지 (`createTelegramBot`, `sendScheduledDraftX`, `sendScheduledDraftIG`)

### 2-2. 상태 관리 Firestore 전환

**현재:** `pendingDrafts` = in-memory Map (봇 재시작 시 유실)
**개선:** Firestore `pending_drafts` 컬렉션으로 전환

```
pending_drafts/{messageId} = {
  text, category, type, platform, imageUrl, artist,
  createdAt, expiresAt, status: 'pending'|'approved'|'rejected'
}
```

**장점:**
- 봇 재시작 후에도 대기 초안 복구
- 초안 이력 조회 가능 (Phase 3에서 활용)
- TTL은 Firestore TTL 정책 또는 기존 5분 주기 정리 로직 병행

**Fallback:** Firestore 미연결 시 기존 in-memory 방식 유지 (graceful)

### 2-3. 크로스포스팅 워크플로

**현재:** `/dx`는 X 전용, `/di`는 IG 전용. 하나의 콘텐츠를 양쪽에 게시하려면 별도 조작 필요.
**개선:** 승인 시 "X+IG 동시 게시" 옵션 추가

```
인라인 키보드 수정:
[✅ X 게시]  [✅ IG 게시]  [✅ X+IG 동시]
[✏️ 수정]   [🔄 재생성]   [❌ 거부]
```

- X+IG 동시 게시 시, 텍스트를 플랫폼별 톤으로 자동 조정 (X: 짧게, IG: 매거진 톤)
- 이미지가 없으면 IG 게시 불가 안내

**변경 파일:** `src/telegram.js` (keyboards + approve handler)

---

## Phase 3: 운영 편의 기능

### 3-1. 메인 메뉴 & /help 개선

```
/start 메인 메뉴 개선:
[📝 X 초안 생성]        [📸 IG 화보 생성]
[📰 카드뉴스 제작]      [🤖 AI 기획 회의]
[📊 시스템 현황]        [📈 주간 리포트]
[📋 포맷 관리]          [⏰ 스케줄러 관리]
```

- `/help` 명령어 추가: 전체 명령어 목록 + 간단한 설명

### 3-2. 스케줄러 관리 명령어

```
/scheduler 또는 메인 메뉴 버튼:
[⏸️ 일시정지]  [▶️ 재개]  [📋 예정 작업 보기]
```

- 일시정지: 전체 자동 초안 전송 중단 (에디토리얼 진화는 유지)
- 예정 작업: "다음 X 초안: 오늘 15:00 KST (포맷: 하이패션 헌정 화보)"
- Firestore `bot_settings/scheduler_state`에 상태 저장

### 3-3. 초안 히스토리

```
/history 또는 메인 메뉴 버튼:
최근 승인/거부된 초안 5건 요약 표시
[📝 최근 승인 5건]  [❌ 최근 거부 5건]
```

- Phase 2-2에서 Firestore로 전환한 상태 데이터 활용
- 각 항목에 날짜, 플랫폼, 카테고리, 텍스트 미리보기 표시

### 3-4. 에러 알림 강화

**현재:** `notifyError()`가 스케줄러 에러만 전송
**개선:** 봇 전체의 주요 에러를 텔레그램으로 관리자에게 알림

- 이미지 생성 실패
- API 키 만료/한도 초과
- Firebase 연결 끊김
- 스케줄러 작업 연속 실패 (3회 이상)

---

## Phase 4: 향후 확장 (Future)

> 현재 스프린트 범위 밖이지만, 아키텍처 설계 시 고려해야 할 사항

### 4-1. Threads 채널 추가
- `content_marketer_sop.md`에 명시된 향후 채널
- 기존 크로스포스팅 인프라 위에 추가

### 4-2. Remotion 비디오 자동화
- `content_strategy.md`, `master_proposal.md`에 릴스/숏폼 언급
- React 기반 비디오 렌더링 파이프라인

### 4-3. X 실시간 답장 자동화
- `content_strategy.md`의 "오픈 토크" 전략
- Rate Limit 준수 (시간당 5회, 일일 30회)

### 4-4. UGC 캠페인 시스템
- `master_proposal.md`의 "이달의 베스트 스타일" 선정
- 팬 태그 감지 → 자동 큐레이션

---

## 구현 우선순위 요약

| 순위 | 항목 | 예상 영향 | 이유 |
|------|------|----------|------|
| **P0** | 1-1. Hybrid LLM 초안 파이프라인 | 콘텐츠 품질 대폭 향상 | 핵심 가치. 현재 템플릿 치환은 전략서 품질에 미달 |
| **P0** | 1-2. 콘텐츠 캘린더 연동 | 콘텐츠 다양성 확보 | 10포맷 편성표가 이미 기획되어 있으나 미사용 |
| **P1** | 1-3. 이미지 프롬프트 강화 | 비주얼 품질 향상 | LLM 텍스트와 이미지 간 맥락 일치 |
| **P1** | 2-1. 모듈 분리 | 유지보수성 | 기능 추가 전에 구조 정리 | ✅ 완료 |
| **P1** | 3-1. 메인 메뉴 개선 | UX | 핵심 기능에 대한 접근성 | ✅ 완료 |
| **P2** | 2-2. Firestore 상태 관리 | 안정성 | 재시작 시 초안 유실 방지 | ✅ 완료 |
| **P2** | 2-3. 크로스포스팅 | 운영 효율 | 동일 콘텐츠 멀티 플랫폼 | ✅ 완료 |
| **P2** | 3-2. 스케줄러 관리 | 운영 편의 | 텔레그램에서 제어 |
| **P3** | 3-3. 초안 히스토리 | 분석/참고 | Firestore 전환 후 가능 |
| **P3** | 3-4. 에러 알림 강화 | 모니터링 | 프로덕션 안정성 |

---

## 구현 완료 이력

### Session 1 — P0 항목 (Phase 1: 콘텐츠 품질)

1. **`src/contentGenerator.js`** — Hybrid LLM 기반 SNS 콘텐츠 생성 모듈
2. **`src/contentCalendar.js`** — 요일×시간대별 포맷 매핑 + 스케줄러 연동
3. **`src/telegram.js` 수정** — `/dx`, `/di`가 contentGenerator를 통해 LLM 생성
4. **`src/scheduler.js` 수정** — contentCalendar 기반 포맷 선택
5. **메인 메뉴 개선** — `/dx`, `/di` 버튼 추가

### Session 2 — P1~P2 항목 (Phase 2: 아키텍처 개선)

1. **2-1. `telegram.js` 모듈 분리** — 1030줄 모노리스를 7개 모듈로 분해
   ```
   src/telegram/
     index.js          # createTelegramBot() 진입점
     state.js          # 상태 관리 + Firestore write-through + TTL 정리
     keyboards.js      # 인라인 키보드 정의 + 크로스포스팅 키보드
     helpers.js        # 유틸 (clearButtons, sendDraftPreview, isAdmin)
     commands.js       # 명령어 핸들러 + /help 추가
     callbacks.js      # 콜백 핸들러 + approve_both (크로스포스팅)
     cardnews.js       # 카드뉴스 전용 핸들러
     scheduled.js      # 스케줄러 export 함수
   ```
   - `src/telegram.js`는 re-export 브릿지로 전환 (하위 호환성 유지)

2. **2-2. Firestore 상태 관리 전환**
   - `telegram_drafts`, `telegram_cardnews` 컬렉션으로 write-through 캐시
   - 봇 재시작 시 `restoreStateFromFirestore()`로 대기 초안 복구
   - `updateDraftStatus()`로 승인/거부 이력 Firestore 기록 (히스토리 준비)

3. **2-3. 크로스포스팅 워크플로**
   - `CROSS_POST_KEYBOARD`: 이미지 있는 초안에 "✅ X+IG 동시" 버튼 표시
   - `getDraftKeyboard(draft)`: 이미지 유무에 따라 키보드 자동 선택
   - `handleApproveBoth()`: `postToSNS({ platforms: ['x', 'instagram'] })` 호출

4. **3-1. /help 명령어 추가** — 전체 명령어 가이드
