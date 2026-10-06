import { budgetTicket, breakeven, outcome, money, signed, centsUp, dayLabel, sliderStep } from '../../frontend/src/lib/questions.js';

// The prototype bundles only these pure calculations. All prices and context are illustrative.
const ASSETS = __PROTOTYPE_ASSETS__;
const icons = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20.2 14.3A8.5 8.5 0 0 1 9.7 3.8 8.5 8.5 0 1 0 20.2 14.3Z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6.5 4h11v17L12 17l-5.5 4Z"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>',
  higher: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 12 9-9M5 3h7v7"/></svg>',
  lower: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 4 9 9M5 13h7V6"/></svg>',
  next: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg>',
};
const names = { BTC: 'Bitcoin', ETH: 'Ethereum', HYPE: 'Hyperliquid', ZEC: 'Zcash' };
const specs = {
  BTC: { min: .01, step: .00001, base: .5, taker: .0003, cap: .125 },
  ETH: { min: .1, step: .0001, base: .5, taker: .0003, cap: .125 },
  HYPE: { min: 10, step: 1, base: .5, taker: .0003, cap: .125 },
  ZEC: { min: .1, step: .0001, base: .5, taker: .0003, cap: .125 },
};
const raw = [
  ['BTC', '20261008', 86000, 82000, 90000, .55, .49, 86207, ['Leaning up', 'Balanced', 'Upward tone']],
  ['ETH', '20261008', 2700, 2500, 2900, .46, .61, 2722, ['Base forming', 'Net long', 'Upward tone']],
  ['HYPE', '20261008', 70, 63, 77, .39, .68, 69.12, ['Leaning up', 'Net long', 'Balanced']],
  ['ZEC', '20261008', 1300, 1200, 1400, .58, .49, 1323.5, ['Base forming', 'Balanced', 'Upward tone']],
  ['BTC', '20261009', 90000, 86000, 94000, .32, .73, 86207, ['Leaning up', 'Balanced', 'Upward tone']],
  ['ETH', '20261009', 2800, 2600, 3000, .36, .70, 2722, ['Base forming', 'Net long', 'Upward tone']],
];
const rows = raw.map(([coin, expiry, k, lo, hi, yes, no, index, context]) => {
  const width = hi - lo;
  const side = (price, kind) => ({ buy: price, state: 'open', size: 20000, form: 'debit', legs: [[`${coin}-${expiry}-${kind}-A`, 'buy', width * (price + .12)], [`${coin}-${expiry}-${kind}-B`, 'sell', width * .12]] });
  return { id: `${coin}-${expiry}-${k}`, coin, expiry, context, board: { index, spec: specs[coin] }, level: { k, lo, hi, state: 'open', yes: side(yes, 'C'), no: side(no, 'P') } };
});
const state = { coin: 'all', expiry: 'all', following: false, follows: new Set(), context: new Set(), budget: 100, selected: null, side: 'yes', ticketBudget: 100, ticketDraft: '100', settle: null, review: false };
const $ = (selector) => document.querySelector(selector);
const tradeDialog = $('#trade-dialog');
const helpDialog = $('#help-dialog');
let previousOverflow = '';
const dollars = n => money(n, { cents: true });
const percent = t => `${((t.payout - t.mostLose) / t.mostLose * 100).toFixed(1)}%`;
const getTicket = (row, side, budget = state.budget) => budget == null ? null : budgetTicket(row.level, side, budget, row.board);
const validTicket = t => t && !t.belowMin && t.payout > 0;
const minimumAmount = t => dollars(Math.ceil((t?.minTotal || 0) * 100 - 1e-7) / 100);
const condition = (row, side) => side === 'yes' ? `Full payout from ${money(row.level.hi)}` : `Full payout at or below ${money(row.level.lo)}`;
const amountError = 'Enter an amount from $1 to $10,000, with up to 2 decimal places.';
function readAmount(value) {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 10000 ? number : null;
}
function setAmountError(input, errorElement, invalid) {
  input.setAttribute('aria-invalid', String(invalid));
  errorElement.hidden = !invalid;
  errorElement.textContent = invalid ? amountError : '';
}
function setPresetStates(container, budget) {
  container.querySelectorAll('[data-amount]').forEach(button => {
    const active = Number(button.dataset.amount) === budget;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function sideTile(row, side) {
  const t = getTicket(row, side), valid = validTicket(t), direction = side === 'yes' ? icons.higher : icons.lower, label = side === 'yes' ? 'Higher' : 'Lower';
  const unavailable = state.budget == null ? 'Set an amount' : `From ${minimumAmount(t)}`;
  return `<button class="answer ${side}" data-id="${row.id}" data-side="${side}" ${valid ? '' : 'disabled'} aria-label="${row.coin} ${label} than ${money(row.level.k)} on ${dayLabel(row.expiry)}${valid ? `, maximum profit ${dollars(t.payout - t.mostLose)}, ${condition(row, side)}` : `, ${unavailable}`}" aria-haspopup="dialog">
    <span class="answer-label"><span><span class="direction" aria-hidden="true">${direction}</span> ${label}</span><span class="quote" title="Price per $1 of maximum payout">${centsUp(row.level[side].buy)}c</span></span>
    ${valid ? `<span class="profit-label">Maximum profit</span><span class="max-profit" style="--digits:${signed(t.payout - t.mostLose).length}">${signed(t.payout - t.mostLose)}</span><span class="return-row"><span>+${percent(t)} return</span><span class="open-arrow">${icons.next}</span></span><span class="actual-cost">On ${dollars(t.mostLose)} cost, incl. fees</span>` : `<span class="profit-label">Amount needed</span><span class="minimum-profit">${unavailable}</span><span class="answer-unavailable-note">Fees included</span>`}
    <span class="full-threshold">${condition(row, side)}</span>
  </button>`;
}
function renderCards() {
  const filtered = rows.filter(row => (state.coin === 'all' || row.coin === state.coin) && (state.expiry === 'all' || row.expiry === state.expiry) && (!state.following || state.follows.has(row.id)));
  $('#result-count').textContent = `${filtered.length} outcome${filtered.length === 1 ? '' : 's'}`;
  $('#outcomes').innerHTML = filtered.map(row => {
    const followed = state.follows.has(row.id), expanded = state.context.has(row.id);
    return `<article class="outcome-card" aria-labelledby="question-${row.id}">
      <div class="card-content"><div class="card-head"><div class="asset"><img src="${ASSETS[row.coin]}" alt=""><div><div class="asset-name">${names[row.coin]}</div><div class="asset-code">${row.coin} <span aria-hidden="true">·</span> ${money(row.board.index)} now</div></div></div><div class="settlement"><strong>${dayLabel(row.expiry)}</strong><br>08:00 UTC</div></div>
      <h2 id="question-${row.id}" class="card-question">Higher or lower than <span class="level">${money(row.level.k)}?</span></h2>
      <div class="range-row"><span>Partial payout: ${money(row.level.lo)}–${money(row.level.hi)}</span><button class="info-button" data-help aria-label="How partial payouts work" aria-haspopup="dialog"><span class="info-symbol" aria-hidden="true">i</span></button></div><div class="side-grid">${sideTile(row, 'yes')}${sideTile(row, 'no')}</div></div>
      <div class="card-footer"><button class="follow-button" data-follow="${row.id}" aria-pressed="${followed}" aria-label="${followed ? 'Unfollow' : 'Follow'} ${row.coin} ${money(row.level.k)} on ${dayLabel(row.expiry)}">${icons.bookmark}<span>${followed ? 'Following' : 'Follow'}</span></button><button class="context-details text-button" data-context="${row.id}" aria-expanded="${expanded}" aria-controls="context-${row.id}">Market context ${icons.chevron}</button></div>
      <div id="context-${row.id}" class="context-panel" ${expanded ? '' : 'hidden'}><div class="context-grid">${row.context.map((reading, i) => `<div class="context-reading"><span>${['Regime', 'Wallets', 'Options'][i]}</span><span class="${reading === 'Balanced' ? '' : 'up'}">${reading}</span></div>`).join('')}</div><div class="context-bottom"><span>Illustrative context · Not advice</span><a href="https://cowboy.trading/coin/${row.coin}" target="_blank" rel="noopener noreferrer">Explore ${row.coin} ${icons.higher}</a></div></div>
    </article>`;
  }).join('');
  $('#empty-state').hidden = filtered.length > 0;
  $('#empty-state').textContent = state.following ? 'Nothing here yet. Follow an outcome to keep it in view.' : 'No outcomes for this date and coin. Choose another filter.';
  $('#follow-count').textContent = String(state.follows.size);
  document.querySelectorAll('[data-coin]').forEach(button => {
    const active = !state.following && button.dataset.coin === state.coin;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#following-tab').classList.toggle('active', state.following);
  $('#following-tab').setAttribute('aria-pressed', String(state.following));
}
function openDialog(dialog) {
  if (!tradeDialog.open && !helpDialog.open) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  dialog.showModal();
}
function closeDialog(dialog) {
  dialog.close();
}
function releaseScroll() {
  if (!tradeDialog.open && !helpDialog.open) document.body.style.overflow = previousOverflow;
}
function help() { if (!helpDialog.open) openDialog(helpDialog); }
function trade(row, side) {
  state.selected = row; state.side = side; state.ticketBudget = state.budget ?? 100; state.ticketDraft = $('#compare-amount').value; state.settle = side === 'yes' ? row.level.hi : row.level.lo; state.review = false;
  renderTrade(); openDialog(tradeDialog);
}
function renderTrade() {
  const row = state.selected, side = state.side;
  $('#drawer-mode').textContent = state.review ? 'Review preview' : 'Your outcome';
  if (state.review) { renderReview(); return; }
  $('#trade-content').innerHTML = `<div class="ticket-content" data-side="${side}">
    <div class="ticket-asset"><img src="${ASSETS[row.coin]}" alt=""><strong>${names[row.coin]}</strong><span class="date">${dayLabel(row.expiry)} · 08:00 UTC</span></div>
    <h2 id="trade-title" class="ticket-title"><span class="selected-side">${side === 'yes' ? 'Higher' : 'Lower'}</span> than ${money(row.level.k)}</h2><p class="ticket-range">Partial payout between ${money(row.level.lo)} and ${money(row.level.hi)}.</p>
    <div class="side-switch" role="group" aria-label="Selected answer"><button class="yes" data-ticket-side="yes" aria-pressed="${side === 'yes'}">${icons.higher} Higher</button><button class="no" data-ticket-side="no" aria-pressed="${side === 'no'}">${icons.lower} Lower</button></div>
    <div class="ticket-amount"><label for="ticket-amount">Your amount <span class="muted">· fees included</span></label><div class="amount-field"><span aria-hidden="true">$</span><input id="ticket-amount" type="text" inputmode="decimal" maxlength="10" autocomplete="off" aria-describedby="ticket-error"></div><div class="amount-presets" role="group" aria-label="Trade amounts"><button data-ticket-amount="100">$100</button><button data-ticket-amount="250">$250</button><button data-ticket-amount="500">$500</button></div><p id="ticket-error" class="field-error" aria-live="polite" hidden></p></div>
    <div id="ticket-figures" aria-live="polite"></div>
  </div>`;
  $('#ticket-amount').value = state.ticketDraft;
  updateTradeFigures();
}
function updateTradeFigures() {
  const row = state.selected, side = state.side, t = getTicket(row, side, state.ticketBudget);
  setAmountError($('#ticket-amount'), $('#ticket-error'), state.ticketBudget == null);
  document.querySelectorAll('[data-ticket-amount]').forEach(button => {
    const active = Number(button.dataset.ticketAmount) === state.ticketBudget;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (!validTicket(t)) {
    $('#ticket-figures').innerHTML = `<div class="unavailable-ticket"><h3>${state.ticketBudget == null ? 'Set your amount' : `Minimum ${minimumAmount(t)}`}</h3><p>${state.ticketBudget == null ? 'Enter an amount to see the payout.' : 'This outcome needs a larger amount at these illustrative prices.'}</p></div><div class="ticket-actions"><button class="primary-button" disabled>Review trade</button><p class="preview-caption">Design preview · Orders are disabled</p></div>`;
    return;
  }
  const w = row.level.hi - row.level.lo, min = Math.max(0, row.level.lo - w * .5), max = row.level.hi + w * .5;
  $('#ticket-figures').innerHTML = `<div class="ticket-hero"><div class="hero-label">Maximum profit</div><div class="hero-profit" style="--digits:${signed(t.payout - t.mostLose).length}">${signed(t.payout - t.mostLose)}</div><div class="hero-return">+${percent(t)} return on your cost</div><div class="hero-condition">${condition(row, side)}.<br>Less inside the partial-payout range.</div></div>
    <div class="ticket-breakdown"><div class="breakdown-row"><span>Total payout, at most</span><strong>${dollars(t.payout)}</strong></div><div class="breakdown-row"><span>Your cost, fees included</span><strong>${dollars(t.mostLose)}</strong></div><div class="breakdown-row risk"><span>Most you can lose</span><strong>${dollars(t.mostLose)}</strong></div></div>
    ${Math.abs(t.mostLose - state.ticketBudget) >= .005 ? `<p class="rounding-note">${dollars(state.ticketBudget - t.mostLose)} stays unspent after sizing to the available amount step${t.capped ? ' and available size' : ''}.</p>` : ''}
    <section class="settlement-study" aria-label="Settlement payout explorer"><div class="study-title"><h3>What if ${row.coin} settles at…</h3><button data-help class="info-button" aria-label="How settlement payouts work"><span class="info-symbol" aria-hidden="true">i</span></button></div><label class="settle-label" for="settle-slider"><span>Settlement price</span><output id="settle-value"></output></label><input id="settle-slider" class="settle-slider" type="range" min="${min}" max="${max}" step="${sliderStep(w)}" value="${state.settle}" aria-describedby="breakeven-note"><div class="slider-limits"><span>${money(min)}</span><span>${money(max)}</span></div><div class="study-results" aria-live="polite"><div><span>Total back</span><strong id="study-payout"></strong></div><div><span>Profit / loss</span><strong id="study-profit"></strong></div></div><div class="study-examples" role="group" aria-label="Example settlements"><button data-settle="zero">Zero payout</button><button data-settle="partial">Partial payout</button><button data-settle="full">Full payout</button></div><p id="breakeven-note" class="breakeven-note">You break even at ${money(breakeven(t, row.level, side))}, after fees.</p></section>
    <div class="ticket-actions"><button id="review-trade" class="primary-button">Review trade ${icons.next}</button><p class="preview-caption">Design preview · Orders are disabled</p></div>`;
  // The range input may snap a new initial value to its step; calculate from the visible value.
  state.settle = Number($('#settle-slider').value);
  updateStudy();
}
function updateStudy() {
  const row = state.selected, t = getTicket(row, state.side, state.ticketBudget);
  if (!validTicket(t) || !$('#settle-value')) return;
  const result = outcome(t, row.level, state.side, state.settle);
  $('#settle-value').textContent = money(state.settle);
  $('#settle-slider').setAttribute('aria-valuetext', `${money(state.settle)}, total back ${dollars(result.payout)}, profit or loss ${signed(result.pl)}`);
  $('#study-payout').textContent = dollars(result.payout);
  $('#study-profit').textContent = signed(result.pl);
  $('#study-profit').className = result.pl >= 0 ? 'positive' : 'negative';
  const fraction = result.payout / t.payout;
  document.querySelectorAll('[data-settle]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settle === 'zero' ? fraction === 0 : button.dataset.settle === 'full' ? fraction === 1 : fraction > 0 && fraction < 1)));
}
function renderReview() {
  const row = state.selected, side = state.side, t = getTicket(row, side, state.ticketBudget);
  $('#trade-content').innerHTML = `<div class="ticket-content" data-side="${side}"><div class="ticket-asset"><img src="${ASSETS[row.coin]}" alt=""><strong>${names[row.coin]}</strong><span class="date">${dayLabel(row.expiry)} · 08:00 UTC</span></div><h2 id="trade-title" class="review-heading">Review your outcome.</h2><div class="review-summary"><h3>${side === 'yes' ? 'Higher' : 'Lower'} than ${money(row.level.k)}</h3><p class="ticket-range">${condition(row, side)}. Pays in part inside ${money(row.level.lo)}–${money(row.level.hi)}.</p><div class="ticket-breakdown"><div class="breakdown-row"><span>Your cost, fees included</span><strong>${dollars(t.mostLose)}</strong></div><div class="breakdown-row"><span>Maximum profit</span><strong>${signed(t.payout - t.mostLose)}</strong></div><div class="breakdown-row"><span>Total payout, at most</span><strong>${dollars(t.payout)}</strong></div><div class="breakdown-row risk"><span>Most you can lose</span><strong>${dollars(t.mostLose)}</strong></div></div></div><div class="review-note">This is an interactive design preview. Prices are illustrative; no wallet is connected and no order can be placed.</div><div class="ticket-actions"><button class="primary-button" id="finish-preview">Back to the Saloon</button><button class="back-button" id="edit-preview">← Edit amount or answer</button></div></div>`;
  // Move focus when the review step replaces the button that invoked it.
  $('#finish-preview').focus();
}

$('#outcomes').addEventListener('click', event => {
  const answer = event.target.closest('[data-side]');
  if (answer && !answer.disabled) { trade(rows.find(row => row.id === answer.dataset.id), answer.dataset.side); return; }
  const follow = event.target.closest('[data-follow]');
  if (follow) {
    const id = follow.dataset.follow; state.follows.has(id) ? state.follows.delete(id) : state.follows.add(id); renderCards();
    const replacement = document.querySelector(`[data-follow="${id}"]`); (replacement || $('#following-tab')).focus(); return;
  }
  const context = event.target.closest('[data-context]');
  if (context) {
    const id = context.dataset.context; state.context.has(id) ? state.context.delete(id) : state.context.add(id);
    const expanded = state.context.has(id); context.setAttribute('aria-expanded', String(expanded)); $(`#context-${id}`).hidden = !expanded; return;
  }
  if (event.target.closest('[data-help]')) help();
});
document.querySelectorAll('[data-coin]').forEach(button => button.addEventListener('click', () => { state.coin = button.dataset.coin; state.following = false; renderCards(); }));
$('#following-tab').addEventListener('click', () => { state.following = !state.following; state.coin = 'all'; renderCards(); });
$('#date-filter').addEventListener('change', event => { state.expiry = event.target.value; renderCards(); });
$('#compare-amount').addEventListener('input', event => {
  state.budget = readAmount(event.target.value); setAmountError(event.target, $('#amount-error'), state.budget == null); setPresetStates($('.comparison'), state.budget); renderCards();
});
document.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => {
  state.budget = Number(button.dataset.amount); $('#compare-amount').value = String(state.budget); setAmountError($('#compare-amount'), $('#amount-error'), false); setPresetStates($('.comparison'), state.budget); renderCards();
}));
tradeDialog.addEventListener('input', event => {
  if (event.target.id === 'ticket-amount') { state.ticketDraft = event.target.value; state.ticketBudget = readAmount(state.ticketDraft); updateTradeFigures(); }
  if (event.target.id === 'settle-slider') { state.settle = Number(event.target.value); updateStudy(); }
});
tradeDialog.addEventListener('click', event => {
  if (event.target.closest('.close-dialog') || event.target.closest('#finish-preview')) { closeDialog(tradeDialog); return; }
  const side = event.target.closest('[data-ticket-side]');
  if (side) { state.side = side.dataset.ticketSide; state.settle = state.side === 'yes' ? state.selected.level.hi : state.selected.level.lo; renderTrade(); $(`[data-ticket-side="${state.side}"]`).focus(); return; }
  const preset = event.target.closest('[data-ticket-amount]');
  if (preset) { state.ticketBudget = Number(preset.dataset.ticketAmount); state.ticketDraft = String(state.ticketBudget); $('#ticket-amount').value = state.ticketDraft; updateTradeFigures(); return; }
  const example = event.target.closest('[data-settle]');
  if (example) {
    const { lo, hi, k } = state.selected.level;
    state.settle = example.dataset.settle === 'partial' ? k : example.dataset.settle === 'full' ? (state.side === 'yes' ? hi : lo) : (state.side === 'yes' ? lo : hi);
    $('#settle-slider').value = String(state.settle); state.settle = Number($('#settle-slider').value); updateStudy(); return;
  }
  if (event.target.closest('#review-trade') && validTicket(getTicket(state.selected, state.side, state.ticketBudget))) { state.review = true; renderTrade(); return; }
  if (event.target.closest('#edit-preview')) { state.review = false; renderTrade(); $('#ticket-amount').focus(); return; }
  if (event.target.closest('[data-help]')) help();
});
$('#how-button').addEventListener('click', help);
$('#footer-how').addEventListener('click', help);
$('#help-done').addEventListener('click', () => closeDialog(helpDialog));
$('.close-help').addEventListener('click', () => closeDialog(helpDialog));
$('.close-dialog').innerHTML = icons.close;
$('.close-help').innerHTML = icons.close;
[tradeDialog, helpDialog].forEach(dialog => {
  dialog.addEventListener('close', releaseScroll);
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeDialog(dialog);
  });
});
function theme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-toggle').innerHTML = dark ? icons.sun : icons.moon;
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
}
$('#theme-toggle').addEventListener('click', () => theme(document.documentElement.dataset.theme !== 'dark'));
$('#footer-how').innerHTML = `Understand the payout ${icons.higher}`;
theme(false);
renderCards();
