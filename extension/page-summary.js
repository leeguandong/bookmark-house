const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
const noise=/^(?:登录|注册|扫码|验证|同意|接受|拒绝|隐私政策|用户协议|版权|关注我们|相关推荐|返回首页|下一页|上一页|目录|分享|订阅|sign in|log in|sign up|accept cookies|privacy policy|cookie settings|all rights reserved)(?:\s|[，。,:：.!]|$)/i;
function terms(value){
  const input=compact(value).toLowerCase(),words=input.match(/[a-z][a-z\d-]{2,}|[\u3400-\u9fff]{2,}/g)||[],result=[];
  for(const word of words)if(/[\u3400-\u9fff]/.test(word)){for(let i=0;i<word.length-1;i++)result.push(word.slice(i,i+2));}else result.push(word);
  return result.filter(word=>!['这个','一个','可以','我们','他们','以及','通过','进行','使用','the','and','with','that','for','this','from','are','you','your'].includes(word));
}
export function summarizePage({title='',description='',passages=[]}={}){
  const body=(Array.isArray(passages)?passages:[]).slice(0,80).map(compact).filter(line=>line.length>=24&&!noise.test(line)&&line!==compact(title));
  const source=body.length?body:[compact(description)].filter(Boolean);
  if(!source.length)return '';
  const seen=new Set(),sentences=[];
  for(const paragraph of source){
    for(const raw of paragraph.slice(0,1600).match(/[^。！？\n]+[。！？]?/g)||[]){
      for(const piece of raw.split(/(?<=[.!?])\s+(?=[A-Z])/)){
        const sentence=compact(piece);if(sentence.length<18||noise.test(sentence)||seen.has(sentence)||sentence===compact(title))continue;
        seen.add(sentence);sentences.push(sentence);if(sentences.length>=90)break;
      }
      if(sentences.length>=90)break;
    }
    if(sentences.length>=90)break;
  }
  if(!sentences.length){const fallback=compact(description);return fallback.length>=4&&!noise.test(fallback)&&fallback!==compact(title)?fallback.slice(0,420):'';}
  const counts=new Map(),titleTerms=new Set(terms(title));
  const rows=sentences.map((sentence,index)=>{const words=new Set(terms(sentence));for(const word of words)counts.set(word,(counts.get(word)||0)+1);return {sentence,index,words};});
  for(const row of rows){let relevance=0;for(const word of row.words)relevance+=Math.min(counts.get(word)||0,5)+(titleTerms.has(word)?4:0);row.score=relevance/Math.sqrt(Math.max(row.words.size,8))+3/(row.index+1)+(row.sentence.length>=40&&row.sentence.length<=220?1:0);}
  const chosen=[];let length=0;
  for(const row of [...rows].sort((a,b)=>b.score-a.score||a.index-b.index)){
    if(chosen.some(old=>{const same=[...row.words].filter(word=>old.words.has(word)).length;return same/Math.max(Math.min(row.words.size,old.words.size),1)>.82;}))continue;
    const sentence=row.sentence.length>230?row.sentence.slice(0,225).replace(/[，,;；、\s]+$/,'')+'…':row.sentence;
    if(chosen.length&&length+sentence.length>420)continue;
    chosen.push({...row,sentence});length+=sentence.length;if(chosen.length>=3||length>=310)break;
  }
  return chosen.sort((a,b)=>a.index-b.index).map(row=>row.sentence).join(' ').slice(0,420);
}
