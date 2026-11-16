# Task-02 코드 리뷰 결과

- **검토 대상:** `task-02.diff`
- **명세 기준:** 구현 기준 v0.3 (§3.1~3.5), D-04
- **보고된 테스트 결과:** Vitest 47개 통과
- **검토 방식:** 제공된 diff 정적 분석. 코드 수정 및 테스트 재실행 없음.
- **발견 사항:** High 1건 / Med 2건 / Low 2건

## 발견 사항

### 1 / High / diff의 테스트 코드 구문 손상 및 실행 결과 불일치

**문제:** 제출된 `tests/beatTimeline.test.ts` diff에 문자열 종료 누락 및 주석과 코드가 합쳐진 부분이 존재한다. 제공된 diff 그대로라면 47개 테스트 통과 결과와 일치하지 않는다.

**근거:** `tests/beatTimeline.test.ts` diff 315행

```ts
// 1. 100BPM beat 4 = 2.4珥?+  it('100BPM beat 4 = 2.4珥?, () => {
```

해당 행에서는 `it()` 선언이 주석에 포함되어 있다. 다른 테스트 설명에도 인코딩 손상으로 보이는 문자가 포함되어 있다. 실제 저장소에도 존재한다면 테스트 파일 파싱 또는 실행이 정상적으로 이루어질 수 없다.

**권장 조치:** 저장소 원본과 제출된 diff를 대조하고 UTF-8 인코딩 및 diff 생성 과정을 확인한다. 원본 테스트 파일에서 실행한 결과인지 별도로 확인한다.

### 2 / Med / requestTempo가 실제 진행 상태를 검증하지 않아 미래 변경을 연속 예약할 수 있음

**문제:** `requestTempo()`는 전달받은 `currentBeat`를 실제 전투 진행 비트로 간주한다. 외부에서 미래 비트를 전달하면 첫 번째 템포 변경이 실제 적용되기 전에도 다음 변경을 예약할 수 있다.

**근거:** `src/core/beatTimeline.ts:231~255`

```ts
const currentBpm = this.getBpmAtBeat(currentBeat);
const lastSeg = this.segments[this.segments.length - 1];
if (lastSeg.startBeat > currentBeat) {
  return { scheduled: false, reason: 'pending' };
}
```

재현 시나리오:

```ts
const tl = new BeatTimeline(100);
tl.requestTempo(120, 6); // scheduled: true, applyAtBeat: 8
tl.requestTempo(140, 8); // scheduled: true, applyAtBeat: 12
```

실제 전투가 아직 beat 6에 머물러 있더라도 두 번째 호출에 `currentBeat=8`을 전달하면 승인된다. 호출자가 현재 비트를 정확히 보장하면 발생하지 않는 상태 소유권 및 외부 호출 계약의 취약점이다.

**권장 조치:** 실제 진행 비트의 신뢰성을 호출 계층에서 보장하고 미래 비트 요청 차단 책임을 명확히 한다. 규칙 변경이 필요하면 `docs/decisions.md`에서 승인받는다.

### 3 / Med / nearestBeat의 비정상 시간 입력 검증 누락

**문제:** `nearestBeat()`는 `NaN`, `Infinity`, `-Infinity`를 명시적으로 검증하지 않는다.

**근거:** `src/core/beatTimeline.ts:196~208`

```ts
const fractional = (t - seg.startTime) / dur + seg.startBeat;
const lo = Math.floor(fractional);
const tLo = this.beatTime(lo);
```

`nearestBeat(NaN)` 또는 `nearestBeat(Infinity)`는 `lo`가 유효하지 않은 비트 번호가 되어 `RangeError`가 발생한다. 반면 `-Infinity`는 음수 입력 분기로 인해 예외 없이 무한대 오차를 반환한다.

**권장 조치:** 입력 시간의 유효성 검증 책임을 정의하고 비정상 숫자 입력 테스트를 추가한다. 예외 처리 동작을 임의로 확정하지 않는다.

