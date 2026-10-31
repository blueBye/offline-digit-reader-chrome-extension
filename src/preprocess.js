// Native-resolution noise cleaning retained from the previous reader; no template matching or digit classification.

function otsu(gray) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
  let total = gray.length, sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let bgWeight = 0, bgSum = 0, best = 125, bestVariance = -1;
  for (let i = 0; i < 256; i++) {
    bgWeight += histogram[i];
    if (!bgWeight) continue;
    const fgWeight = total - bgWeight;
    if (!fgWeight) break;
    bgSum += i * histogram[i];
    const delta = bgSum / bgWeight - (sum - bgSum) / fgWeight;
    const variance = bgWeight * fgWeight * delta * delta;
    if (variance > bestVariance) {bestVariance = variance; best = i;}
  }
  return best;
}

function convolveGaussian(gray, width, height, radius) {
  if (!radius) return gray;
  const kernel = radius === 1 ? [1, 2, 1] : [1, 4, 6, 4, 1];
  const r = (kernel.length - 1) / 2, norm = kernel.reduce((a,b) => a+b, 0);
  const tmp = new Uint8Array(gray.length), output = new Uint8Array(gray.length);
  for (let y=0; y<height; y++) for(let x=0; x<width; x++) {
    let sum=0;
    for(let k=-r; k<=r; k++) sum+=gray[y*width+Math.max(0,Math.min(width-1,x+k))]*kernel[k+r];
    tmp[y*width+x]=Math.round(sum/norm);
  }
  for (let y=0; y<height; y++) for(let x=0; x<width; x++) {
    let sum=0;
    for(let k=-r; k<=r; k++) sum+=tmp[Math.max(0,Math.min(height-1,y+k))*width+x]*kernel[k+r];
    output[y*width+x]=Math.round(sum/norm);
  }
  return output;
}

function adaptiveBinarize(gray, w, h) {
  const integral = new Uint32Array((w+1)*(h+1));
  for(let y=1;y<=h;y++) {
    let row=0;
    for(let x=1;x<=w;x++) {
      row += gray[(y-1)*w+x-1];
      integral[y*(w+1)+x] = integral[(y-1)*(w+1)+x]+row;
    }
  }
  const r=Math.max(9,Math.round(h*0.12)), binary=new Uint8Array(gray.length);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const x0=Math.max(0,x-r), y0=Math.max(0,y-r), x1=Math.min(w,x+r+1), y1=Math.min(h,y+r+1);
    const sum=integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0];
    const mean=sum/((x1-x0)*(y1-y0));
    binary[y*w+x]=gray[y*w+x] < Math.min(215,mean-17) ? 1:0;
  }
  return binary;
}

function removeSpeckles(binary,w,h) {
  const visited=new Uint8Array(binary.length), stack=new Int32Array(binary.length);
  const minimumPixels=Math.max(4,Math.floor(h*h*0.0012));
  const neighbors=[-w-1,-w,-w+1,-1,1,w-1,w,w+1];
  for(let i=0;i<binary.length;i++) {
    if(!binary[i] || visited[i]) continue;
    let count=0, head=0, minY=h,maxY=0;
    stack[count++]=i;visited[i]=1;
    while(head<count) {
      const pos=stack[head++],x=pos%w,y=Math.floor(pos/w);
      if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(const offset of neighbors) {
        const n=pos+offset, nx=n%w;
        if(n<0||n>=binary.length||Math.abs(nx-x)>1||!binary[n]||visited[n])continue;
        visited[n]=1;stack[count++]=n;
      }
    }
    if(count<minimumPixels && maxY-minY<h*0.17) for(let j=0;j<count;j++) binary[stack[j]]=0;
  }
}


