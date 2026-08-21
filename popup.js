/* PokerNow Hand Alert - popup.js
 * 팝업 UI 의 동작:
 *   - 저장된 설정 불러와서 화면에 반영
 *   - 자주 쓰는 프리미엄 핸드 목록을 체크박스로 표시
 *   - 현재 감지된 핸드 표시
 *   - 바꾸는 즉시 chrome.storage.local 에 저장 (Save 버튼 없음)
 *
 * ※ 기본값은 defaults.js(PNHA) 한 곳에서만 정의한다.
 */

// 팝업에 표시할 "빠른 선택용" 핸드 (자주 쓰는 프리미엄 위주).
// 더 세밀한 169개 전체 설정은 옵션 페이지(13×13 matrix)에서.
const QUICK_HANDS = [
  'AA', 'KK', 'QQ', 'JJ', 'TT',
  'AKs', 'AKo', 'AQs', 'AQo', 'AJs',
  'KQs', 'KQo', 'JTs', 'ATs'
];

const el = (id) => document.getElementById(id);

let settings = PNHA.defaults();

/* 설정 불러오기 */
function load() {
  chrome.storage.local.get(['settings', 'currentHand'], (data) => {
    settings = PNHA.merge(data.settings);
    render();
    renderCurrentHand(data.currentHand);
  });
}

/* 화면 그리기 */
function render() {
  el('enabled').checked = settings.enabled;
  el('soundEnabled').checked = settings.soundEnabled;
  renderStatusText();
  renderAuto();

  // 팝업 목록에는 QUICK_HANDS + 이미 선택된(설정에 있는) 핸드를 합쳐서 보여줌
  const shown = Array.from(new Set([...QUICK_HANDS, ...settings.hands]));
  const list = el('handList');
  list.innerHTML = '';
  shown.forEach((hand) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = hand;
    cb.checked = settings.hands.includes(hand);
    cb.addEventListener('change', saveNow);   // 체크하는 즉시 저장
    const span = document.createElement('span');
    span.textContent = hand;
    label.appendChild(cb);
    label.appendChild(span);
    list.appendChild(label);
  });
}

function renderStatusText() {
  const on = settings.enabled;
  el('statusText').textContent = on ? 'ON' : 'OFF';
  el('statusText').classList.toggle('off', !on);
}

/* 자동 폴드 설정: 화면 반영 */
function renderAuto() {
  el('autoFold').checked = !!settings.autoFold;
  el('autoMode').value = settings.autoMode === 'turn' ? 'turn' : 'prefold';
  el('autoFoldDelay').value = String(settings.autoFoldDelay != null ? settings.autoFoldDelay : 1);
  el('autoCheckFree').checked = !!settings.autoCheckFree;
  el('autoPreflopOnly').checked = !!settings.autoPreflopOnly;
  el('autoSection').classList.toggle('on', !!settings.autoFold);
  el('gtoMode').checked = !!settings.gtoMode;
  el('gtoStreet').value = settings.gtoStreet === 'all' ? 'all' : 'preflop';
  el('gtoAggro').value = settings.gtoAggro === 'auto' ? 'auto' : 'manual';
  el('gtoSection').classList.toggle('on', !!settings.gtoMode);
}

/* 화면에 있는 값을 전부 읽는다 */
function readForm() {
  return {
    enabled: el('enabled').checked,
    soundEnabled: el('soundEnabled').checked,
    hands: Array.from(document.querySelectorAll('#handList input:checked')).map((cb) => cb.value),
    autoFold: el('autoFold').checked,
    autoMode: el('autoMode').value,
    autoFoldDelay: parseFloat(el('autoFoldDelay').value) || 0,
    autoCheckFree: el('autoCheckFree').checked,
    autoPreflopOnly: el('autoPreflopOnly').checked,
    gtoMode: el('gtoMode').checked,
    gtoStreet: el('gtoStreet').value,
    gtoAggro: el('gtoAggro').value
  };
}

/* 어떤 항목이든 바꾸면 바로 저장한다.
 * (예전엔 자동 폴드만 즉시 저장이고 ON/OFF·핸드는 Save 를 눌러야 했다.
 *  그래서 스위치만 만지고 팝업을 닫으면 화면과 실제 설정이 달라졌다.) */
function saveNow() {
  const form = readForm();
  // GTO 모드는 이제 자동 폴드와 별개로 동작한다 (예전엔 여기서 autoFold 를 몰래 켰는데,
  // 나중에 GTO 를 끄면 자동 폴드만 켜진 채 남아서 원치 않는 폴드가 나갔다)
  settings = Object.assign({}, settings, form);
  chrome.storage.local.set({ settings }, () => {
    renderStatusText();
    renderAuto();
    const msg = el('savedMsg');
    msg.textContent = '✓ 저장됨';
    clearTimeout(saveNow._t);
    saveNow._t = setTimeout(() => (msg.textContent = ''), 1200);
  });
}

