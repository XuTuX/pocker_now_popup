/* PokerNow Hand Alert - options.js
 * 13×13 스타팅 핸드 매트릭스를 생성하고, 선택 상태를 저장/불러온다.
 *
 * 표기 규칙 (포커 표준 그리드):
 *   - 랭크 순서: A K Q J T 9 8 7 6 5 4 3 2
 *   - 대각선     → 페어 (AA, KK, ...)
 *   - 대각선 위  → 수딧 (예: 행 A, 열 K → AKs)   [높은 랭크가 앞]
 *   - 대각선 아래→ 오프수딧 (예: 행 K, 열 A → AKo)
 *
 * ※ 기본값·랭크 목록은 defaults.js(PNHA) 한 곳에서만 정의한다.
 */

const RANKS = [...PNHA.RANKS_LOW_FIRST].reverse();   // A 부터 2 까지

const el = (id) => document.getElementById(id);

let selected = new Set();   // 현재 선택된 핸드 문자열들

/* 셀(행 i, 열 j)이 나타내는 핸드 문자열 계산 */
function handForCell(i, j) {
  const r1 = RANKS[i];
  const r2 = RANKS[j];
  if (i === j) return r1 + r2;                 // 페어
  if (i < j) return r1 + r2 + 's';             // 수딧: 행 랭크가 열 랭크보다 높음
  return r2 + r1 + 'o';                        // 오프수딧
}

/* 매트릭스 DOM 생성 */
function buildMatrix() {
  const table = el('matrix');
  table.innerHTML = '';

  // 헤더 행
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th')); // 좌상단 빈칸
  RANKS.forEach((r) => {
    const th = document.createElement('th');
    th.textContent = r;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  // 본문
  RANKS.forEach((rowRank, i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = rowRank;
    tr.appendChild(th);

    RANKS.forEach((colRank, j) => {
      const hand = handForCell(i, j);
      const td = document.createElement('td');
      td.textContent = hand;
      td.dataset.hand = hand;

      if (i === j) td.classList.add('pair');
      else if (i < j) td.classList.add('suited');
      else td.classList.add('offsuit');

      td.addEventListener('click', () => {
        if (selected.has(hand)) selected.delete(hand);
        else selected.add(hand);
        refreshSelection();
      });

      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

/* 선택 상태를 화면에 반영 */
function refreshSelection() {
  document.querySelectorAll('#matrix td').forEach((td) => {
    td.classList.toggle('selected', selected.has(td.dataset.hand));
  });
  el('count').textContent = `${selected.size} / 169 선택됨`;
}

/* 불러오기 */
function load() {
  chrome.storage.local.get('settings', (data) => {
    selected = new Set(PNHA.merge(data.settings).hands);
    buildMatrix();
    refreshSelection();
    const s = PNHA.merge(data.settings);
    el('gtoMode').checked = !!s.gtoMode;
    el('gtoStreetAll').checked = s.gtoStreet === 'all';
    el('gtoAggroAuto').checked = s.gtoAggro === 'auto';
  });
}

/* 저장 — 저장 직전에 최신 설정을 다시 읽어 hands 만 갈아끼운다.
 * (팝업을 같이 열어놓고 만졌을 때 옛 스냅샷으로 덮어쓰지 않도록) */
function save() {
  chrome.storage.local.get('settings', (data) => {
    const settings = Object.assign(PNHA.merge(data.settings), {
      hands: Array.from(selected),
      gtoMode: el('gtoMode').checked,
      gtoStreet: el('gtoStreetAll').checked ? 'all' : 'preflop',
      gtoAggro: el('gtoAggroAuto').checked ? 'auto' : 'manual'
    });
    chrome.storage.local.set({ settings }, () => {
      const msg = el('savedMsg');
      msg.textContent = '✓ 저장되었습니다';
      setTimeout(() => (msg.textContent = ''), 1600);
    });
  });
}

/* 다른 화면(팝업·오버레이)에서 핸드 목록이 바뀌면 따라간다 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  selected = new Set(PNHA.merge(changes.settings.newValue).hands);
  refreshSelection();
});

/* 툴바 버튼 */
el('selectPremium').addEventListener('click', () => {
  selected = new Set(PNHA.PREMIUM_DEFAULT);
  refreshSelection();
});
el('selectAll').addEventListener('click', () => {
  document.querySelectorAll('#matrix td').forEach((td) => selected.add(td.dataset.hand));
  refreshSelection();
});
el('clearAll').addEventListener('click', () => {
  selected.clear();
  refreshSelection();
});
el('saveBtn').addEventListener('click', save);

load();