function removeLongLines(bits,w,h) {
  if(w<120||h<28)return bits;
  const results=[];
  // Hough-style voting for long, thin, nearly horizontal lines.
  for(let ai=-8;ai<=35;ai++) {
    const a=ai/100;
    for(let bi=-12;bi<=Math.min(24,h*.6)*2;bi++) {
      const b=bi/2;
      let votes=0,possible=0;
      for(let x=0;x<w;x++) {
        const y=Math.round(a*x+b);
        if(y>=0&&y<h){possible++;votes+=bits[y*w+x];}
      }
      if(possible>=w*.7&&votes>w*.57)results.push({a,b,votes});
    }
  }
  results.sort((u,v)=>v.votes-u.votes);
  const found=[];
  for(const line of results) {
    if(found.some(other=>Math.abs((line.a-other.a)*(w*.5)+line.b-other.b)<2.4 && Math.abs((line.a-other.a)*w)<3))continue;
    found.push(line);
    if(found.length>=2)break;
  }
  if(!found.length)return bits;
  const out=new Uint8Array(bits);
  for(const {a,b} of found)for(let x=0;x<w;x++) {
    const cy=a*x+b;
    for(let y=Math.max(0,Math.floor(cy-1.1));y<=Math.min(h-1,Math.ceil(cy+1.1));y++) {
      if(Math.abs(y-cy)<=1.1)out[y*w+x]=0;
    }
  }
  return out;
}

function morphologicalOpen2x2(bits,w,h) {
  // Binary erosion followed by dilation, both 2x2 (square structuring element).
  const eroded=new Uint8Array(w*h),opened=new Uint8Array(w*h);
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++) {
    const i=y*w+x;
    if(bits[i]&&bits[i+1]&&bits[i+w]&&bits[i+w+1])eroded[i]=1;
  }
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++) {
    if(!eroded[y*w+x])continue;
    const i=y*w+x;
    opened[i]=opened[i+1]=opened[i+w]=opened[i+w+1]=1;
  }
  return opened;
}

function locateDenseText(bits,w,h) {
  // Thin ruling lines / scratches can stretch across the full image, but a
  // character generally has multiple black pixels in the same column.
  const density=new Uint16Array(w);
  for(let x=0;x<w;x++)for(let y=0;y<h;y++)density[x]+=bits[y*w+x];
  const columnMinimum=Math.max(4,Math.floor(h*0.11));
  const columns=[];
  for(let x=0;x<w;x++)if(density[x]>=columnMinimum)columns.push(x);
  if(columns.length<8)return null;
  const maxGap=Math.max(7,Math.round(w*.06));
  const groups=[];
  let group=[columns[0]];
  for(let i=1;i<columns.length;i++) {
    if(columns[i]-columns[i-1]<=maxGap)group.push(columns[i]);
    else {groups.push(group);group=[columns[i]];}
  }
  groups.push(group);
  // Prefer high ink mass spread across several characters, not a short blob.
  const plausible=groups.filter(g=>g.length>=8&&(g.at(-1)-g[0])>w*.25);
  const candidates=plausible.length?plausible:groups;
  candidates.sort((a,b)=>{
    const as=a.reduce((sum,x)=>sum+density[x],0),bs=b.reduce((sum,x)=>sum+density[x],0);
    return bs-as;
  });
  const chosen=candidates[0],left=chosen[0],right=chosen.at(-1);
  if(right-left<w*.18)return null;
  const pad=Math.max(3,Math.round(h*.12));
  const x0=Math.max(0,left-pad),x1=Math.min(w,right+pad+1);
  // The narrowest reasonable full-height strip with the most ink wins.
  const rowCounts=new Uint16Array(h);
  for(let y=0;y<h;y++)for(let x=x0;x<x1;x++)rowCounts[y]+=bits[y*w+x];
  const textHeight=Math.min(h,Math.max(15,Math.round(h*.46)));
  let bestY=0,best=-1,total=0;
  for(let y=0;y<textHeight;y++)total+=rowCounts[y];
  best=total;
  for(let y=1;y<=h-textHeight;y++) {
    total+=rowCounts[y+textHeight-1]-rowCounts[y-1];
    if(total>best){best=total;bestY=y;}
  }
  return {x0,x1,y0:Math.max(0,bestY-1),y1:Math.min(h,bestY+textHeight+1)};
}

function upscaleBits(bits,w,h,factor=3) {
  const scaled=new Uint8Array(w*h*factor*factor),sw=w*factor,sh=h*factor;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(bits[y*w+x]) {
    for(let dy=0;dy<factor;dy++)for(let dx=0;dx<factor;dx++)scaled[(y*factor+dy)*sw+x*factor+dx]=1;
  }
  return {bits:scaled,width:sw,height:sh};
}