/* 현재 감지된 핸드 표시 (컴팩트 바 + 내 차례 강조) */
function renderCurrentHand(current) {
  if (!current) {
    el('currentPretty').textContent = '-';
    el('currentHand').textContent = '';
    el('turnBadge').textContent = '대기중';
    el('handBar').classList.remove('my-turn');
    return;
  }
  el('currentPretty').textContent = current.pretty || '-';
  // 플롭 이후엔 완성된 족보를, 프리플롭엔 빈칸 (지저분한 핸드코드 제거)
  el('currentHand').textContent = current.made || '';
  el('currentHand').classList.toggle('allowed', !!current.allowed);

  const myTurn = !!current.myTurn;
  el('handBar').classList.toggle('my-turn', myTurn);
  el('turnBadge').textContent = myTurn ? '진행중' : '대기중';
}

// 팝업이 열려있는 동안 실시간 갱신 (content.js 가 storage 를 업데이트하면 반영)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.currentHand) renderCurrentHand(changes.currentHand.newValue);
  // 오버레이의 🤖 버튼으로 켜고 끈 것도 팝업에 반영
  if (changes.settings) {
    settings = PNHA.merge(changes.settings.newValue);
    renderStatusText();
    renderAuto();
  }
});

/* 이벤트 연결: 모든 입력이 같은 저장 경로를 쓴다 */
['enabled', 'soundEnabled', 'autoFold', 'autoMode', 'autoFoldDelay', 'autoCheckFree', 'autoPreflopOnly']
  .forEach((id) => el(id).addEventListener('change', saveNow));
['gtoMode', 'gtoStreet', 'gtoAggro']
  .forEach((id) => el(id).addEventListener('change', saveNow));

el('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// 열려있는 PokerNow 탭을 찾는다 (활성 탭이 아니어도 됨).
// host_permissions 덕분에 URL 패턴으로 탭을 조회할 수 있다.
// 여러 탭이면 "활성 탭"을 우선한다 (다른 탭에 폴드를 잘못 보내는 사고 방지).
function findPokerNowTab(callback) {
  const urls = [
    'https://*.pokernow.com/*',
    'https://pokernow.com/*',
    'https://*.pokernow.club/*',
    'https://pokernow.club/*'
  ];
  chrome.tabs.query({ url: urls }, (tabs) => {
    if (!tabs || !tabs.length) return callback(null);
    callback(tabs.find((t) => t.active) || tabs[0]);
  });
}

// 팝업이 열릴 때, PokerNow 탭에 "지금 다시 감지" 요청
function requestFreshDetect() {
  findPokerNowTab((tab) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'PING_DETECT' }, () => {
      void chrome.runtime.lastError; // content script 없으면 무시
    });
  });
}

/* 수동 Fold: 사용자가 버튼을 눌렀을 때만 PokerNow 탭의 Fold 버튼을 클릭시킨다.
 * (익스텐션이 스스로 판단해서 폴드하지 않는다 — 항상 사용자가 클릭.)
 * 내 차례가 아니면 PokerNow 의 "미리 폴드" 예약 ↔ 취소 토글이 된다. */
function setFoldMsg(text, cls) {
  const m = el('foldMsg');
  m.textContent = text;
  m.className = 'fold-msg' + (cls ? ' ' + cls : '');
}

el('foldBtn').addEventListener('click', () => {
  const btn = el('foldBtn');
  btn.disabled = true;
  setFoldMsg('폴드 시도 중...', '');

  findPokerNowTab((tab) => {
    if (!tab) {
      setFoldMsg('열려있는 PokerNow 탭이 없습니다.', 'err');
      btn.disabled = false;
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_FOLD' }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError) {
        setFoldMsg('PokerNow 페이지를 새로고침 해주세요.', 'err');
        return;
      }
      if (resp && resp.ok) {
        // 내 차례면 즉시 폴드, 아니면 예약/취소 토글
        setFoldMsg(resp.myTurn ? '✓ 폴드했습니다.'
          : (resp.armed ? '✓ 미리 폴드를 예약했습니다.' : '✓ 예약을 취소했습니다.'), 'ok');
        setTimeout(() => setFoldMsg('버튼 · F 키 · 오버레이 버튼', ''), 2000);
      } else {
        setFoldMsg('Fold 버튼을 못 찾음 (내 차례가 아니거나 셀렉터 수정 필요).', 'err');
      }
    });
  });
});

load();
requestFreshDetect();
