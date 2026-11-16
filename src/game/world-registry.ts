import {Box3,Group,Mesh,BoxGeometry,MeshStandardMaterial,Vector3,Color,type Object3D,type Scene} from 'three';
import type {WorldObject,WorldSnapshot,WorldInteraction} from './world-contract';

type Binding={mesh:Object3D;info:Omit<WorldObject,'position'|'bounds'|'state'>;state?:()=>string;interact?:(action:WorldInteraction)=>string;seat?:Vector3;footprint?:Box3};
export class WorldRegistry {
  private bindings=new Map<string,Binding>();
  constructor(readonly id:string,readonly name:string,readonly limit:number){}
  register(mesh:Object3D,info:Omit<WorldObject,'position'|'bounds'|'state'|'color'|'actions'|'aliases'> & Partial<Pick<WorldObject,'color'|'actions'|'aliases'>>,options:Pick<Binding,'state'|'interact'|'seat'|'footprint'>={}){
    const entry={...info,color:info.color||'',actions:info.actions||[],aliases:info.aliases||[]};
    this.bindings.set(info.id,{mesh,info:entry,...options});mesh.userData.worldObjectId=info.id;
    mesh.userData.interactable={id:info.id,name:info.name,kind:'marker'};
  }
  snapshot():WorldSnapshot{
    return {id:this.id,name:this.name,limit:this.limit,objects:[...this.bindings.values()].map(binding=>this.describe(binding))};
  }
  private describe(binding:Binding):WorldObject{
      binding.mesh.updateWorldMatrix(true,true);const box=new Box3().setFromObject(binding.mesh),p=binding.mesh.getWorldPosition(new Vector3());
      if(binding.footprint)box.union(binding.footprint);
      return {...binding.info,position:{x:p.x,z:p.z},bounds:{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z},state:binding.state?.()||''};
  }
  get(id:string){const binding=this.bindings.get(id);return binding?this.describe(binding):undefined;}
  focus(id:string){const binding=this.bindings.get(id);if(!binding)return;binding.mesh.updateWorldMatrix(true,true);const center=new Box3().setFromObject(binding.mesh).getCenter(new Vector3());center.y=Math.min(2.5,Math.max(.3,center.y));return center;}
  interact(id:string,action:WorldInteraction):{message:string;seat?:Vector3}{
    const binding=this.bindings.get(id);if(!binding||!binding.info.actions.includes(action))throw Error('Unsupported interaction');
    return {message:binding.interact?.(action)||binding.info.description,...(action==='sit'&&binding.seat?{seat:binding.seat.clone()}: {})};
  }
}

export function colorName(hex:string):string{
  const hsl={h:0,s:0,l:0};new Color(hex).getHSL(hsl);
  if(hsl.s<.12)return hsl.l>.7?'white':hsl.l<.15?'black':'gray';
  if(hsl.h<.04||hsl.h>.92)return hsl.l>.3?'pink':'red';
  if(hsl.h<.13)return hsl.l<.35?'brown':'orange';
  if(hsl.h<.2)return 'yellow';if(hsl.h<.46)return 'green';if(hsl.h<.58)return 'teal';if(hsl.h<.72)return 'blue';return 'purple';
}

export function addBench(scene:Scene,colliders:Box3[],registry:WorldRegistry,color='#68543b'){
  const group=new Group();group.position.set(7,0,0);scene.add(group);
  const material=new MeshStandardMaterial({color,roughness:.85});
  const piece=(x:number,y:number,z:number,w:number,h:number,d:number)=>{const mesh=new Mesh(new BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);};
  piece(0,.65,0,2.6,.18,1);piece(0,1.12,-.42,2.6,.8,.15);
  for(const x of [-1,1])for(const z of [-.3,.3])piece(x,.3,z,.16,.6,.16);
  colliders.push(new Box3(new Vector3(5.7,0,-.5),new Vector3(8.3,1.6,.5)));
  registry.register(group,{id:'bench',name:'Wooden bench',aliases:['bench','seat','wooden seat'],kind:'bench',color:colorName(color),description:'A wooden bench with a backrest beside the path.',actions:['sit']},{seat:new Vector3(7,.25,.1),interact:()=> 'Bench seat occupied by NPC; seated posture applied.'});
}
