import {Box3,Group,Mesh,Vector3,type BufferAttribute,type Material} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const clamp=(x:number)=>Math.max(0,Math.min(1,x));
type Surface={mesh:Mesh;rest:Float32Array;position:BufferAttribute};
const avatars=new WeakMap<Group,MonkAvatar>();
/** The supplied static mesh has no usable skin: deform its robe/arms gently in model space. */
export class MonkAvatar {
  private surfaces:Surface[]=[];
  private visual=new Group();
  private disposed=false;
  private time=0;
  private gait=0;
  private speed=0;
  private facing=0;
  private last=new Vector3();
  private seat=0;
  constructor(readonly root:Group){
    root.add(this.visual);root.userData.avatarState='loading';root.userData.avatarModel='monk';this.last.copy(root.position);
    if(typeof window!=='undefined')void this.load();
  }
  private async load(){
    try{
      const gltf=await new GLTFLoader().loadAsync('/models/monk/scene.gltf');
      gltf.scene.updateMatrixWorld(true);const bounds=new Box3().setFromObject(gltf.scene),center=bounds.getCenter(new Vector3()),scale=1.8/(bounds.max.y-bounds.min.y);
      gltf.scene.traverse(object=>{
        if(!(object instanceof Mesh))return;
        const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld),position=geometry.getAttribute('position') as BufferAttribute;
        for(let i=0;i<position.count;i++)position.setXYZ(i,(position.getX(i)-center.x)*scale,(position.getY(i)-bounds.min.y)*scale,(position.getZ(i)-center.z)*scale);
        geometry.computeVertexNormals();geometry.computeBoundingSphere();
        const mesh=new Mesh(geometry,object.material);mesh.name='Monk textured mesh';mesh.castShadow=true;mesh.receiveShadow=true;
        if(this.disposed){this.release(mesh);return;}
        this.visual.add(mesh);this.surfaces.push({mesh,position,rest:Float32Array.from(position.array)});
      });
      // Source buffers are distinct from the transformed render buffers.
      gltf.scene.traverse(object=>{if(object instanceof Mesh)object.geometry.dispose();});
      if(!this.disposed){this.root.userData.avatarState='ready';this.update(0,false,false);}
    }catch{if(!this.disposed){this.root.userData.avatarState='error';console.warn('Monk character could not load. Check /models/monk/scene.gltf.');}}
  }
  update(dt:number,seated:boolean,jumping:boolean){
    const distance=Math.hypot(this.root.position.x-this.last.x,this.root.position.z-this.last.z);this.last.copy(this.root.position);
    this.time+=dt;this.speed+=(Math.min(dt>0?distance/dt:0,1.6)-this.speed)*(1-Math.exp(-dt*12));this.gait+=dt*(3+this.speed*4);
    this.seat+=(Number(seated)-this.seat)*(1-Math.exp(-dt*10));
    const turn=Math.atan2(Math.sin(this.root.rotation.y-this.facing),Math.cos(this.root.rotation.y-this.facing));this.facing+=turn*(1-Math.exp(-dt*10));
    this.visual.rotation.y=this.facing-this.root.rotation.y;
    const walk=clamp(this.speed/1.6)*(1-this.seat),swing=Math.sin(this.gait),breath=Math.sin(this.time*1.8);
    this.visual.position.y=(1-Math.cos(this.gait*2))*.018*walk;
    this.visual.rotation.z=swing*.025*walk+Math.sin(this.time*.65)*.007*(1-walk);
    this.root.userData.avatarAnimation=seated?'sit':jumping?'jump':walk>.15?'walk':'idle';
    for(const {mesh,rest,position} of this.surfaces){
      for(let i=0;i<position.count;i++){
        const offset=i*3,rx=rest[offset],ry=rest[offset+1],rz=rest[offset+2],side=Math.sign(rx)||1;
        let x=rx,y=ry,z=rz;
        const arm=clamp((Math.abs(rx)-.28)/.13)*clamp((ry-.83)/.1)*clamp((1.25-ry)/.07);
        if(arm>0){
          const angle=-side*(.8-.12*Number(jumping)) *arm,px=x-side*.26,py=y-1.13;
          x=side*.26+px*Math.cos(angle)-py*Math.sin(angle);y=1.13+px*Math.sin(angle)+py*Math.cos(angle);
          z+=arm*(side*swing*.14*walk+.025*Math.sin(this.time*1.2+side));
        }
        if(ry>1.23){const head=clamp((ry-1.23)/.15),angle=Math.sin(this.time*.6)*.025*head;x=x*Math.cos(angle)+z*Math.sin(angle);z=z*Math.cos(angle)-rx*Math.sin(angle);}
        if(ry<.8)z+=Math.sin(this.gait+side*Math.PI)*.055*walk*(1-ry/.8);
        x*=1+breath*.006*clamp(ry/.8);y+=breath*.007*clamp(ry/.8);
        if(this.seat>0){const sy=ry>=.9?y-.4:ry>=.45?.5+(ry-.45)*.04:.08+ry*.94;const sz=z+(ry<.9?Math.min(.42,(.9-ry)*.94):0);y+=(sy-y)*this.seat;z+=(sz-z)*this.seat;}
        position.setXYZ(i,x,y,z);
      }
      position.needsUpdate=true;mesh.geometry.computeBoundingSphere();mesh.geometry.computeBoundingBox();
    }
  }
  private release(mesh:Mesh){
    mesh.geometry.dispose();for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]) as (Material&{map?:{dispose():void}})[]){material.map?.dispose();material.dispose();}
  }
  dispose(){this.disposed=true;for(const {mesh} of this.surfaces)this.release(mesh);this.surfaces=[];this.visual.clear();}
}
export function createCaretakerAvatar(){
  const root=new Group();root.name='Monk caretaker';root.position.set(0,0,-2);root.userData.interactable={id:'caretaker',name:'The caretaker',kind:'npc'};
  avatars.set(root,new MonkAvatar(root));return root;
}
export function caretakerAvatar(root:Group):MonkAvatar|undefined{return avatars.get(root);}
