import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CombatHud,actionNames} from './combat-hud.tsx';
import type {RaidSnapshot} from '../src/raid-service.ts';
import type {HitEvent} from '../src/combat.ts';
import './combat.css';
interface State{ready:boolean;snapshot:RaidSnapshot;manifest:{version:number;rulesHash:string};items:Record<string,{name:string}>;events:HitEvent[]}
interface Request{requestId:string;operation:string;payload:unknown}
const names:Record<string,string>={light:'Быстрый удар',heavy:'Сильный удар',dodge:'Перекат',guard:'Блок',releaseGuard:'Опустить щит',parry:'Парировать'};
const outcomes:Record<string,string>={hit:'Попадание',blocked:'Удар заблокирован',dodged:'Уклонение',parried:'Парирование',guardBreak:'Блок пробит'};
function App(){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Request|null>(null),[auto,setAuto]=useState(false),[choice,setChoice]=useState('sword');
 async function send(request:Request){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/combat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
   const data=await response.json();
   if(!response.ok){if(data.state)setState(data.state);setAuto(false);setPending(null);throw Error(data.error??'Ошибка сервера');}
   setState(data);setPending(null);
  }catch(e){setAuto(false);setError(e instanceof Error?e.message:'Нет связи');if(e instanceof TypeError)setPending(request);}
  finally{setBusy(false);}
 }
 const act=(operation:string,payload:unknown={})=>send({requestId:crypto.randomUUID(),operation,payload});
 useEffect(()=>{void fetch('/api/combat/state').then(r=>r.json()).then(setState).catch(()=>setError('Не удалось подключиться к полигону'));},[]);
 useEffect(()=>{if(!auto||busy||!state?.ready)return;const timer=setTimeout(()=>{void act('step',{ticks:3});},50);return()=>clearTimeout(timer);},[auto,busy,state]);
 if(!state)return <main><h1>Боевой полигон</h1><p role="status">{error||'Подключение…'}</p></main>;
 const snapshot=state.snapshot,player=snapshot.combat.actors.find(a=>a.kind==='player'),enemy=snapshot.combat.actors.find(a=>a.kind==='npc');
 const items=(snapshot.economy.players[0]?.active?.items??[]) as unknown as {id:string;template:string;quantity:number}[];
 const owned=(template:string)=>items.filter(i=>i.template===template).sort((a,b)=>b.quantity-a.quantity)[0];
 const disabled=busy||!state.ready||!!pending||!player||player.hp===0;
 const command=(intent:string)=>{if(player)void act('input',{version:state.manifest.version,rulesHash:state.manifest.rulesHash,sequence:player.sequence+1,intent});};
 const equip=()=>{const item=owned(choice==='bow'?'hunting_bow':choice==='staff'?'fire_staff':'iron_sword');if(item)void act('equip',{weaponId:item.id,...(choice==='sword'&&owned('iron_shield')?{shieldId:owned('iron_shield').id}:{}),...(owned('leather_armor')?{armorId:owned('leather_armor').id}:{})});};
 return <main>
  <header><div><a href="/?demo=1">← Убежище</a><p className="eyebrow">SKYRIM EXTRACTION · ПОЛИГОН</p><h1>Освой ритм боя.</h1><p>Серверная симуляция без Skyrim. Здесь можно проверить правила и восстановление после сбоя.</p></div><span className={'status '+(state.ready?'live':'paused')}>{snapshot.status==='CLOSED'?'Рейд закрыт':state.ready?'Готов':'Мир заморожен'}</span></header>
  {error&&<div className="notice" role="alert"><strong>Действие приостановлено</strong><span>{error}</span></div>}
  {(pending||(!state.ready&&snapshot.status==='OPEN'))&&<div className="recovery"><p>Сначала подтвердим сохранённое состояние. Повтор не расходует предмет второй раз.</p><button disabled={busy} onClick={()=>{void (async()=>{if(!state.ready)await act('retry');if(pending)await send(pending);})();}}>{pending?'Повторить запрос':'Восстановить состояние'}</button></div>}
  <div className="arena">
   {player&&<CombatHud actor={player} name="Вы"/>}
   <div className="duel"><span className="duel-mark">⚔</span><strong>{(snapshot.combat.tick/60).toFixed(1)} с</strong><span>время симуляции</span><div className="badges"><span>Ближний бой</span><span>Фронтальный контакт</span></div><small>Позиции и столкновения условные</small></div>
   {enemy&&<CombatHud actor={enemy} name="Страж"/>}
  </div>
  <div className="workbench"><section className="panel"><h2>Действия</h2><p className="muted">Удар → окно попадания → восстановление. Ускорьте время для следующего действия.</p>
   <div className="actions">{Object.entries(names).map(([intent,name])=><button key={intent} disabled={disabled||(intent==='releaseGuard'?player?.action.kind!=='guard':!['idle','guard'].includes(player?.action.kind??''))||(['guard','parry'].includes(intent)&&!player?.shield)} onClick={()=>command(intent)}>{name}</button>)}</div>
   <div className="time-controls"><button disabled={busy||!state.ready||!!pending} onClick={()=>void act('step',{ticks:60})}>Вперёд на 1 секунду</button><label><input type="checkbox" checked={auto} disabled={!state.ready||!!pending} onChange={e=>setAuto(e.target.checked)}/> Время идёт</label></div>
   <button className="enemy-control" disabled={busy||!state.ready||!!pending||!enemy||enemy.hp===0||enemy.action.kind!=='idle'||!player||player.hp===0} onClick={()=>void act('enemy',{intent:'light'})}>Страж: быстрый удар</button>
  </section><section className="panel"><h2>Снаряжение и припасы</h2>
   <div className="equip"><label>Оружие<select aria-label="Оружие" value={choice} onChange={e=>setChoice(e.target.value)}><option value="sword">Меч и щит</option><option value="bow">Лук</option><option value="staff">Посох пламени</option></select></label><button disabled={disabled||player?.action.kind!=='idle'} onClick={equip}>Надеть</button></div>
   <p className="muted">{player?{light:'Лёгкая',medium:'Средняя',heavy:'Тяжёлая'}[player.weight]:'—'} нагрузка · Стрелы: {owned('iron_arrow')?.quantity??0}</p>
   <div className="supplies">{(['healing_potion','stamina_potion','magicka_potion'] as const).map(template=>{const item=owned(template);const full=template==='healing_potion'?player?.hp===100:template==='stamina_potion'?player?.stamina===100000:player?.magicka===100000;return <button key={template} disabled={disabled||!item||full||player?.action.kind!=='idle'} onClick={()=>void act('use',{itemId:item.id})}>{state.items[template].name} <span>×{items.filter(i=>i.template===template).reduce((n,i)=>n+i.quantity,0)}</span></button>;})}</div>
   <p className="muted">Эффект и списание предмета сохраняются вместе.</p>
  </section></div>
  <section className="panel journal"><h2>Последние события</h2>{!state.events.length?<p className="muted">Нанесите удар и продвиньте время — здесь появится результат.</p>:<ol>{state.events.slice(-8).reverse().map(e=><li key={e.id}><time>{(e.tick/60).toFixed(1)} с</time><strong>{e.attackerId===player?.id?'Вы':'Страж'}</strong><span>{outcomes[e.outcome]}{e.damage?` · −${e.damage} HP`:''}{e.killed?' · цель погибла':''}</span></li>)}</ol>}</section>
  <details className="panel"><summary>Проверка сбоя и сохранения</summary><p>Сбой произойдёт после сохранения следующего действия, до подтверждения его применения. Игра остаётся на паузе до восстановления.</p><button disabled={disabled} onClick={()=>void act('fault')}>Имитировать сбой</button><button disabled={busy||!!pending||snapshot.status==='CLOSED'} onClick={()=>{setAuto(false);void act('recover');}}>Закрыть рейд с восстановлением</button><p className="muted">Контрольная точка {snapshot.revision} · подтверждена {snapshot.acknowledged}. {player?actionNames[player.action.kind]:''}</p></details>
  <footer>Логика боя и SQLite настоящие; физика, анимации и сетевые клиенты Skyrim здесь не проверяются.</footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
