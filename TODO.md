# mystyle_sns_bot 개선사항 TODO

> 모든 항목 완료됨 (2026-02-27)

## ✅ 완료된 항목

### 높은 우선순위 (High)
- [x] **이미지 생성 재시도 로직** — `src/imageGen.js`에 `withRetry()` 래퍼 추가, fal.ai 장애 시 최대 2회 재시도 (지수 백오프)
- [x] **Firestore 상태 복구 실패 알림** — `src/telegram/index.js` 복구 실패 시 관리자에게 텔레그램 알림 전송
- [x] **Draft 객체 인터페이스 통일** — `src/utils.js`에 `normalizeDraft()` + JSDoc typedef 정의, `state.js`에서 활용
- [x] **editMode/TTL 충돌 방지** — `src/telegram/state.js` TTL 정리 시 수정 모드 활성 draft 제외

### 중간 우선순위 (Medium)
- [x] **Puppeteer 브라우저 풀** — `src/cardNews.js` 단일 인스턴스 재사용 패턴, 실패 시 풀 리셋
- [x] **로깅 표준화** — `src/logger.js` 생성 (DEBUG/INFO/WARN/ERROR 레벨, 스택 트레이스 포함)
- [x] **중앙 설정 파일** — `src/config.js` 생성 (KST offset, TTL, Rate limit, Puppeteer 설정 등 매직 넘버 통합)
- [x] **환경변수 검증 통합** — `src/config.js`에 `validateEnv()` + `hasEnv()` 통합, `server.js` 중복 제거
- [x] **콘텐츠 캘린더 포맷 키 정리** — `src/contentCalendar.js`에 `fan_discussion`, `mv_analysis` 추가

### 낮은 우선순위 (Low)
- [x] **프롬프트 인젝션 방어** — `src/utils.js`에 `sanitizeForPrompt()` 생성, `contentGenerator.js` + `aiBrainstorm.js` 적용
- [x] **Puppeteer 타임아웃 매개변수화** — `src/config.js`에 `PUPPETEER_RENDER_TIMEOUT_MS` 설정, `cardNews.js`에서 참조
- [x] **Firebase 에러 표면화** — `src/firebase.js`에 `requireDB()` 함수 추가 (미연결 시 구체적 에러 반환)
- [x] **프롬프트 조립 중복 제거** — `aiBrainstorm.js`에서 `loadStrategyContext()` 중복 제거, `contentGenerator.js`에서 import

### 보류 (추후 확인)
- [ ] **re-export 함수 정리** — `src/telegram/index.js`의 `sendScheduledDraftX/IG/sendScheduledDraft` 외부 참조 여부 확인 후 정리
