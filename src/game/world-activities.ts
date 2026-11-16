import {Box3,BoxGeometry,CylinderGeometry,Group,Mesh,MeshStandardMaterial,OctahedronGeometry,SphereGeometry,TorusGeometry,Vector3,type Scene} from 'three';
import type {WorldRegistry} from './world-registry';

/** Small stateful toys shared by every world; their facts/capabilities feed the NPC registry. */
export function addWorldActivities(scene:Scene,colliders:Box3[],registry:WorldRegistry){
  const events:('bell'|'water'|'chest')[]=[];
  const wood=new MeshStandardMaterial({color:'#694a32',roughness:.9}),gold=new MeshStandardMaterial({color:'#d7ab50',metalness:.55,roughness:.35}),green=new MeshStandardMaterial({color:'#548344'});
  const part=(parent:Group,geometry:BoxGeometry|CylinderGeometry|SphereGeometry|TorusGeometry|OctahedronGeometry,material:MeshStandardMaterial,x:number,y:number,z:number)=>{const mesh=new Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const group=(x:number,z:number)=>{const g=new Group();g.position.set(x,0,z);scene.add(g);return g;};
  const solid=(x:number,z:number,w:number,d:number,h:number)=>colliders.push(new Box3(new Vector3(x-w/2,0,z-d/2),new Vector3(x+w/2,h,z+d/2)));

  const bell=group(-3,11),swing=new Group();swing.position.y=2.1;bell.add(swing);
  part(bell,new BoxGeometry(1.8,.18,1.2),wood,0,.09,0);
  for(const x of [-.7,.7])part(bell,new BoxGeometry(.15,2.2,.18),wood,x,1.2,0);
  part(bell,new BoxGeometry(1.65,.16,.22),wood,0,2.3,0);
  part(swing,new CylinderGeometry(.18,.42,.5,16,1,true),gold,0,-.35,0);
  part(swing,new SphereGeometry(.09,8,6),gold,0,-.65,0);
  const rim=part(swing,new TorusGeometry(.4,.045,6,20),gold,0,-.6,0);rim.rotation.x=Math.PI/2;
  let rings=0,ringTime=0;
  registry.register(bell,{id:'bell',name:'Courtyard bell',aliases:['bell','gong','chime'],kind:'bell',color:'gold',description:'A hanging brass bell in a wooden frame. Ring it to hear a chime and make it swing.',actions:['ring']},{state:()=>`rung ${rings} times`,interact:()=>{rings++;ringTime=3;events.push('bell');return `Bell struck; total strikes: ${rings}.`;}});solid(-3,11,1.8,1.2,2.4);

  const garden=group(3,11);part(garden,new BoxGeometry(1.8,.25,1.4),wood,0,.125,0);
  part(garden,new BoxGeometry(1.55,.12,1.15),new MeshStandardMaterial({color:'#45332b'}),0,.29,0);
  const flowers=new Group();flowers.position.y=.3;garden.add(flowers);flowers.scale.y=.55;
  for(const [index,x] of [-.5,0,.5].entries()){
    const z=index%2?.25:-.2;part(flowers,new CylinderGeometry(.025,.035,.65,6),green,x,.325,z);
    const petals=new MeshStandardMaterial({color:['#db658a','#9272d4','#efbd52'][index]});
    for(let p=0;p<6;p++){const angle=p*Math.PI/3;part(flowers,new SphereGeometry(.115,6,5),petals,x+Math.cos(angle)*.15,.67,z+Math.sin(angle)*.15);}
    part(flowers,new SphereGeometry(.1,6,5),gold,x,.71,z);
  }
  let watered=false;
  registry.register(garden,{id:'flowerbed',name:'Flower garden',aliases:['flowerbed','flowers','flower garden','garden bed','plants'],kind:'flowerbed',color:'pink',description:'Three flowers in a raised garden bed. Watering makes them grow taller.',actions:['water']},{state:()=>watered?'watered; flowers blooming':'dry; flowers need water',interact:()=>{const was=watered;watered=true;if(!was)events.push('water');return was?'Soil already watered; flowers healthy.':'Soil watered; flower growth started.';}});solid(3,11,1.8,1.4,.35);

  const chest=group(0,-7);part(chest,new BoxGeometry(1.35,.65,.85),wood,0,.325,0);
  for(const x of [-.45,.45])part(chest,new BoxGeometry(.09,.68,.89),gold,x,.35,0);
  const lid=new Group();lid.position.set(0,.7,-.42);chest.add(lid);part(lid,new BoxGeometry(1.4,.18,.88),wood,0,.04,.42);
  for(const x of [-.45,.45])part(lid,new BoxGeometry(.1,.2,.9),gold,x,.04,.42);
  part(chest,new BoxGeometry(.15,.2,.07),gold,0,.55,.46);
  const treasure=new Group();chest.add(treasure);const gemMaterial=new MeshStandardMaterial({color:'#65d8c0',emissive:'#2f8e80',emissiveIntensity:.6,metalness:.25,roughness:.3});
  for(const x of [-.32,0,.32])part(treasure,new OctahedronGeometry(.15),gemMaterial,x,.65,0);
  let opened=false,time=0;
  registry.register(chest,{id:'treasure-chest',name:'Crystal treasure chest',aliases:['chest','treasure','treasure chest','crystal chest'],kind:'chest',color:'brown',description:'A wooden treasure chest with brass bands. Open it to reveal three floating green crystals; close it to hide them.',actions:['open']},{state:()=>opened?'open':'closed',interact:()=>{opened=!opened;events.push('chest');return `Chest state: ${opened?'open; three crystals revealed':'closed; crystals concealed'}.`;}});solid(0,-7,1.4,.9,.85);
  return {events,update(dt:number){
    time+=dt;ringTime=Math.max(0,ringTime-dt);swing.rotation.x=Math.sin(time*13)*Math.min(1,ringTime)*.3;
    flowers.scale.y+=((watered?1.35:.55)-flowers.scale.y)*(1-Math.exp(-dt*2));
    lid.rotation.x+=((opened?-Math.PI*.58:0)-lid.rotation.x)*(1-Math.exp(-dt*7));treasure.visible=opened;
    treasure.position.y=opened?.15+Math.sin(time*2)*.08:0;treasure.rotation.y=opened?time*.5:0;
  }};
}
