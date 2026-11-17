import {test as base,expect} from '@playwright/test';

/** Simulate the pointer-lock lifecycle without ever calling OS mouse capture. */
export const test=base.extend({
  page:async({page},use)=>{
    await page.addInitScript(()=>{
      let locked:Element|null=null;
      Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>locked});
      Element.prototype.requestPointerLock=async function(){
        locked=this;document.dispatchEvent(new Event('pointerlockchange'));
      };
      document.exitPointerLock=()=>{
        if(!locked)return;locked=null;document.dispatchEvent(new Event('pointerlockchange'));
      };
      document.addEventListener('keydown',event=>{if(event.code==='Escape')document.exitPointerLock();});
    });
    await use(page);
  },
});
export {expect};
