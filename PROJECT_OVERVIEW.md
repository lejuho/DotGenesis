# DotGenesis POC Overview

## 1) 프로젝트 목표
- Web2 기반 멀티플레이 POC에서 다음 4개를 빠르게 검증한다.
- `Daily Seed` 클릭으로 점 생성
- 캔버스/게이지 피드백
- 다른 유저 점 실시간 반영
- 라운드 단위 긴장감(Prep/Active/Rest + 결과)

## 2) 기술 구성
- 서버: `Express` + `Socket.io`
- 클라이언트: `Vanilla JS` + `Canvas`
- 실시간 동기화: Socket 이벤트 브로드캐스트

## 3) 파일 구조와 책임
- `server/index.js`
  - 정적 파일 서빙
  - 소켓 연결/입력 검증/점 브로드캐스트
  - 라운드 상태 머신(`prep -> active -> rest`)
  - Instability 계산, 즉시 종료(100%), 라운드 기록 생성
- `public/index.html`
  - 게임 UI 골격(캔버스, 버튼, faction 선택, 게이지, 타이머, 결과)
- `public/main.js`
  - UI 렌더링, 캔버스 점 표시, 버튼/쿨타임/사운드 처리
  - 서버 상태 반영(phase/round/time)
  - 소켓 이벤트 핸들링(`init`, `update`, `state`, `roundResult`, `resetPoints`)
- `public/style.css`
  - 레이아웃, 패널/버튼 스타일
  - Prep/Shake/Flash 애니메이션

## 4) 게임 규칙 핵심
- Faction 색상: 4개 고정
  - `#ff4d4d`, `#4da6ff`, `#4dff88`, `#ffd24d`
- Seed 쿨타임: 5초
- Instability 계산:
  - 최소 점수 미만(`15`)은 `0` (초반 보호)
  - 최대 점유율 `<= 60%`는 `0` (안전 구간)
  - `60%` 초과분만 0~100으로 스케일
- 즉시 종료 조건:
  - Active 중 Instability가 `100` 도달하면 라운드 즉시 종료

## 5) 라운드 상태 머신
- `prep` (기본 10초)
  - 입력 비활성화
  - 시각 효과(어두운 배경, 마지막 3초 경고)
- `active` (기본 10분)
  - 입력 허용
  - 점 생성/동기화/게이지 변동
  - 타이머 만료 또는 instability 100 시 종료
- `rest` (기본 60초, 개발 모드 10초 가능)
  - 결과 확인 구간
  - 입력 비활성화
- 다음 라운드로 자동 반복

## 6) 소켓 이벤트 계약
- 서버 -> 클라이언트
  - `init`: `{ points, state, history }`
  - `update`: `point`
  - `state`: `{ round, phase, phaseEndsAt, lastOutcome }`
  - `roundResult`: 라운드 요약 결과
  - `resetPoints`: 캔버스 초기화 신호
- 클라이언트 -> 서버
  - `addPoint`: `{ x, y, color }`

## 7) UX 흐름도
1. 접속
2. `init` 수신 -> 현재 보드/라운드 상태 렌더
3. Prep 구간
4. Active 시작
5. 유저가 faction 선택 후 `Daily Seed`
6. 로컬 쿨타임 시작(5초), 서버로 `addPoint`
7. 서버가 점 검증/저장 후 `update` 브로드캐스트
8. 모든 클라이언트 캔버스/instability 갱신
9. 종료 조건 확인
10. `roundResult` 표시 + Rest 진입
11. `resetPoints` 후 다음 Prep로 순환

## 8) 라운드 종료 시 저장/표시 데이터
- `peakInstability`
- `bestStableSeconds`
- `mostUsedColor`, `mostUsedCount`
- `totalPoints`
- `reason` (타이머 종료 / 과부하 종료)

## 9) 실행 방법
- 일반 실행
```bash
node server/index.js
```
- 개발용 빠른 Rest(10초)
```bash
FAST_REST=1 node server/index.js
```
- 접속: `http://localhost:3000`

## 10) 현재 범위와 다음 확장 포인트
- 현재 범위:
  - 멀티플레이 POC
  - 라운드 기반 심리/균형 게임플레이 검증
- 다음 확장:
  - 라운드 히스토리 UI 분리(최근 N개 표)
  - 라운드별 플레이어 기여도 지표
  - 음향/비주얼 단계 강화
