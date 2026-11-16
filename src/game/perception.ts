import {Camera,Object3D,Raycaster,Vector2} from 'three';
import type {ViewContext} from './npc-contract';
export function pointedTarget(camera:Camera,objects:Object3D[]):ViewContext['target'] {
  const ray=new Raycaster();ray.far=40;ray.setFromCamera(new Vector2(),camera);
  const hit=ray.intersectObjects(objects,true).find(h=>h.object.type==='Mesh');if(!hit)return;
  const p=hit.point;if(Math.abs(p.x)>20||Math.abs(p.z)>20||p.y<-.1||p.y>10)return;
  let object:Object3D|null=hit.object,name=hit.object.name||'Visible surface';
  while(object){if(object.userData.interactable){name=object.userData.interactable.name;break;}object=object.parent;}
  const ground=p.y<=.1 && !!hit.face && hit.face.normal.y>.9;
  return {x:p.x,y:p.y,z:p.z,name:ground?'Courtyard ground':name,ground};
}
export function captureView(canvas:HTMLCanvasElement):string {
  const image=document.createElement('canvas');image.width=640;image.height=Math.round(canvas.height/canvas.width*640);
  const context=image.getContext('2d')!;context.drawImage(canvas,0,0,image.width,image.height);
  const x=image.width/2,y=image.height/2;
  context.strokeStyle='#ff3030';context.lineWidth=2;context.beginPath();context.moveTo(x-8,y);context.lineTo(x+8,y);context.moveTo(x,y-8);context.lineTo(x,y+8);context.stroke();
  return image.toDataURL('image/jpeg',.75);
}
