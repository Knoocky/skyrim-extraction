import { ITEMS, RECIPES } from '../src/catalog.mjs';
import { ECONOMY } from '../src/economy.mjs';
import type { PlayerState, Market } from '../src/client.ts';
interface Props { player: PlayerState; market: Market; busy: boolean; act(operation: string, payload: Record<string, unknown>): Promise<void> }
const names: Record<string, string> = Object.fromEntries(Object.entries(ITEMS).map(([id, item]) => [id, item.name]));
export function EconomyPanel({ player, market, busy, act }: Props) {
  const p = player.progression, disabled = busy || !!player.active;
  const traders: Record<string, string> = { smith: 'Кузнец', apothecary: 'Лекарь', antiquarian: 'Антиквар' };
  return <>
    <div className="progression" aria-label="Прогресс персонажа"><strong>{p.gold} золота</strong><span>Уровень {p.level} · {p.xp} опыта</span><span>Места: {p.capacity.used}/{p.capacity.limit}</span><span>Очки навыков: {p.skillPoints}</span></div>
    {player.active && <p className="hint">Торговля, сдача контрактов и улучшения доступны после возвращения в убежище.</p>}
    <aside className="demo"><strong>Восстановление после разорения.</strong> Если схрон пуст и не хватает денег на оружие, можно получить аварийный меч. Его нельзя продать или передать; при смерти он исчезнет. <button disabled={disabled || player.stash.length > 0 || p.gold >= Math.ceil(100 * (100 - p.workshop * 5) / 100)} onClick={() => void act('recoveryKit', {})}>Получить аварийный меч</button></aside>
    <section className="crafting"><h2>Крафт</h2><p className="hint">Материалы берутся из схрона. Эффекты еды и зелий в Skyrim ещё не подключены.</p><div className="recipe-grid">{RECIPES.map(recipe => {
      const ready = recipe.ingredients.every(i => player.stash.filter(item => item.template === i.template && !item.recovery).reduce((sum, item) => sum + item.quantity, 0) >= i.quantity);
      const fee = Math.max(0, recipe.gold - (recipe.output.template === 'healing_potion' ? p.alchemy : recipe.output.template === 'food_ration' ? p.kitchen : 0));
      const level = p[recipe.module as 'workshop' | 'archive' | 'storage' | 'alchemy' | 'kitchen' | 'scouting'];
      return <article className="contract" key={recipe.id}><h3>{recipe.name}</h3><p>{recipe.ingredients.map(i => `${names[i.template]} ×${i.quantity}`).join(', ')}</p><p className="hint">{fee} золота · мастерская {recipe.level} · результат ×{recipe.output.quantity}</p><button disabled={disabled || !ready || p.gold < fee || level < recipe.level} onClick={() => void act('craft', { recipeId: recipe.id, batches: 1 })}>Изготовить</button></article>;
    })}</div></section>
    <div className="columns economy">
      <section><h2>Торговцы</h2><p className="hint">Базовый ассортимент. Скидка мастерской: {p.workshop * 5}%.</p>
        {Object.entries(traders).map(([id, title]) => <div key={id}><h3>{title}</h3><ul>{ECONOMY.offers.filter(o => o.trader === id).map(offer => {
          const stock = market.stock.find(s => s.offerId === offer.id)?.quantity ?? 0;
          const price = Math.ceil(offer.buy * (100 - p.workshop * 5) / 100);
          return <li key={offer.id}><div><strong>{names[offer.template]}</strong><small>Покупка {price} · продажа {offer.sell} · осталось {stock}</small></div><button disabled={disabled || p.gold < price || stock < 1} onClick={() => void act('buy', { offerId: offer.id, quantity: 1 })}>Купить</button></li>;
        })}</ul></div>)}
        <h3>Продать из схрона</h3><ul>{player.stash.map(item => <li key={item.id}><div><strong>{names[item.template]}</strong><small>В наличии: {item.quantity}</small></div><button disabled={disabled || item.recovery} onClick={() => void act('sell', { itemId: item.id, quantity: 1 })}>Продать 1</button></li>)}</ul>
      </section>
      <section><h2>Контракты</h2><p className="hint">Награда фиксируется при принятии. Сдача забирает нужное количество из схрона.</p>
        {ECONOMY.contracts.map(def => {
          const saved = p.contracts.find(c => c.id === def.id), terms = saved?.terms ?? def;
          const candidates = player.stash.filter(i => i.template === terms.template);
          const have = candidates.reduce((sum, i) => sum + i.quantity, 0);
          const locked = p.archive < def.archive || (!!def.requires && !p.contracts.some(c => c.id === def.requires && c.status === 'COMPLETED'));
          const xp = saved ? terms.xp : Math.floor(def.xp * (100 + p.scouting * 10) / 100);
          const gold = saved ? terms.gold : Math.floor(def.gold * (100 + p.bargaining * 5) / 100);
          return <article className="contract" key={def.id}><h3>{def.name}</h3><p>{names[terms.template]} · {Math.min(have, terms.quantity)}/{terms.quantity}</p><p className="hint">{gold} золота · {xp} опыта</p>
            {saved?.status === 'COMPLETED' ? <strong>Выполнен</strong> : saved ? <button disabled={disabled || have < terms.quantity} onClick={() => void act('turnInContract', { contractId: def.id, itemIds: candidates.slice(0, 100).map(i => i.id) })}>Сдать припасы</button> : <button disabled={disabled || locked} onClick={() => void act('acceptContract', { contractId: def.id })}>{locked ? 'Нужен предыдущий контракт / архив' : 'Принять'}</button>}
          </article>;
        })}
      </section>
      <section><h2>Убежище и навыки</h2>{ECONOMY.modules.map(module => {
        const level = p[module.id as 'workshop' | 'archive' | 'storage' | 'alchemy' | 'kitchen' | 'scouting'], cost = module.costs[level];
        return <article className="contract" key={module.id}><h3>{module.name} · {level}/{module.costs.length}</h3><p className="hint">{module.description}</p><button disabled={disabled || cost === undefined || p.gold < cost} onClick={() => void act('upgrade', { moduleId: module.id, expectedLevel: level })}>{cost === undefined ? 'Максимальный уровень' : `Улучшить · ${cost} золота`}</button></article>;
      })}<article className="contract"><h3>Переговоры · {p.bargaining}/3</h3><p className="hint">+5% золота за новые контракты за ранг. Цена: 1 очко навыка.</p><button disabled={disabled || p.skillPoints < 1 || p.bargaining >= 3} onClick={() => void act('learnSkill', { skillId: 'bargaining', expectedRank: p.bargaining })}>Изучить</button></article></section>
    </div>
  </>;
}
