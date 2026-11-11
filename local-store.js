export class LocalStore {
  constructor(name) {
    this.ready = new Promise((resolve,reject) => {
      const request = indexedDB.open(name,1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async get(key) {
    const db = await this.ready;
    return new Promise((resolve,reject) => {
      const r = db.transaction('state').objectStore('state').get(key);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async set(key,value) {
    const db = await this.ready;
    return new Promise((resolve,reject) => {
      const tx = db.transaction('state','readwrite');
      tx.objectStore('state').put(value,key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  async getMany(keys) {
    const db=await this.ready;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('state'),state=tx.objectStore('state'),values=new Map();
      for(const key of new Set(keys)){const request=state.get(key);request.onsuccess=()=>values.set(key,request.result);}
      tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async getLinked(key,links) {
    const db=await this.ready;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('state'),state=tx.objectStore('state'),values=new Map(),seen=new Set();let error;
      const read=key=>{
        if(seen.has(key))return;seen.add(key);
        const request=state.get(key);
        request.onsuccess=()=>{try{values.set(key,request.result);for(const child of links(key,request.result))read(child);}catch(cause){error=cause;tx.abort();}};
      };
      read(key);
      tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
    });
  }
  async update(key,transform) {
    const db=await this.ready;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('state','readwrite'),state=tx.objectStore('state'),request=state.get(key);let next,error;
      // Related records commit or roll back with the primary record.
      request.onsuccess=()=>{try{next=transform(request.result,{put:(key,value)=>state.put(value,key),delete:key=>state.delete(key)});state.put(next,key);}catch(cause){error=cause;tx.abort();}};
      tx.oncomplete=()=>resolve(next);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
    });
  }
}