### 4 / Low / 세그먼트 경계 양방향 테스트 누락

**문제:** 현재 테스트는 beat 7과 8의 정확한 중간값을 검증하지만, 중간값 직전과 직후가 서로 다른 비트로 배정되는지는 검증하지 않는다.

**근거:** `tests/beatTimeline.test.ts:341~350`

현재 검증:

```ts
tl.nearestBeat(4.5); // beat 7
```

추가 검증이 필요한 입력:

| 입력 시간 | 예상 비트 |
|---|---|
| 4.499초 | 7 |
| 4.500초 | 7 |
| 4.501초 | 8 |
| 4.799초 | 8 |
| 4.800초 | 8 |
| 4.801초 | 8 |

EPS 허용 범위 양쪽과 120→140 BPM 경계도 검증하지 않았다.

**권장 조치:** 경계 직전·정확한 경계·직후 및 EPS 양방향 사례를 테스트에 추가한다.

### 5 / Low / 요청 실패 원인의 우선순위가 문서화되지 않음

**문제:** `requestTempo()`는 `at_max → pending → invalid_step` 순서로 판정한다. 여러 거절 조건이 동시에 성립할 때의 우선 반환 사유는 명세에 명확히 정의되지 않았다.

**근거:** `src/core/beatTimeline.ts:233~245`

| 상황 | 반환 |
|---|---|
| 100 BPM, 120 예약 대기 중 140 요청 | `pending` |
| 100 BPM, 예약 없음, 140 요청 | `invalid_step` |
| 140 BPM에서 추가 요청 | `at_max` |

현재 세그먼트 생성 방식과 정상적인 `currentBeat` 진행을 전제로 `at_max`와 `pending`이 동시에 성립하는 반례는 확인되지 않았다. 따라서 현재 순서의 확정적인 구현 오류는 발견되지 않았다.

**권장 조치:** 반환 사유의 우선순위를 API 계약으로 문서화하고 향후 예약 방식 변경 시 회귀 테스트로 검증한다.

## 중점 확인 결과

| 검토 항목 | 결과 |
|---|---|
| 템포 경계 전후 `beatTime` | 정상 |
| 템포 경계 전후 `nearestBeat` | 정상 |
| 서로 다른 세그먼트의 floor/ceil 후보 | 정상 |
| D-04 EPS 중간값 처리 | 현재 구현 정상 |
| pending/at_max/invalid_step 순서 | 확정적인 로직 오류 없음 |
| 테스트 누락 경계 케이스 | 추가 검증 필요 |

`beatTime()`은 새 세그먼트 시작 시각을 기존 시간표로 계산해 beat 8에서 시간 연속성을 유지한다. `nearestBeat()`도 `lo`, `hi`의 실제 시각을 각각 `beatTime()`으로 계산하므로 세그먼트 경계를 가로지르는 비교가 올바르게 이루어진다.

D-04의 `MIDPOINT_EPS_SEC = 1e-9`는 중간값 부근에서 이전 비트를 선택한다. 정확한 중간값보다 미세하게 늦은 시각도 허용 범위 내라면 이전 비트를 선택하는데, 이는 D-04의 허용 오차 규칙에 따른 동작이다.

## 최종 판정

**핵심 시간표 및 비트 배정 계산에서 확정적인 로직 오류는 발견되지 않았다.**

다만 제출된 diff의 구문 손상 여부를 우선 확인해야 한다. 단순한 diff 추출 과정의 인코딩 문제라면 실제 코드 결함으로 간주하지 않아야 한다.

나머지 주요 위험은 `requestTempo()` 호출자의 상태 신뢰성과 입력 유효성 검증이다. 테스트 47개 통과만으로 해당 조건들이 보장된다고 판단할 수 없다.

**권장 확인 순서:** 원본 diff 무결성 확인 → 미래 비트 호출 계약 검증 → 비정상 시간 입력 검증 → 세그먼트·EPS 경계 테스트 보강.

> 코드 및 명세 수치는 변경하지 않았다.
