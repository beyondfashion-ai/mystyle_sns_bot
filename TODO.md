# mystyle_sns_bot 개선사항 TODO

## 높은 우선순위 (High)

### 이미지 생성 재시도 로직
- `src/imageGen.js` — `generateImageForDraft()` 실패 시 재시도 로직 없음
- fal.ai 일시 장애에 대한 1~2회 재시도 추가 필요

### Firestore 상태 복구 실패 처리 강화
- `src/telegram/index.js:39-45` — 복구 실패해도 봇이 계속 동작하여 상태 불일치 가능
- 복구 실패 시 관리자에게 알림 전송 또는 봇 기능 제한 고려

### Draft 객체 인터페이스 명확화
- `state.js`, `contentGenerator.js`, `scheduled.js` 등에서 draft 구조가 제각각
- 공통 draft 생성 헬퍼 함수 또는 JSDoc typedef 정의 필요

### Draft TTL 정리와 editMode 충돌
- `src/telegram/state.js:140-146` — 수정 모드 중 TTL 정리가 발동하면 참조 오류 가능
- editMode 활성 draft는 TTL 정리에서 제외하는 로직 필요

---

## 중간 우선순위 (Medium)

### Puppeteer 브라우저 풀 최적화
- `src/cardNews.js` — 슬라이드마다 브라우저를 새로 열고 닫는 비효율
- 브라우저 인스턴스를 재사용하는 풀 패턴 도입 필요

### 로깅 표준화
- console.log/warn/error가 혼재 — 표준화된 로깅 레벨 도입
- error 로깅 시 `err.stack` 포함하도록 통일

### 중앙 집중식 상수/설정 파일
- KST offset (`9 * 60 * 60 * 1000`), 매직 넘버 등이 여러 파일에 반복
- `src/config.js` 같은 중앙 설정 파일로 추출

### 환경변수 검증 통합
- `server.js`에서만 검증, 나머지 파일은 `process.env.KEY` 직접 접근
- 앱 시작 시 필수 환경변수 일괄 검증 유틸리티 추가

### 콘텐츠 캘린더 포맷 키 불일치
- `contentGenerator.js`에 15개 포맷, `contentCalendar.js`에는 10개만 배치
- 미사용 포맷(`mv_analysis` 등) 정리 또는 캘린더에 추가

---

## 낮은 우선순위 (Low / 기술 부채)

### 프롬프트 인젝션 방어
- `src/contentGenerator.js:196` — 외부 데이터(trendPrompt, externalPrompt)가 직접 프롬프트에 삽입
- 외부 데이터 이스케이프 또는 별도 시스템 프롬프트로 분리 고려

### 타임아웃 설정 매개변수화
- `src/cardNews.js:51` — Puppeteer `waitUntil: 'networkidle0'` timeout 15초 고정
- 복잡한 슬라이드에서 실패 가능, 설정 가능한 파라미터로 변경

### Firebase 연결 상태 에러 표면화
- 다수 파일에서 `if (!db) return;`만 하고 사용자에게 명확한 피드백 없음
- Firebase 미연결 시 구체적인 에러 메시지 반환

### 프롬프트 조립 로직 중복
- `aiBrainstorm.js`, `contentGenerator.js` 양쪽에서 전략서 로딩+에디토리얼 방향 가져오기 중복
- 공통 컨텍스트 빌더 함수로 추출 가능

### re-export 함수 사용 여부 확인
- `src/telegram/index.js:76` — `sendScheduledDraftX`, `sendScheduledDraftIG`, `sendScheduledDraft` re-export
- 실제 외부 호출처가 있는지 확인 후 미사용 시 정리
