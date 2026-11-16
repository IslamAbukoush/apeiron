import type {ViewContext} from '../src/game/npc-contract.ts';
export function validateView(value:unknown,limit=25):ViewContext {
  if(value===undefined)return {};
  const view=value as ViewContext;
  if(!view || typeof view!=='object')throw Error('Invalid view');
  const result:ViewContext={};
  if(view.image!==undefined){
    if(typeof view.image!=='string'||view.image.length>1000000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(view.image))throw Error('Invalid image');
    const bytes=Buffer.from(view.image.split(',')[1],'base64');if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid JPEG');
    result.image=view.image;
  }
  if(view.target!==undefined){const t=view.target;
    if(!t||![t.x,t.y,t.z].every(Number.isFinite)||Math.abs(t.x)>limit||Math.abs(t.z)>limit||t.y<-.1||t.y>10||typeof t.ground!=='boolean'||typeof t.name!=='string'||t.name.length>100)throw Error('Invalid target');
    if(t.objectId!==undefined&&(typeof t.objectId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(t.objectId)))throw Error('Invalid target ID');
    result.target={...(t.objectId?{objectId:t.objectId}:{}),x:t.x,y:t.y,z:t.z,name:t.name,ground:t.ground&&t.y<=.1};
  }
  return result;
}
