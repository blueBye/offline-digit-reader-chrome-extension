import {normalizeRules, matchesRules, normalizeText} from './config.js';
// Do not pad, guess, or change case. Exact format validation is mandatory.
export const normalizeDigits = value => String(value??'').replace(/[^0-9]/g,'');
function center(poly){
  if(!Array.isArray(poly))return 0;
  return poly.reduce((sum,p)=>sum+(Array.isArray(p)?Number(p[0])||0:0),0)/Math.max(1,poly.length);
}
export function fromOcrResult(result,mode,rules={}) {
  const normalized=normalizeRules(rules), items=Array.isArray(result?.items)?result.items:[];
  const candidates=[];
  for(const item of items){
    const raw=String(item.text??'');
    const text=normalized.digits&&!normalized.lowercase&&!normalized.uppercase ? normalizeDigits(raw) : normalizeText(raw);
    if(!text)continue;
    candidates.push({text,digits:text,raw,mode,score:Number.isFinite(item.score)?item.score:0,poly:item.poly});
  }
  if(candidates.length>1){
    const ordered=[...candidates].sort((a,b)=>center(a.poly)-center(b.poly));
    const text=ordered.map(i=>i.text).join('');
    if(matchesRules(text,normalized))candidates.push({text,digits:text,raw:ordered.map(i=>i.raw).join(' '),mode,
      score:ordered.reduce((sum,i)=>sum+i.score,0)/ordered.length,grouped:true});
  }
  return candidates;
}
export function chooseCandidate(candidates,rules={}) {
  const r=normalizeRules(rules);
  return [...candidates].filter(c=>matchesRules(c.text??c.digits,r)).sort((a,b)=>b.score-a.score)[0]||null;
}
