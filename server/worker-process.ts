import {spawnSync,type ChildProcess} from 'node:child_process';

/** Windows venv launchers spawn a second Python process; stop the owned tree. */
export function stopWorker(child:ChildProcess|undefined){
  if(!child?.pid||child.exitCode!==null)return;
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
  else child.kill();
}
export const cpuWorkerEnv={OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',NUMEXPR_NUM_THREADS:'1'};
