# PokerNow Hand Alert 🂡

PokerNow 테이블에서 **내 홀카드 2장을 읽어**, 화면 위 **오버레이 패널(HUD)** 로
현재 패 · 프리미엄 여부 · 내 차례 · 콜 정보를 항상 보여주는 개인용 Chrome 확장입니다.

> ⚠️ **게임 버튼을 자동으로 누르지 않습니다.** Fold 는 내가 **직접**
> (오버레이 버튼 / `F` 키 / 팝업 버튼) 눌렀을 때만 실행됩니다.
> 별도 서버 없이 100% 로컬, 외부 전송 없음.

---

## 1. 무엇을 하나요?

- 내 홀카드를 감지해 `AA` `AKs`(수딧) `AKo`(오프수딧) 처럼 정규화 (랭크: `2 3 4 5 6 7 8 9 T J Q K A`)
- **화면 오버레이 패널**에 항상 표시:
  - 현재 패 (예: `A♠ K♥` / `AKo`), ♥♦는 빨간색
  - **프리미엄 핸드**면 초록 강조 + 알림음
  - **내 차례**면 주황 강조 + `콜 10 · 0.5 BB` (콜 금액과 몇 BB인지)
  - 폴드해서 죽으면 카드를 지우고 `🃏 폴드함`
- **⧉ 팝아웃**: 패널을 Picture-in-Picture 창으로 빼면 **다른 탭·창·앱 위에도** 계속 떠 있음
- 기본 프리미엄: `AA` `KK` `QQ` `JJ` `AKs` `AKo` (팝업/옵션에서 자유롭게 변경)

---

## 2. 파일 구조

```text
PokerNow-Hand-Alert/
├── manifest.json   # MV3 설정 (권한: storage 만)
├── content.js      # ★핵심★ 카드 감지·정규화·오버레이·콜계산·수동폴드·알림음
├── popup.html/js/css     # 툴바 팝업 (ON/OFF, 프리미엄 핸드 선택, 수동 Fold)
├── options.html/js/css   # 13×13 스타팅 핸드 매트릭스
├── icon128.png
└── README.md
```

거의 모든 로직은 [content.js](content.js) 한 파일에 있습니다.

---

## 3. 설치 (Load unpacked)

1. `PokerNow-Hand-Alert` 폴더를 저장
2. Chrome 주소창에 `chrome://extensions`
3. 우측 상단 **Developer mode** 켜기
4. **Load unpacked** → `PokerNow-Hand-Alert` 폴더 선택
5. PokerNow 게임 접속 → 화면 우측에 `♠ Hand Alert` 패널이 뜸

> 코드/manifest 를 수정한 뒤에는 **확장 새로고침(↻) + PokerNow 탭 F5** 를 꼭 같이 해주세요.

---

## 4. 사용법

- **오버레이 패널**: 헤더를 드래그해 이동, `–` 로 접기, `⧉` 로 팝아웃(항상-위 창).
- **Fold 하기**: 3가지 방법 — ①오버레이의 Fold 버튼 ②PokerNow 화면에서 `F` 키
  ③팝업의 Fold 버튼(다른 탭에 있어도 됨). 모두 **내가 직접** 눌러야 실행됩니다.
- **팝업(툴바 아이콘)**: 전체 ON/OFF, 프리미엄 핸드 체크, 알림음 on/off, 현재 패 표시.
- **옵션 페이지**: 13×13 표에서 알림 대상 핸드를 자유롭게 지정 (대각선=페어, 위=수딧, 아래=오프수딧).

---

## 5. 감지가 안 될 때 (셀렉터 수정)

PokerNow HTML 이 바뀌면 [content.js](content.js) 상단의 셀렉터만 고치면 됩니다.

1. 게임 화면 **F12 → Elements**, 내 홀카드/버튼을 **우클릭 → 검사**
2. 실제 class 를 확인해 아래 배열 **맨 위**에 추가:
   - `HERO_CONTAINER_SELECTORS` — 내 자리 컨테이너
   - `CARD_SELECTORS` — 카드 요소
   - `FOLD_BUTTON_SELECTORS` — Fold 버튼
   - `BLIND_SELECTORS` — 블라인드 표시(콜 BB 계산용)
3. `chrome://extensions` **새로고침(↻)** + 게임 탭 **F5**

**디버그 로그**: `content.js` 최상단 `DEBUG = true` 면 콘솔에 `[PokerAlert]` 로그가 출력됩니다.
현재 PokerNow 구조 기준값: 내 자리 `.table-player.you-player`, 카드 `.card-container`
(클래스 `card-s-<랭크>` + `card-<무늬>`), Fold `.action-button.fold`, 블라인드 `.blind-value`.

---

## 6. 권한 & 보안 (최소 권한)

| 권한 | 이유 |
|------|------|
| `storage` | 선택한 핸드·설정을 로컬 저장 (`chrome.storage.local`) |
| `host_permissions: pokernow.club / pokernow.com` | **PokerNow 페이지에서만** 동작. 다른 사이트 접근 불가 |

- 데스크톱 알림/백그라운드 워커를 쓰지 않아 `notifications` 권한이 **필요 없습니다.**
- 네트워크 전송 없음, 자동 플레이 없음, 계정/결제 정보 다루지 않음.
- 사이트 이용약관은 각자 확인하세요. 개인 학습·연습 용도로 사용하시길 권합니다.
