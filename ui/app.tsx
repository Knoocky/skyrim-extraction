import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { ViewState, Intent } from './types.ts';
import type { Item } from '../src/client.ts';
import './style.css';
import { messageFor } from './messages.ts';
import { ITEMS } from '../src/catalog.mjs';
import { EconomyPanel } from './economy.tsx';

const names: Record<string, string> = Object.fromEntries(Object.entries(ITEMS).map(([id, item]) => [id, item.name]));
const demo = new URLSearchParams(location.search).get('demo') === '1';
function App() {
  const [actor, setActor] = useState('alice');
  const [state, setState] = useState<ViewState | null>(null);
  const [stashQuery, setStashQuery] = useState('');
  const [selected, select] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Intent | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const locked = busy || pending !== null;
  async function refresh() {
    const current = generation.current;
    const response = await fetch('/api/state?player=' + actor);
    if (!response.ok) throw new Error('Не удалось получить состояние');
    const next = await response.json() as ViewState;
    if (current !== generation.current) return;
    setState(next); select(old => old.filter(id => next.player.stash.some(item => item.id === id)));
  }
  useEffect(() => {
    generation.current++;
    setState(null); select([]); setError(''); setNotice('');
    if (demo) { void refresh().catch(e => setError(String(e.message))); return () => { generation.current++; }; }
    return window.extractionHost?.subscribe(setState);
  }, [actor]);
  async function act(operation: string, payload: Record<string, unknown>, retry?: Intent) {
    if (inFlight.current || !state || (pending && !retry)) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const intent = retry ?? { requestId: crypto.randomUUID(), operation, payload };
      setPending(intent);
      if (demo) {
        const response = await fetch('/api/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor, ...intent }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) setPending(null);
          throw new Error(messageFor(result.error));
        }
        await refresh();
      } else {
        if (!window.extractionHost) throw new Error('Нет связи с игровым адаптером');
        await window.extractionHost.sendIntent(intent);
      }
      setPending(null);
      setNotice('Состояние подтверждено');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const active = state?.player.active;
  const context = active ? { worldId: active.worldId, expeditionId: active.expeditionId } : {};
  function itemRow(item: Item, action?: React.ReactNode) {
    return <li key={item.id}><div><strong>{names[item.template] ?? item.template}</strong><small>{item.recovery ? 'Аварийный комплект · не для продажи' : item.quantity > 1 ? `${item.quantity} шт.` : '1 предмет'}</small></div>{action}</li>;
  }
  return <main>
    <header><div><p className="eyebrow">SKYRIM EXTRACTION</p><h1>{active ? 'Экспедиция' : 'Убежище'}</h1></div><span className={'status ' + (busy ? 'pending' : '')}>{busy ? 'Синхронизация…' : state ? 'Связь установлена' : 'Ожидаем адаптер'}</span></header>
    {demo && <aside className="demo"><strong>Стенд без Skyrim.</strong> Реальное ядро и HTTP, временная база, имитация игрового мира. Бой, расстояния и лечение здесь не проверяются.</aside>}
    <div className="toolbar">{demo && <><label>Персонаж <select disabled={locked} value={actor} onChange={e => setActor(e.target.value)}><option value="alice">Alice</option><option value="bob">Bob</option><option value="cora">Cora · финальная цепочка</option></select></label><button disabled={locked} onClick={() => void refresh().catch(e => setError(e.message))}>Обновить</button></>}<span>{state ? `Ревизия ${state.revision}` : 'Экономические действия недоступны'}</span></div>
    {pending && !busy && <aside className="demo" role="status">Ответ не подтверждён. Повтор использует тот же запрос и не дублирует покупку или награду. <button onClick={() => void act(pending.operation, pending.payload, pending)}>Повторить запрос</button></aside>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="notice" role="status" aria-live="polite">{notice || (active ? 'Смерть оставит всё снаряжение экспедиции в мире.' : 'В схроне предметы сохраняются после смерти.')}</p>
    <div className="columns">
      <section><h2>Личный схрон <span>{state?.player.stash.length ?? 0}</span></h2><p className="hint">Выбери, что взять с собой. Остальное останется здесь.</p>
        <label>Поиск в схроне <input type="search" value={stashQuery} onChange={e => setStashQuery(e.target.value)}/></label><ul>{state?.player.stash.filter(i => (names[i.template] ?? i.template).toLocaleLowerCase('ru').includes(stashQuery.toLocaleLowerCase('ru'))).map(item => itemRow(item, <div className="actions"><label className="pick"><input type="checkbox" disabled={locked || !!active} checked={selected.includes(item.id)} onChange={e => select(old => e.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))}/> Взять</label>{item.quantity > 1 && <button disabled={locked || !!active} onClick={() => void act('splitStack', { itemId: item.id, quantity: 1 })}>Отделить 1</button>}</div>))}</ul>
        {!active && <button className="primary" disabled={locked || !state} onClick={() => void act('beginExpedition', { worldId: state!.worldId, itemIds: selected })}>Выйти в экспедицию · {selected.length}</button>}
      </section>
      <section><h2>Снаряжение и добыча <span>{active?.items.length ?? 0}</span></h2><p className="hint">Эти предметы находятся под риском до экстракции.</p>
        <ul>{active?.items.map(item => itemRow(item, (ITEMS as Record<string, {kind:string}>)[item.template]?.kind === 'consumable' && <button disabled={locked} onClick={() => void act('consume', { ...context, itemId: item.id, quantity: 1 })}>{demo ? 'Списать 1' : 'Использовать'}</button>))}</ul>
        {!active && <p className="empty">Экспедиция ещё не начата.</p>}
        {active && <div className="footer-actions"><button className="primary" disabled={locked || (!demo && !state?.exitId)} onClick={() => void act('extract', { ...context, exitId: demo ? 'demo-north' : state?.exitId })}>{demo ? 'Имитировать выход' : 'Начать экстракцию'}</button>{demo && <button className="danger" disabled={locked} onClick={() => void act('demoDeath', context)}>Имитировать смерть</button>}</div>}
      </section>
      <section><h2>Доступная добыча</h2><p className="hint">{demo ? 'Все контейнеры стенда, включая вещи погибшего.' : 'Контейнеры, доступность которых подтвердил сервер.'}</p>
        {state?.containers.map((container, index) => <div className="container" key={container.id}><h3>Контейнер {index + 1}</h3><ul>{container.items.map(item => itemRow(item, <button disabled={locked || !active} onClick={() => void act('pickup', { ...context, containerId: container.id, itemId: item.id })}>Забрать</button>))}</ul>{container.items.length === 0 && <p className="empty">Пусто</p>}</div>)}
      </section>
    </div>
    {state?.player.reports?.length ? <section aria-label="Отчёты экспедиций"><h2>Последние экспедиции</h2><ul>{state.player.reports.map(report => <li key={report.expeditionId}><div><strong>{{EXTRACTED:'Успешный выход',DEAD:'Гибель',FORFEITED:'Экспедиция потеряна',RECOVERED:'Аварийное возвращение снаряжения'}[report.outcome] ?? 'Завершена'}</strong><small>{report.items.reduce((n,i)=>n+i.quantity,0)} предметов · {report.xp} опыта</small></div></li>)}</ul></section> : null}
    {state && <EconomyPanel player={state.player} market={state.market} demo={demo} busy={locked} act={act}/> }
    <footer>{demo ? 'После остановки стенда временная база удаляется. Это не игровой релиз.' : 'Действия подтверждает сервер. При потере связи дождись восстановления.'}</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
