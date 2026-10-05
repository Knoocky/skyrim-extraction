import { useState } from 'react';
import { MISSIONS, MISSION_TARGET_NAMES } from '../src/missions.mjs';
import { ITEMS, RECIPES } from '../src/catalog.mjs';
import { ECONOMY } from '../src/economy.mjs';
import type { PlayerState, Market } from '../src/client.ts';
interface Props { player: PlayerState; market: Market; demo?: boolean; busy: boolean; act(operation: string, payload: Record<string, unknown>): Promise<void> }
const names: Record<string, string> = Object.fromEntries(Object.entries(ITEMS).map(([id, item]) => [id, item.name]));
export function EconomyPanel({ player, market, demo = false, busy, act }: Props) {
  const [query, setQuery] = useState(''), [missionFilter, setMissionFilter] = useState('all');
  const match = (name: string) => name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim());
  const p = player.progression, disabled = busy || !!player.active;
  const traders: Record<string, string> = { smith: 'Кузнец', apothecary: 'Лекарь', antiquarian: 'Антиквар' };
  return <>
    <div className="toolbar"><label>Поиск в убежище <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Предмет, рецепт или задание"/></label><label>Задания <select value={missionFilter} onChange={e => setMissionFilter(e.target.value)}><option value="all">Все</option><option value="active">Принятые</option><option value="available">Доступные</option><option value="completed">Выполненные</option></select></label></div>
    <p role="status">Репутация убежища: {p.reputation} · {p.finaleCompleted ? 'Маяк восстановлен — основная цепочка завершена' : 'Цель: восстановить последний маяк'}</p>
    <div className="progression" aria-label="Прогресс персонажа"><strong>{p.gold} золота</strong><span>Уровень {p.level} · {p.xp} опыта</span><span>Места: {p.capacity.used}/{p.capacity.limit}</span><span>Очки навыков: {p.skillPoints}</span></div>
    {player.active && <p className="hint">Торговля, сдача контрактов и улучшения доступны после возвращения в убежище.</p>}
    <aside className="demo"><strong>Восстановление после разорения.</strong> Если схрон пуст и не хватает денег на оружие, можно получить аварийный меч. Его нельзя продать или передать; при смерти он исчезнет. <button disabled={disabled || player.stash.length > 0 || p.gold >= Math.ceil(100 * (100 - p.workshop * 5) / 100)} onClick={() => void act('recoveryKit', {})}>Получить аварийный меч</button></aside>
    <section className="crafting"><h2>Крафт</h2><p className="hint">Материалы берутся из схрона. Эффекты еды и зелий в Skyrim ещё не подключены.</p><div className="recipe-grid">{RECIPES.filter(r => match(r.name)).map(recipe => {
      const unlocked = !recipe.requires || p.missions.some(m => m.definitionId === recipe.requires && m.status === 'COMPLETED');
      const ready = recipe.ingredients.every(i => player.stash.filter(item => item.template === i.template && !item.recovery).reduce((sum, item) => sum + item.quantity, 0) >= i.quantity);
      const fee = Math.max(0, recipe.gold - (recipe.output.template === 'healing_potion' ? p.alchemy : recipe.output.template === 'food_ration' ? p.kitchen : 0));
      const level = p[recipe.module as 'workshop' | 'archive' | 'storage' | 'alchemy' | 'kitchen' | 'scouting'];
      return <article className="contract" key={recipe.id}><h3>{recipe.name}</h3><p>{recipe.ingredients.map(i => `${names[i.template]} ×${i.quantity}`).join(', ')}</p><p className="hint">{fee} золота · мастерская {recipe.level}{recipe.requires && !unlocked ? ' · требуется: ' + MISSIONS.find(m => m.id === recipe.requires)?.name : ''} · результат ×{recipe.output.quantity}</p><button disabled={disabled || !unlocked || !ready || p.gold < fee || level < recipe.level} onClick={() => void act('craft', { recipeId: recipe.id, batches: 1 })}>Изготовить</button></article>;
    })}</div></section>
    <div className="columns economy">
      <section><h2>Торговцы</h2><p className="hint">Базовый ассортимент. Скидка мастерской: {p.workshop * 5}%.</p>
        {Object.entries(traders).map(([id, title]) => <div key={id}><h3>{title}</h3><ul>{ECONOMY.offers.filter(o => o.trader === id && match(names[o.template])).map(offer => {
          const stock = market.stock.find(s => s.offerId === offer.id)?.quantity ?? 0;
          const price = Math.ceil(offer.buy * (100 - p.workshop * 5) / 100);
          return <li key={offer.id}><div><strong>{names[offer.template]}</strong><small>Покупка {price} · продажа {offer.sell} · осталось {stock}</small></div><button disabled={disabled || p.gold < price || stock < 1} onClick={() => void act('buy', { offerId: offer.id, quantity: 1 })}>Купить</button></li>;
        })}</ul></div>)}
        <h3>Продать из схрона</h3><ul>{player.stash.filter(i => match(names[i.template])).map(item => <li key={item.id}><div><strong>{names[item.template]}</strong><small>В наличии: {item.quantity}</small></div><button disabled={disabled || item.recovery} onClick={() => void act('sell', { itemId: item.id, quantity: 1 })}>Продать 1</button></li>)}</ul>
      </section>
      <section><h2>Контракты</h2><h3>Задания мира · цикл {p.missionCycle}</h3><p className="hint">События разведки, боя и спасения поступают только от сервера. Прогресс подтверждается после экстракции.</p>{MISSIONS.filter(m => match(m.name)).map(def => {
        const history = p.missions.filter(m => m.definitionId === def.id);
        const activeMission = history.find(m => m.status === 'ACCEPTED');
        const completed = history.some(m => m.status === 'COMPLETED' && (!def.repeatable || m.cycle === p.missionCycle));
        const locked = p.reputation < (def.requiresReputation ?? 0) || (!!def.requires && !p.missions.some(m => m.definitionId === def.requires && m.status === 'COMPLETED'));
        if ((missionFilter === 'active' && !activeMission) || (missionFilter === 'completed' && !completed) || (missionFilter === 'available' && (locked || completed || activeMission))) return null;
        const ready = activeMission?.terms.objectives.every((o,i) => activeMission.progress[i].confirmed >= o.quantity);
        return <article key={def.id} className="contract"><h3>{def.name}{def.repeatable ? ' · повторяемый' : ''}</h3>
          {(activeMission?.terms.objectives ?? def.objectives).map((o,i) => <p className="hint" key={i}>{o.kind === 'delivery' ? names[o.target] : ({ explore:'Разведка', kill:'Победа', rescue:'Спасение' } as Record<string,string>)[o.kind] + ': ' + ((MISSION_TARGET_NAMES as Record<string,string>)[o.target] ?? 'Цель задания')} · {activeMission?.progress[i].confirmed ?? 0}/{o.quantity}{activeMission?.progress[i].pending ? ` (+${activeMission.progress[i].pending} до выхода)` : ''}</p>)}
          {demo && player.active && activeMission && activeMission.terms.objectives.filter((o,i) => o.kind !== 'delivery' && activeMission.progress[i].confirmed + activeMission.progress[i].pending < o.quantity).map((o,i) => <button key={i} disabled={busy} onClick={() => void act('demoMissionEvent', { kind: o.kind, target: o.target })}>Имитировать событие задания</button>)}
          <p className="hint">{activeMission?.terms.gold ?? Math.floor(def.gold * (100 + p.bargaining * 5) / 100)} золота · {activeMission?.terms.xp ?? Math.floor(def.xp * (100 + p.scouting * 10 + p.scholarship * 5) / 100)} опыта</p>
          {activeMission ? <button disabled={disabled || !ready} onClick={() => void act('claimMission', { instanceId: activeMission.id })}>Получить награду</button> : completed ? <strong>Выполнен{def.repeatable ? ' в этом цикле' : ''}</strong> : <button disabled={disabled || locked} onClick={() => void act('acceptMission', { definitionId: def.id })}>Взять задание</button>}
        </article>;
      })}<h3>Начальная цепочка доставки</h3><p className="hint">Награда фиксируется при принятии. Сдача забирает нужное количество из схрона.</p>
        {ECONOMY.contracts.map(def => {
          const saved = p.contracts.find(c => c.id === def.id), terms = saved?.terms ?? def;
          const candidates = player.stash.filter(i => i.template === terms.template);
          const have = candidates.reduce((sum, i) => sum + i.quantity, 0);
          const locked = p.archive < def.archive || (!!def.requires && !p.contracts.some(c => c.id === def.requires && c.status === 'COMPLETED'));
          const xp = saved ? terms.xp : Math.floor(def.xp * (100 + p.scouting * 10 + p.scholarship * 5) / 100);
          const gold = saved ? terms.gold : Math.floor(def.gold * (100 + p.bargaining * 5) / 100);
          return <article className="contract" key={def.id}><h3>{def.name}</h3><p>{names[terms.template]} · {Math.min(have, terms.quantity)}/{terms.quantity}</p><p className="hint">{gold} золота · {xp} опыта</p>
            {saved?.status === 'COMPLETED' ? <strong>Выполнен</strong> : saved ? <button disabled={disabled || have < terms.quantity} onClick={() => void act('turnInContract', { contractId: def.id, itemIds: candidates.slice(0, 100).map(i => i.id) })}>Сдать припасы</button> : <button disabled={disabled || locked} onClick={() => void act('acceptContract', { contractId: def.id })}>{locked ? 'Нужен предыдущий контракт / архив' : 'Принять'}</button>}
          </article>;
        })}
      </section>
      <section><h2>Убежище и навыки</h2>{ECONOMY.modules.map(module => {
        const level = p[module.id as 'workshop' | 'archive' | 'storage' | 'alchemy' | 'kitchen' | 'scouting'], cost = module.costs[level];
        return <article className="contract" key={module.id}><h3>{module.name} · {level}/{module.costs.length}</h3><p className="hint">{module.description}</p><button disabled={disabled || cost === undefined || p.gold < cost} onClick={() => void act('upgrade', { moduleId: module.id, expectedLevel: level })}>{cost === undefined ? 'Максимальный уровень' : `Улучшить · ${cost} золота`}</button></article>;
      })}{ECONOMY.skills.filter(s => s.id !== 'bargaining').map(skill => { const rank = p[skill.id as 'fieldcraft' | 'scholarship']; return <article className="contract" key={skill.id}><h3>{skill.name} · {rank}/{skill.maxRank}</h3><p>{skill.description}</p><button disabled={disabled || p.skillPoints < 1 || rank >= skill.maxRank} onClick={() => void act('learnSkill', {skillId:skill.id,expectedRank:rank})}>Изучить</button></article>; })}<article className="contract"><h3>Переговоры · {p.bargaining}/3</h3><p className="hint">+5% золота за новые контракты за ранг. Цена: 1 очко навыка.</p><button disabled={disabled || p.skillPoints < 1 || p.bargaining >= 3} onClick={() => void act('learnSkill', { skillId: 'bargaining', expectedRank: p.bargaining })}>Изучить</button></article></section>
    </div>
  </>;
}
