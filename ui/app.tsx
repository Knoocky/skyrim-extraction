import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ViewState } from './types.ts';
import type { Item } from '../src/client.ts';
import './style.css';

const names: Record<string, string> = { iron_sword: 'Железный меч', hunting_bow: 'Охотничий лук', healing_potion: 'Зелье лечения', silver_ring: 'Серебряное кольцо', dwemer_relic: 'Двемерская реликвия' };
const demo = new URLSearchParams(location.search).get('demo') === '1';
function App() {
  const [actor, setActor] = useState('alice');
  const [state, setState] = useState<ViewState | null>(null);
  const [selected, select] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh() {
    const response = await fetch('/api/state?player=' + actor);
    if (!response.ok) throw new Error('Не удалось получить состояние');
    const next = await response.json() as ViewState;
    setState(next); select(old => old.filter(id => next.player.stash.some(item => item.id === id)));
  }
  useEffect(() => {
    setState(null); select([]); setError(''); setNotice('');
    if (demo) { void refresh().catch(e => setError(String(e.message))); return; }
    return window.extractionHost?.subscribe(setState);
  }, [actor]);
  async function act(operation: string, payload: Record<string, unknown>) {
    if (busy || !state) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const intent = { requestId: crypto.randomUUID(), operation, payload };
      if (demo) {
        const response = await fetch('/api/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor, ...intent }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Операция отклонена');
        await refresh();
      } else {
        if (!window.extractionHost) throw new Error('Нет связи с игровым адаптером');
        await window.extractionHost.sendIntent(intent);
      }
      setNotice('Состояние подтверждено');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); }
    finally { setBusy(false); }
  }
  const active = state?.player.active;
  const context = active ? { worldId: active.worldId, expeditionId: active.expeditionId } : {};
  function itemRow(item: Item, action?: React.ReactNode) {
    return <li key={item.id}><div><strong>{names[item.template] ?? item.template}</strong><small>{item.quantity > 1 ? `${item.quantity} шт.` : '1 предмет'}</small></div>{action}</li>;
  }
  return <main>
    <header><div><p className="eyebrow">SKYRIM EXTRACTION</p><h1>{active ? 'Экспедиция' : 'Убежище'}</h1></div><span className={'status ' + (busy ? 'pending' : '')}>{busy ? 'Синхронизация…' : state ? 'Связь установлена' : 'Ожидаем адаптер'}</span></header>
    {demo && <aside className="demo"><strong>Стенд без Skyrim.</strong> Реальное ядро и HTTP, временная база, имитация игрового мира. Бой, расстояния и лечение здесь не проверяются.</aside>}
    <div className="toolbar">{demo && <><label>Персонаж <select disabled={busy} value={actor} onChange={e => setActor(e.target.value)}><option value="alice">Alice</option><option value="bob">Bob</option></select></label><button disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>Обновить</button></>}<span>{state ? `Ревизия ${state.revision}` : 'Экономические действия недоступны'}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="notice" role="status" aria-live="polite">{notice || (active ? 'Смерть оставит всё снаряжение экспедиции в мире.' : 'В схроне предметы сохраняются после смерти.')}</p>
    <div className="columns">
      <section><h2>Личный схрон <span>{state?.player.stash.length ?? 0}</span></h2><p className="hint">Выбери, что взять с собой. Остальное останется здесь.</p>
        <ul>{state?.player.stash.map(item => itemRow(item, <div className="actions"><label className="pick"><input type="checkbox" disabled={busy || !!active} checked={selected.includes(item.id)} onChange={e => select(old => e.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))}/> Взять</label>{item.quantity > 1 && <button disabled={busy || !!active} onClick={() => void act('splitStack', { itemId: item.id, quantity: 1 })}>Отделить 1</button>}</div>))}</ul>
        {!active && <button className="primary" disabled={busy || !state} onClick={() => void act('beginExpedition', { worldId: state!.worldId, itemIds: selected })}>Выйти в экспедицию · {selected.length}</button>}
      </section>
      <section><h2>Снаряжение и добыча <span>{active?.items.length ?? 0}</span></h2><p className="hint">Эти предметы находятся под риском до экстракции.</p>
        <ul>{active?.items.map(item => itemRow(item, item.template === 'healing_potion' && <button disabled={busy} onClick={() => void act('consume', { ...context, itemId: item.id, quantity: 1 })}>{demo ? 'Списать 1' : 'Использовать'}</button>))}</ul>
        {!active && <p className="empty">Экспедиция ещё не начата.</p>}
        {active && <div className="footer-actions"><button className="primary" disabled={busy || (!demo && !state?.exitId)} onClick={() => void act('extract', { ...context, exitId: demo ? 'demo-north' : state?.exitId })}>{demo ? 'Имитировать выход' : 'Начать экстракцию'}</button>{demo && <button className="danger" disabled={busy} onClick={() => void act('demoDeath', context)}>Имитировать смерть</button>}</div>}
      </section>
      <section><h2>Доступная добыча</h2><p className="hint">{demo ? 'Все контейнеры стенда, включая вещи погибшего.' : 'Контейнеры, доступность которых подтвердил сервер.'}</p>
        {state?.containers.map((container, index) => <div className="container" key={container.id}><h3>Контейнер {index + 1}</h3><ul>{container.items.map(item => itemRow(item, <button disabled={busy || !active} onClick={() => void act('pickup', { ...context, containerId: container.id, itemId: item.id })}>Забрать</button>))}</ul>{container.items.length === 0 && <p className="empty">Пусто</p>}</div>)}
      </section>
    </div>
    <footer>{demo ? 'После остановки стенда временная база удаляется. Это не игровой релиз.' : 'Действия подтверждает сервер. При потере связи дождись восстановления.'}</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
