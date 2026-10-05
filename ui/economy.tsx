import { ECONOMY } from '../src/economy.mjs';
import type { PlayerState } from '../src/client.ts';
interface Props { player: PlayerState; busy: boolean; act(operation: string, payload: Record<string, unknown>): Promise<void> }
const names: Record<string, string> = { iron_sword: 'Железный меч', hunting_bow: 'Охотничий лук', healing_potion: 'Зелье лечения', silver_ring: 'Серебряное кольцо', dwemer_relic: 'Двемерская реликвия' };
export function EconomyPanel({ player, busy, act }: Props) {
  const p = player.progression, disabled = busy || !!player.active;
  const traders: Record<string, string> = { smith: 'Кузнец', apothecary: 'Лекарь', antiquarian: 'Антиквар' };
  return <>
    <div className="progression" aria-label="Прогресс персонажа"><strong>{p.gold} золота</strong><span>Уровень {p.level} · {p.xp} опыта</span><span>Очки навыков: {p.skillPoints}</span></div>
    {player.active && <p className="hint">Торговля, сдача контрактов и улучшения доступны после возвращения в убежище.</p>}
    <div className="columns economy">
      <section><h2>Торговцы</h2><p className="hint">Базовый ассортимент. Скидка мастерской: {p.workshop * 5}%.</p>
        {Object.entries(traders).map(([id, title]) => <div key={id}><h3>{title}</h3><ul>{ECONOMY.offers.filter(o => o.trader === id).map(offer => {
          const price = Math.ceil(offer.buy * (100 - p.workshop * 5) / 100);
          return <li key={offer.id}><div><strong>{names[offer.template]}</strong><small>Покупка {price} · продажа {offer.sell}</small></div><button disabled={disabled || p.gold < price} onClick={() => void act('buy', { offerId: offer.id, quantity: 1 })}>Купить</button></li>;
        })}</ul></div>)}
        <h3>Продать из схрона</h3><ul>{player.stash.map(item => <li key={item.id}><div><strong>{names[item.template]}</strong><small>В наличии: {item.quantity}</small></div><button disabled={disabled} onClick={() => void act('sell', { itemId: item.id, quantity: 1 })}>Продать 1</button></li>)}</ul>
      </section>
      <section><h2>Контракты</h2><p className="hint">Награда фиксируется при принятии. Сдача забирает нужное количество из схрона.</p>
        {ECONOMY.contracts.map(def => {
          const saved = p.contracts.find(c => c.id === def.id), terms = saved?.terms ?? def;
          const candidates = player.stash.filter(i => i.template === terms.template);
          const have = candidates.reduce((sum, i) => sum + i.quantity, 0);
          const locked = p.archive < def.archive || (!!def.requires && !p.contracts.some(c => c.id === def.requires && c.status === 'COMPLETED'));
          const gold = saved ? terms.gold : Math.floor(def.gold * (100 + p.bargaining * 5) / 100);
          return <article className="contract" key={def.id}><h3>{def.name}</h3><p>{names[terms.template]} · {Math.min(have, terms.quantity)}/{terms.quantity}</p><p className="hint">{gold} золота · {terms.xp} опыта</p>
            {saved?.status === 'COMPLETED' ? <strong>Выполнен</strong> : saved ? <button disabled={disabled || have < terms.quantity} onClick={() => void act('turnInContract', { contractId: def.id, itemIds: candidates.slice(0, 100).map(i => i.id) })}>Сдать припасы</button> : <button disabled={disabled || locked} onClick={() => void act('acceptContract', { contractId: def.id })}>{locked ? 'Нужен предыдущий контракт / архив' : 'Принять'}</button>}
          </article>;
        })}
      </section>
      <section><h2>Убежище и навыки</h2>{ECONOMY.modules.map(module => {
        const level = p[module.id as 'workshop' | 'archive'], cost = module.costs[level];
        return <article className="contract" key={module.id}><h3>{module.name} · {level}/{module.costs.length}</h3><p className="hint">{module.description}</p><button disabled={disabled || cost === undefined || p.gold < cost} onClick={() => void act('upgrade', { moduleId: module.id, expectedLevel: level })}>{cost === undefined ? 'Максимальный уровень' : `Улучшить · ${cost} золота`}</button></article>;
      })}<article className="contract"><h3>Переговоры · {p.bargaining}/3</h3><p className="hint">+5% золота за новые контракты за ранг. Цена: 1 очко навыка.</p><button disabled={disabled || p.skillPoints < 1 || p.bargaining >= 3} onClick={() => void act('learnSkill', { skillId: 'bargaining', expectedRank: p.bargaining })}>Изучить</button></article></section>
    </div>
  </>;
}
