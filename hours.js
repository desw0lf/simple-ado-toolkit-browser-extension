// Hours modal: a floating button that opens a per-sprint view of the Actual hours
// you saved each day, computed from work item history.
// Runs after content.js and reuses its `api`, `settings` and `getIdentity`.
(() => {
  if (window !== window.top) return;

  const ACTUAL_FIELD_NAME = 'actual hours';
  const CONCURRENCY = 6;

  // Firefox content-script fetch runs with the extension's origin, so call the page's own fetch
  // (the init object must be cloned into the page realm). Chrome's fetch already uses the page's.
  const pageWindow = window.wrappedJSObject;
  const pageFetch = pageWindow && typeof cloneInto === 'function'
    ? (url, init) => pageWindow.fetch(url, cloneInto(init, pageWindow))
    : fetch;

  const cache = {
    field: '', sprints: new Map(), capacity: new Map(), wiql: new Map(), updates: new Map(), titles: new Map(),
  };
  const state = { sprints: [], index: 0, note: '', data: null, capacity: null, selected: '', error: '', req: 0 };

  // --- Dates (all local, day precision) ---

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfDay = (d) => addDays(d, 0);
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const isWeekday = (d) => d.getDay() % 6 !== 0;
  const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDay = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${pad(d.getDate())}`;
  // Sprint dates come as midnight UTC; take the calendar date as-is.
  const parseDay = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const fmtH = (n) => `${+n.toFixed(2)}h`;
  const fmtTotal = (total, target) => (target ? `${fmtH(total)} / ${fmtH(target)}` : fmtH(total));
  const fmtDelta = (n) => (n > 0 ? '+' : '−') + fmtH(Math.abs(n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // --- ADO API ---

  function urlParts() {
    const [, org = '', project = ''] = location.pathname.split('/').map(decodeURIComponent);
    return { org, project: project.startsWith('_') ? '' : project };
  }

  async function ado(path, init = {}) {
    const res = await pageFetch(`${location.origin}/${encodeURIComponent(urlParts().org)}/${path}`, {
      credentials: 'include',
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`);
    return res.json();
  }

  async function pool(items, n, fn) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) await fn(items[i++]);
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  }

  async function actualField() {
    if (!cache.field) {
      const { value } = await ado('_apis/wit/fields?api-version=7.1');
      const field = value.find((f) => f.name.toLowerCase() === ACTUAL_FIELD_NAME);
      if (!field) throw new Error('No "Actual hours" field found');
      cache.field = field.referenceName;
    }
    return cache.field;
  }

  async function myId() {
    const id = GUID_RE.test(settings.identityId) ? settings.identityId : (await getIdentity()).id;
    return id.toLowerCase();
  }

  function teamFromUrl() {
    const m = location.pathname.match(/\/_(?:sprints\/[^/]+|boards\/board\/t|backlogs\/backlog)\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function loadSprints(project) {
    const p = encodeURIComponent(project);
    const team = settings.team || teamFromUrl()
      || (await ado(`_apis/projects/${p}?api-version=7.1`)).defaultTeam.name;
    const key = `${project}/${team}`;
    if (!cache.sprints.has(key)) {
      const base = `${p}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations`;
      const { value } = await ado(`${base}?api-version=7.1`);
      cache.sprints.set(key, value
        .filter((it) => it.attributes?.startDate && it.attributes?.finishDate)
        .map((it) => ({
          name: it.name,
          url: `${base}/${it.id}`,
          start: parseDay(it.attributes.startDate),
          end: parseDay(it.attributes.finishDate),
        }))
        .sort((a, b) => a.start - b.start));
    }
    return cache.sprints.get(key);
  }

  // My capacity for a sprint: { perDay, daysOff: Set(dayKey) } including team days off.
  // perDay is 0 when I'm not in the team's capacity list.
  async function loadCapacity(sprint) {
    if (!cache.capacity.has(sprint.url)) {
      const [mine, team] = await Promise.all([
        ado(`${sprint.url}/capacities/${await myId()}?api-version=7.1`).catch(() => null),
        ado(`${sprint.url}/teamdaysoff?api-version=7.1`).catch(() => null),
      ]);
      const daysOff = new Set();
      for (const range of [...(mine?.daysOff ?? []), ...(team?.daysOff ?? [])]) {
        for (let d = parseDay(range.start); d <= parseDay(range.end); d = addDays(d, 1)) daysOff.add(dayKey(d));
      }
      const perDay = (mine?.activities ?? []).reduce((s, a) => s + (Number(a.capacityPerDay) || 0), 0);
      cache.capacity.set(sprint.url, { perDay, daysOff });
    }
    return cache.capacity.get(sprint.url);
  }

  // Items changed since `start` that I ever touched and that have Actual hours.
  // Superset of what we need; the update history decides what counts.
  async function changedIds(field, start) {
    const since = dayKey(start);
    if (!cache.wiql.has(since)) {
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.ChangedDate] >= '${since}'`
        + ` AND [System.ChangedBy] EVER @Me AND [${field}] > 0`;
      const { workItems } = await ado('_apis/wit/wiql?api-version=7.1&$top=2000', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      cache.wiql.set(since, workItems.map((w) => w.id));
    }
    return cache.wiql.get(since);
  }

  // Compact history of Actual hours changes: [{ by, at, delta }].
  // Note: revisedDate is 9999-01-01 on the latest revision, so use System.ChangedDate.
  async function hoursHistory(id, field) {
    const out = [];
    for (let skip = 0; ; skip += 200) {
      const { value } = await ado(`_apis/wit/workItems/${id}/updates?api-version=7.1&$top=200&$skip=${skip}`);
      for (const u of value) {
        const f = u.fields?.[field];
        const at = u.fields?.['System.ChangedDate']?.newValue;
        const delta = (Number(f?.newValue) || 0) - (Number(f?.oldValue) || 0);
        if (f && at && delta) out.push({ by: u.revisedBy?.id?.toLowerCase(), at: new Date(at), delta });
      }
      if (value.length < 200) return out;
    }
  }

  async function loadTitles(ids) {
    const missing = ids.filter((id) => !cache.titles.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const { value } = await ado(`_apis/wit/workitems?ids=${missing.slice(i, i + 200).join(',')}`
        + '&fields=System.Title&errorPolicy=omit&api-version=7.1');
      for (const w of value) if (w) cache.titles.set(w.id, w.fields?.['System.Title'] ?? '');
    }
  }

  // Returns Map(dayKey -> Map(workItemId -> summed delta)).
  async function loadHours(start, end) {
    const [field, me] = await Promise.all([actualField(), myId()]);
    const ids = await changedIds(field, start);
    await pool(ids.filter((id) => !cache.updates.has(id)), CONCURRENCY, async (id) => {
      cache.updates.set(id, await hoursHistory(id, field));
    });

    const from = dayKey(start);
    const to = dayKey(end);
    const days = new Map();
    for (const id of ids) {
      for (const { by, at, delta } of cache.updates.get(id)) {
        const key = dayKey(at);
        if (by !== me || key < from || key > to) continue;
        if (!days.has(key)) days.set(key, new Map());
        const items = days.get(key);
        items.set(id, (items.get(id) ?? 0) + delta);
      }
    }
    await loadTitles([...new Set([...days.values()].flatMap((m) => [...m.keys()]))]);
    return days;
  }

  // --- Periods: sprints, or 2-week windows ending this week as a fallback ---

  function period() {
    if (state.sprints.length) {
      const s = state.sprints[state.index];
      return { ...s, title: `${s.name} · ${fmtDate(s.start)} – ${fmtDate(s.end)}` };
    }
    const start = addDays(monday(new Date()), -7 + 14 * state.index);
    const end = addDays(start, 13);
    return { start, end, title: `${fmtDate(start)} – ${fmtDate(end)}` };
  }

  const canPrev = () => !state.sprints.length || state.index > 0;
  const canNext = () => (state.sprints.length ? state.index < state.sprints.length - 1 : state.index < 0);

  // --- UI ---

  const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  const CSS = `
    :host { --line: color-mix(in srgb, currentColor 15%, transparent); }
    .fab {
      position: fixed; right: 16px; bottom: 16px; z-index: 1000000;
      width: 40px; height: 40px; border: 0; border-radius: 50%;
      display: grid; place-items: center; cursor: pointer;
      background: #0078d4; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.3);
    }
    .fab:hover { background: #106ebe; }
    .overlay {
      position: fixed; inset: 0; z-index: 1000001; background: rgba(0,0,0,.4);
      display: flex; align-items: center; justify-content: center;
    }
    .overlay[hidden] { display: none; }
    .modal {
      width: min(780px, 94vw); min-height: 284px; max-height: 85vh; overflow: auto; box-sizing: border-box; padding: 16px;
      background: var(--callout-background-color, var(--background-color, #fff));
      color: var(--text-primary-color, rgba(0,0,0,.9));
      border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.35);
      font: 14px "Segoe UI", system-ui, sans-serif;
    }
    header { display: flex; align-items: center; gap: 6px; }
    h2 { flex: 1; margin: 0; font-size: 15px; text-align: center; }
    button.icon {
      min-width: 28px; height: 28px; border: 1px solid var(--line); border-radius: 4px;
      background: none; color: inherit; font: inherit; cursor: pointer;
    }
    button.icon:disabled { opacity: .35; cursor: default; }
    .weeks { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 14px; }
    .week { flex: 1; min-width: 300px; }
    .head, .total, .items-head { display: flex; justify-content: space-between; gap: 8px; }
    .head { font-weight: 600; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid var(--line); padding: 5px 2px; text-align: center; }
    th { font-size: 12px; font-weight: 600; }
    th.today { color: var(--communication-foreground, #0078d4); }
    td { cursor: pointer; }
    td:hover { background: var(--line); }
    td.selected { outline: 2px solid #0078d4; outline-offset: -2px; }
    td.off { font-weight: 600; opacity: .7; }
    .ok { color: #2e9b4b; }
    .under { color: #d18a00; }
    .items { margin-top: 14px; }
    .items-head { font-weight: 600; }
    ul { margin: 4px 0 0; padding: 0 6px 0 18px; font-size: 13px; }
    li { display: flex; gap: 6px; }
    li .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .8; }
    a { color: var(--communication-foreground, #0078d4); }
    .total { margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--line); font-weight: 700; }
    .note, .muted { margin: 8px 0 0; font-size: 12px; opacity: .7; }
    .error { margin: 14px 0 0; color: #d13438; }
  `;

  let overlay;
  let modal;

  function mount() {
    const host = document.createElement('div');
    host.id = 'simple-ado-toolkit-hours';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <button class="fab" title="Hours logged">${ICON}</button>
      <div class="overlay" hidden><div class="modal" role="dialog" aria-modal="true"></div></div>`;
    document.body.appendChild(host);

    overlay = root.querySelector('.overlay');
    modal = root.querySelector('.modal');
    root.querySelector('.fab').addEventListener('click', open);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) run('close');
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) run(act);
      const day = e.target.closest('[data-day]')?.dataset.day;
      if (day) {
        state.selected = day;
        render();
      }
    });
    addEventListener('keydown', (e) => {
      const act = !overlay.hidden && { ArrowLeft: 'prev', ArrowRight: 'next', Escape: 'close' }[e.key];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      run(act);
    }, true);
  }

  async function open() {
    overlay.hidden = false;
    state.data = null;
    state.error = '';
    state.sprints = [];
    state.index = 0;
    modal.innerHTML = '<p class="muted">Loading sprints…</p>';
    try {
      const { project } = urlParts();
      if (!project) throw new Error('open a project page to use sprints');
      state.sprints = await loadSprints(project);
      if (!state.sprints.length) throw new Error('this team has no dated sprints');
      const today = startOfDay(new Date());
      state.index = Math.max(0, state.sprints.findLastIndex((s) => s.start <= today));
      state.note = '';
    } catch (err) {
      state.sprints = [];
      state.note = `Showing 2-week windows: ${err.message}`;
    }
    load();
  }

  async function load() {
    const req = ++state.req;
    const p = period();
    const today = dayKey(new Date());
    state.data = null;
    state.capacity = null;
    state.error = '';
    state.selected = today >= dayKey(p.start) && today <= dayKey(p.end) ? today : '';
    render();
    try {
      const [data, capacity] = await Promise.all([loadHours(p.start, p.end), p.url ? loadCapacity(p) : null]);
      if (req === state.req) Object.assign(state, { data, capacity });
    } catch (err) {
      if (req === state.req) state.error = err.message;
    }
    if (req === state.req) render();
  }

  function run(act) {
    if (act === 'close') {
      overlay.hidden = true;
      state.req++; // drop any in-flight load
    } else if (act === 'prev' && canPrev()) {
      state.index--;
      load();
    } else if (act === 'next' && canNext()) {
      state.index++;
      load();
    } else if (act === 'refresh') {
      cache.capacity.clear();
      cache.wiql.clear();
      cache.updates.clear();
      cache.titles.clear();
      load();
    }
  }

  function render() {
    const p = period();
    let body;
    if (state.error) body = `<p class="error">${esc(state.error)}</p>`;
    else if (!state.data) body = '<p class="muted">Loading hours…</p>';
    else body = renderHours(p, state.data, state.capacity);

    modal.innerHTML = `
      <header>
        <button class="icon" data-act="prev" title="Previous (←)" ${canPrev() ? '' : 'disabled'}>‹</button>
        <h2>${esc(p.title)}</h2>
        <button class="icon" data-act="next" title="Next (→)" ${canNext() ? '' : 'disabled'}>›</button>
        <button class="icon" data-act="refresh" title="Refresh">⟳</button>
        <button class="icon" data-act="close" title="Close (Esc)">✕</button>
      </header>
      ${state.note ? `<p class="note">${esc(state.note)}</p>` : ''}
      ${body}`;
  }

  // ok = target reached; under = a past weekday/week that fell short; '' = neutral.
  const status = (total, target, isPast) => (total >= target && target > 0 ? 'ok' : isPast && target > 0 ? 'under' : '');

  function renderHours(p, days, capacity) {
    const perDay = capacity?.perDay ?? 0;
    const daysOff = capacity?.daysOff ?? new Set();
    const source = perDay ? `Capacity ${fmtH(perDay)}/day` : 'No capacity set';
    const today = dayKey(new Date());

    // Calendar weeks (Mon–Sun) within the period; weekends only when hours were logged.
    const weeks = [];
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
      if (!weeks.length || d.getDay() === 1) weeks.push([]);
      const key = dayKey(d);
      const items = [...(days.get(key) ?? [])];
      if (!isWeekday(d) && !items.length) continue;
      const off = daysOff.has(key);
      weeks.at(-1).push({
        d, key, items, off,
        total: items.reduce((s, [, delta]) => s + delta, 0),
        target: isWeekday(d) && !off ? perDay : 0,
      });
    }

    let tables = '';
    let sum = 0;
    let sumTarget = 0;
    for (const week of weeks.filter((w) => w.length)) {
      const weekTotal = week.reduce((s, day) => s + day.total, 0);
      const weekTarget = week.reduce((s, day) => s + day.target, 0);
      sum += weekTotal;
      sumTarget += weekTarget;
      const th = week.map((day) => `<th class="${day.key === today ? 'today' : ''}">${esc(fmtDay(day.d))}</th>`);
      const td = week.map((day) => {
        const hours = day.items.length ? fmtH(day.total) : '';
        const text = day.off ? `H ${hours}` : hours || '—';
        const cls = [status(day.total, day.target, day.key < today), day.off && 'off', day.key === state.selected && 'selected'];
        return `<td data-day="${day.key}" class="${cls.filter(Boolean).join(' ')}">${text.trim()}</td>`;
      });
      tables += `<div class="week">
        <div class="head"><span>Week of ${esc(fmtDate(week[0].d))}</span>
          <span class="${status(weekTotal, weekTarget, week.at(-1).key < today)}">${fmtTotal(weekTotal, weekTarget)}</span></div>
        <table><tr>${th.join('')}</tr><tr>${td.join('')}</tr></table></div>`;
    }

    return `<p class="note">${esc(source)}</p>
      <div class="weeks">${tables}</div>
      <div class="total"><span>${state.sprints.length ? 'Sprint' : 'Total'}</span>
        <span class="${status(sum, sumTarget, dayKey(p.end) < today)}">${fmtTotal(sum, sumTarget)}</span></div>
      ${renderItems(days)}`;
  }

  function renderItems(days) {
    if (!state.selected) return '';
    const org = encodeURIComponent(urlParts().org);
    const items = [...(days.get(state.selected) ?? [])].filter(([, delta]) => delta);
    const list = items.length
      ? `<ul>${items.map(([id, delta]) => `<li>
          <a href="${location.origin}/${org}/_workitems/edit/${id}">#${id}</a>
          <span class="title">${esc(cache.titles.get(id) ?? '')}</span>
          <span>${fmtDelta(delta)}</span></li>`).join('')}</ul>`
      : '<p class="muted">No hours logged</p>';
    return `<div class="items"><div class="items-head">${esc(fmtDate(parseDay(state.selected)))}</div>${list}</div>`;
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