function prepareLegacyImage(image, options={}) {
  if(!image?.naturalWidth||!image?.naturalHeight)throw new Error('Image cannot be decoded.');
  const upscale=Math.min(4,Math.max(1,Math.ceil(110/image.naturalHeight)));
  const width=Math.min(1600,Math.round(image.naturalWidth*upscale));
  const height=Math.min(600,Math.round(image.naturalHeight*width/image.naturalWidth));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
  const rgba=context.getImageData(0,0,width,height),gray=new Uint8Array(width*height);
  for(let i=0;i<gray.length;i++)gray[i]=Math.round(0.299*rgba.data[i*4]+0.587*rgba.data[i*4+1]+0.114*rgba.data[i*4+2]);
  const smooth=convolveGaussian(gray,width,height,Number(options.blur ?? 1));
  let bits;
  if(options.threshold==='adaptive')bits=adaptiveBinarize(smooth,width,height);
  else {
    const t=Math.min(220,Math.max(65,otsu(smooth)));
    bits=Uint8Array.from(smooth,px=>px<=t?1:0);
  }
  removeSpeckles(bits,width,height);
  const processed=document.createElement('canvas');processed.width=width;processed.height=height;
  const result=processed.getContext('2d');
  const out=result.createImageData(width,height);
  for(let i=0;i<bits.length;i++) {
    const val=bits[i]?0:255;
    out.data[i*4]=val;out.data[i*4+1]=val;out.data[i*4+2]=val;out.data[i*4+3]=255;
  }
  result.putImageData(out,0,0);
  return {bits,width,height,processed};
}


export function prepareImage(image, options={}) {
  if(!image?.naturalWidth||!image?.naturalHeight)throw new Error('Image cannot be decoded.');
  const w=image.naturalWidth,h=image.naturalHeight;
  if(w*h>8_000_000)throw new Error('Image is too large.');
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.fillStyle='white';context.fillRect(0,0,w,h);context.drawImage(image,0,0,w,h);
  const rgba=context.getImageData(0,0,w,h),gray=new Uint8Array(w*h);
  for(let i=0;i<gray.length;i++)gray[i]=Math.round(.299*rgba.data[i*4]+.587*rgba.data[i*4+1]+.114*rgba.data[i*4+2]);
  // Deliberately do NOT blur the tiny native pixels first: it erases narrow 1s.
  let bits;
  if(options.threshold==='adaptive')bits=adaptiveBinarize(gray,w,h);
  else {
    // The old Otsu result was dominated by the large white background and
    // coloured confetti. Limit threshold to preserve only genuinely dark ink.
    const t=Math.min(110,Math.max(70,otsu(gray)));
    bits=Uint8Array.from(gray,px=>px<=t?1:0);
  }
  let region;
  // Detect prominent strokes, not individual noisy pixels.
  if(w>=80&&h>=25) {
    const removed=removeLongLines(bits,w,h);
    // Clean, unruled images work better with the original softer pipeline.
    if(removed===bits)return prepareLegacyImage(image,{blur:1,threshold:options.threshold});
    const cleaned=morphologicalOpen2x2(removed,w,h);
    const opened=morphologicalOpen2x2(bits,w,h);
    region=locateDenseText(opened,w,h);
    if(region) {
      // Keep an independently line-cleaned hypothesis; some genuine strokes
      // overlap a diagonal line and should not be erased indiscriminately.
      const altRegion=locateDenseText(cleaned,w,h);
      if(altRegion) {
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)
          if(x<altRegion.x0||x>=altRegion.x1||y<altRegion.y0||y>=altRegion.y1)cleaned[y*w+x]=0;
        options._alternate=cleaned;
      }
      bits=opened;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        if(x<region.x0||x>=region.x1||y<region.y0||y>=region.y1)bits[y*w+x]=0;
      }
    }
  }
  if(!region)removeSpeckles(bits,w,h);
  const scale=Math.min(3,Math.max(1,Math.ceil(100/h)));
  const prepared=upscaleBits(bits,w,h,scale);
  const {width,height}=prepared;
  const processed=document.createElement('canvas');processed.width=width;processed.height=height;
  const result=processed.getContext('2d'),out=result.createImageData(width,height);
  for(let i=0;i<prepared.bits.length;i++) {
    const val=prepared.bits[i]?0:255;
    out.data[i*4]=val;out.data[i*4+1]=val;out.data[i*4+2]=val;out.data[i*4+3]=255;
  }
  result.putImageData(out,0,0);
  return {...prepared,processed,region,alternate:options._alternate?upscaleBits(options._alternate,w,h,scale):null};
}

