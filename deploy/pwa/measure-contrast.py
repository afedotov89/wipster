# Read actual rendered PNG backgrounds and computed foreground colors.
import json,re,zlib,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'docs/pwa-evidence/corrections-20261117'
def read_png(file):
 raw=file.read_bytes();i=8;compressed=b''
 while i<len(raw):
  n=struct.unpack('>I',raw[i:i+4])[0];kind=raw[i+4:i+8];data=raw[i+8:i+8+n];i+=12+n
  if kind==b'IHDR':w,h,depth,color,_,_,interlace=struct.unpack('>IIBBBBB',data)
  elif kind==b'IDAT':compressed+=data
 assert depth==8 and color in (2,6) and interlace==0
 bpp=3 if color==2 else 4;stride=w*bpp;data=zlib.decompress(compressed);rows=[];prior=bytearray(stride)
 for y in range(h):
  pos=y*(stride+1);f=data[pos];row=bytearray(data[pos+1:pos+1+stride])
  for x in range(stride):
   a=row[x-bpp] if x>=bpp else 0;b=prior[x];c=prior[x-bpp] if x>=bpp else 0
   if f==1:v=a
   elif f==2:v=b
   elif f==3:v=(a+b)//2
   elif f==4:
    est=a+b-c;ds=[abs(est-z) for z in (a,b,c)];v=(a,b,c)[ds.index(min(ds))]
   else:v=0
   row[x]=(row[x]+v)&255
  rows.append(row);prior=row
 return lambda x,y:tuple(rows[y][x*bpp:x*bpp+3])

def lum(rgb):
 v=[z/255 for z in rgb];v=[z/12.92 if z<=.04045 else ((z+.055)/1.055)**2.4 for z in v];return sum(a*b for a,b in zip(v,[.2126,.7152,.0722]))
results=[]
for engine in ['chromium','webkit']:
 for state in json.loads((ROOT/(engine+'-contrast-samples.json')).read_text()):
  pixel=read_png(ROOT/state['file'])
  for c in state['controls']:
   r=c['rect'];color=[float(x) for x in re.findall(r'[0-9.]+',c['foreground'])];fg=color[:3];opacity=c['opacity']*(color[3] if len(color)==4 else 1)
   backgrounds=[pixel(int(r['x']+r['width']*fraction),int(r['y']+4))for fraction in [.2,.4,.6,.8]]
   ratios=[]
   for bg in backgrounds:
    text=[a*opacity+b*(1-opacity) for a,b in zip(fg,bg)];ratios.append((max(lum(text),lum(bg))+.05)/(min(lum(text),lum(bg))+.05))
   result={'engine':engine,'theme':state['theme'],'state':state['state'],'label':c['label'],'foreground':c['foreground'],'backgrounds':backgrounds,'min_ratio':min(ratios)};results.append(result)
(ROOT/'contrast-measurements.json').write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n')
failed=[r for r in results if r['min_ratio']<4.5]
print(json.dumps({'samples':len(results),'minimum':min(r['min_ratio']for r in results),'failed':failed},ensure_ascii=False,indent=2))
assert not failed,'Enabled text contrast below 4.5'
