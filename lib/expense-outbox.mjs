export function createExpenseOutbox({store,send,isActive,notify=()=>{}}) {
  const running=new Map();
  async function enqueue(owner,payload) {
    if(!isActive(owner))throw new Error('Sign in again before saving.');
    const key=`${owner}:${payload.p_id}`;
    const prior=await store.get(key);
    if(prior && JSON.stringify(prior.payload)!==JSON.stringify(payload))throw new Error('This draft ID was already used. Reopen the form.');
    if(!prior)await store.put({key,owner,payload,created:Date.now(),error:null,blocked:false});
    notify();
  }
  function flush(owner,{retry=false}={}) {
    if(running.has(owner))return running.get(owner);
    const task=(async()=>{
      for(const row of await store.list(owner)) {
        if(!isActive(owner))break;
        if(row.blocked && !retry)continue;
        try {
          await send(owner,row.payload);
          // The server committed this exact owner's request. Removing its local
          // receipt is safe even if they signed out while it was in flight.
          await store.remove(row.key);notify();
        }catch(error){
          await store.put({...row,error:error.message || 'Could not sync. Retry when online.',blocked:error.permanent===true});notify();
          if(!error.permanent)break;
        }
      }
    })().finally(()=>running.delete(owner));
    running.set(owner,task);return task;
  }
  async function clear(owner) {
    // Wait for any captured-token write to finish before removing its receipt.
    await running.get(owner);
    for(const row of await store.list(owner))await store.remove(row.key);
    notify();
  }
  async function discardRejected(owner,id) {
    if(!isActive(owner) || running.has(owner))throw new Error('Wait for syncing to finish.');
    const row=await store.get(`${owner}:${id}`);
    if(!row?.blocked || row.owner!==owner)throw new Error('Retry this draft first to confirm whether it was saved.');
    await store.remove(row.key);notify();
  }
  return {enqueue,flush,clear,discardRejected,list:owner=>store.list(owner)};
}

export function indexedOutbox() {
  let opening;
  function open() {
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('expensive-outbox-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('expenses',{keyPath:'key'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{opening=null;reject(new Error('Could not save the offline draft. Check browser storage.'));};
    });
    return opening;
  }
  async function transaction(mode,action) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('expenses',mode),request=action(tx.objectStore('expenses'));
      tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Draft storage was interrupted.'));
    });
  }
  return {
    get:key=>transaction('readonly',s=>s.get(key)),
    put:row=>transaction('readwrite',s=>s.put(row)),
    remove:key=>transaction('readwrite',s=>s.delete(key)),
    list:async owner=>(await transaction('readonly',s=>s.getAll())).filter(row=>row.owner===owner).sort((a,b)=>a.created-b.created),
  };
}
