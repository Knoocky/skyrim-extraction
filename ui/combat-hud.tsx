import type {Fighter} from '../src/combat.ts';
export const actionNames:Record<string,string>={idle:'Готов к действию',light:'Быстрый удар',heavy:'Сильный удар',dodge:'Перекат',guard:'Блок',parry:'Парирование',stagger:'Пошатнулся',dead:'Погиб',equip:'Восстановление'};
export function CombatHud({actor,name}:{actor:Fighter;name:string}){
 return <section className="fighter" aria-label={name}>
  <div className="fighter-title"><h2>{name}</h2><span>{actor.connected?'В бою':'Нет связи'}</span></div>
  {([['Здоровье',actor.hp,100,'health'],['Выносливость',actor.stamina,100000,'stamina'],['Магия',actor.magicka,100000,'magicka']] as const).map(([label,value,max,css])=><div className="resource" key={label}>
   <div><span>{label}</span><strong>{Math.ceil(value/max*100)} / 100</strong></div>
   <progress className={css} aria-label={`${name}: ${label}`} value={value} max={max}/>
  </div>)}
  <div className="fighter-state"><span>{actionNames[actor.action.kind]}</span><span>Защита {actor.armor}%</span></div>
 </section>;
}
