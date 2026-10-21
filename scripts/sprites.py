"""Build Gonta's animation strips from the hand-made source art.

Sources (never modified): public/room-emotions.png (4x4 expression atlas; cells share one body, only the
eyes and mouth differ), public/room-emotion-joy.png (12-cell cracker sequence) and the three two-frame
public/room-work-*.png sheets. Every output frame is assembled from those pixels: faces are mixed from the
atlas, then the ears, tail and head are nudged a few pixels, eyes glance around, and hops shift the whole
dog inside a cell that keeps 30px of headroom. Nothing is resampled except the optional head tilt.

Outputs: public/anim/<name>.png (one row of 313x343 cells per reaction, 4x887 for the work sheets),
public/anim/sprites.css (frame timing for each strip) and public/anim/manifest.js (names and loop lengths
for room.js). Run:  python scripts/sprites.py
"""
from pathlib import Path
import numpy as np
from PIL import Image

PUBLIC=Path(__file__).resolve().parents[1]/'public'
OUT=PUBLIC/'anim'
CS=313          # source atlas cell
TOP=30          # headroom added above every front-facing cell so hops never clip
CELL=(CS,CS+TOP)
# Regions in aligned atlas coordinates (artwork bounding box starts at x=63, y=22).
EYES=(slice(94,112),slice(109,190))
MOUTH=(slice(156,176),slice(124,172))
LENSES=((109,138),(159,190))   # x-ranges the irises may move inside
HEAD=dict(r0=22,r1=178,c0=58,c1=216)
EAR_L=dict(r0=22,r1=58,c0=58,c1=130)
EAR_R=dict(r0=22,r1=58,c0=168,c1=236)
TAIL=dict(r0=160,r1=212,c0=222,c1=272)
NECK=(150,172)

def load(name):return np.array(Image.open(PUBLIC/name).convert('RGBA'))
def bbox(a):
 ys,xs=np.where(a[...,3]>0);return int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
def align(cell,x,y):
 """Move a cell's artwork so its bounding box starts at (x,y)."""
 x0,y0,x1,y1=bbox(cell);out=np.zeros_like(cell);out[y:y+y1-y0,x:x+x1-x0]=cell[y0:y1,x0:x1];return out
def over(dst,src,x,y):
 """Alpha-composite src onto dst at (x,y), clipping at the edges."""
 h,w=src.shape[:2];H,W=dst.shape[:2]
 sx0,sy0=max(0,-x),max(0,-y);dx0,dy0=max(0,x),max(0,y);cw,ch=min(w-sx0,W-dx0),min(h-sy0,H-dy0)
 if cw<=0 or ch<=0:return dst
 s=src[sy0:sy0+ch,sx0:sx0+cw].astype(float);d=dst[dy0:dy0+ch,dx0:dx0+cw].astype(float)
 sa=s[...,3:4]/255;da=d[...,3:4]/255;oa=sa+da*(1-sa)
 rgb=np.divide(s[...,:3]*sa+d[...,:3]*da*(1-sa),np.where(oa==0,1,oa))
 dst[dy0:dy0+ch,dx0:dx0+cw]=np.concatenate([rgb,oa*255],axis=2).round().astype(np.uint8);return dst

atlas=load('room-emotions.png')
cells={i:align(atlas[(i//4)*CS:(i//4+1)*CS,(i%4)*CS:(i%4+1)*CS],63,22) for i in range(2,16)}
NEUTRAL=14
# Face parts available in the atlas, by cell index.
E=dict(open=14,blink=15,angry=2,sad=4,half=6,shut=7,soft=8,sparkle=12,happy=13)
M=dict(closed=14,frown=2,sadfrown=4,smile=6,open=10,tongue=11)

def face(eyes='open',mouth='closed'):
 img=cells[NEUTRAL].copy();img[EYES]=cells[E[eyes]][EYES];img[MOUTH]=cells[M[mouth]][MOUTH];return img

def glance(img,dx,dy):
 """Slide the irises inside the lenses; the vacated pixels take the dark lens colour."""
 region=img[EYES].copy();rgb=region[...,:3].astype(int);alpha=region[...,3]>0
 green=(rgb[...,1]>120)&(rgb[...,0]<120)&(rgb[...,2]<120)
 iris=(((rgb[...,0]-rgb[...,2])>35)|(rgb.max(axis=2)>200))&~green&alpha
 lens=~green&~iris&alpha
 fill=np.median(region[lens][:,:3],axis=0).round().astype(np.uint8)
 out=region.copy();out[iris,:3]=fill
 ys,xs=np.where(iris)
 for y,x in zip(ys,xs):
  ny,nx=y+dy,x+dx;ax=x+EYES[1].start;nxa=nx+EYES[1].start
  inside=any(a<=ax<b and a<=nxa<b for a,b in LENSES)
  if 0<=ny<region.shape[0] and inside and lens[ny,nx]|iris[ny,nx]:out[ny,nx]=region[y,x]
 img=img.copy();img[EYES]=out;return img

def shift_block(img,r0,r1,c0,c1,dx=0,dy=0):
 """Translate a rectangular part. Moving up repeats the row it left so the part stays attached;
 moving down squashes the part into its base."""
 out=img.copy();part=img[r0:r1,c0:c1].copy();h,w=part.shape[:2]
 if dx:
  moved=np.zeros_like(part)
  if dx>0:moved[:,dx:]=part[:,:w-dx]
  else:moved[:,:w+dx]=part[:,-dx:]
  part=moved
 out[r0:r1,c0:c1]=part
 if dy<0:d=-dy;out[r0-d:r1-d,c0:c1]=part;out[r1-d:r1,c0:c1]=part[-1]
 elif dy>0:out[r0+dy:r1,c0:c1]=part[:h-dy];out[r0:r0+dy,c0:c1]=0
 return out

def shear_rows(img,r0,r1,c0,c1,amount):
 """Lean a part sideways: the top row slides by `amount`, the bottom row stays put."""
 out=img.copy()
 for y in range(r0,r1):
  dx=round(amount*(r1-y)/(r1-r0))
  if not dx:continue
  row=img[y,c0:c1];moved=np.zeros_like(row);w=len(row)
  if dx>0:moved[dx:]=row[:w-dx]
  else:moved[:w+dx]=row[-dx:]
  out[y,c0:c1]=moved
 return out

def tilt(img,angle):
 """Rotate the head about the base of the neck (nearest neighbour keeps the pixels crisp).
 The head is lifted off the body down to row 165, excluding the tail columns; above row 140 the body is
 cleared so no second pair of ears lingers, while the neck band keeps its pixels under the turned head."""
 r1=165;part=img.copy();part[r1:]=0;part[:HEAD['r0']-2]=0;part[160:,HEAD['c1']:]=0
 rotated=np.array(Image.fromarray(part).rotate(angle,resample=Image.NEAREST,center=NECK))
 out=img.copy();out[:140]=0;return over(out,rotated,0,0)

def translate(a,dx,dy):
 H,W=a.shape[:2];out=np.zeros_like(a)
 out[max(0,dy):H+min(0,dy),max(0,dx):W+min(0,dx)]=a[max(0,-dy):H+min(0,-dy),max(0,-dx):W+min(0,-dx)];return out

HEAD_MASK=np.zeros((CS,CS),bool);HEAD_MASK[HEAD['r0']:HEAD['r1'],HEAD['c0']:HEAD['c1']]=True;HEAD_MASK[HEAD['r0']:160,HEAD['c1']:240]=True

def move_head(img,dx,dy):
 """Translate the head (ears included, tail excluded). Rising heads repeat the shoulder row beneath them."""
 part=np.where(HEAD_MASK[...,None],img,0).astype(np.uint8);out=img.copy();out[HEAD_MASK]=0
 out=over(out,translate(part,dx,dy),0,0)
 if dy<0:out[HEAD['r1']+dy:HEAD['r1'],HEAD['c0']:HEAD['c1']]=img[HEAD['r1']-1,HEAD['c0']:HEAD['c1']]
 return out

def frame(eyes='open',mouth='closed',look=(0,0),ears=(0,0),ears_dy=0,tail=0,head=(0,0),angle=0,hop=0):
 img=face(eyes,mouth)
 if look!=(0,0):img=glance(img,*look)
 if ears[0]:img=shear_rows(img,amount=ears[0],**EAR_L)
 if ears[1]:img=shear_rows(img,amount=ears[1],**EAR_R)
 if ears_dy:img=shift_block(img,dy=ears_dy,**EAR_L);img=shift_block(img,dy=ears_dy,**EAR_R)
 if tail:img=shear_rows(img,amount=tail,**TAIL)
 if angle:img=tilt(img,angle)
 if head!=(0,0):img=move_head(img,*head)
 cell=np.zeros((CELL[1],CELL[0],4),np.uint8);return over(cell,img,0,TOP+hop)

def joy_frames():
 """The cracker sequence keeps its original cells; the blended cell 2 and the premature reset in cell 4
 are skipped, stray pixels under cells 5/7/8 are cleared and cells 9-12 get their 26px floor correction."""
 sheet=load('room-emotion-joy.png');h=sheet.shape[0];w=sheet.shape[1]//12
 def cell(i,dy=0,clip=0):
  c=sheet[:,i*w:(i+1)*w].copy()
  if clip:c[int(h*(1-clip)):]=0
  out=np.zeros((CELL[1],CELL[0],4),np.uint8);return over(out,c,0,TOP+dy)
 return {'rest':cell(0),'turn':cell(2,2),'aim':cell(4,2,.09),'pull':cell(6,0,.09),'bang':cell(7,0,.12),
         'up1':cell(8,-26),'up2':cell(9,-26),'up3':cell(10,-26),'up4':cell(11,-26)}

# Each animation: list of (frame kwargs, milliseconds). Frames repeat freely; strips store unique cells.
def breathe(n,depth,**extra):
 """Slow in-and-out head rise over n frames."""
 return [dict(head=(0,-round(depth*np.sin(np.pi*i/n))),**extra) for i in range(n)]

ANIMATIONS={
 'idle':[  # breathing, a blink, a tail flick and an ear twitch in a 4s loop
  *[(f,200) for f in breathe(8,4)],
  (dict(eyes='blink'),90),(dict(),300),(dict(tail=-4),200),(dict(tail=-7),200),(dict(tail=-4),200),(dict(),400),
  (dict(ears=(-4,0)),140),(dict(ears=(-2,0)),120),(dict(),500),(dict(eyes='blink'),90),(dict(),300),
 ],
 'idle2':[  # glancing around the room
  (dict(),400),(dict(look=(3,0)),140),(dict(look=(5,0)),700),(dict(look=(5,0),eyes='open',ears=(0,3)),300),(dict(look=(3,0)),120),(dict(),500),
  (dict(look=(-3,0)),140),(dict(look=(-5,0)),700),(dict(look=(-5,-2)),400),(dict(look=(-3,0)),120),(dict(),300),(dict(eyes='blink'),90),(dict(),600),
  (dict(tail=5),180),(dict(tail=8),180),(dict(tail=5),180),(dict(),300),
 ],
 'idle3':[  # a big yawn and a stretch
  (dict(),500),(dict(eyes='half'),200),(dict(eyes='half',mouth='open',head=(0,2)),200),(dict(eyes='shut',mouth='open',head=(0,-3),ears=(-3,3)),240),
  (dict(eyes='shut',mouth='open',head=(0,-6),ears=(-5,5),ears_dy=-3),900),(dict(eyes='shut',mouth='open',head=(0,-3),ears=(-3,3)),200),(dict(eyes='shut',head=(0,1)),240),
  (dict(eyes='half',head=(0,1)),300),(dict(eyes='blink'),90),(dict(),400),(dict(eyes='blink'),90),(dict(tail=-4),200),(dict(tail=-7),200),(dict(tail=-4),200),(dict(),800),
 ],
 'talk':[  # mouth flaps with a lively bob while a reply streams in
  (dict(mouth='open'),110),(dict(mouth='open',head=(0,-2)),110),(dict(mouth='closed',head=(0,-3)),110),(dict(mouth='closed',head=(0,-1)),110),
  (dict(mouth='open',head=(0,-1)),110),(dict(mouth='open',head=(0,-3)),110),(dict(mouth='closed',head=(0,-2),eyes='blink'),90),(dict(mouth='closed'),130),
  (dict(mouth='open',head=(0,-2),tail=-4),110),(dict(mouth='closed',head=(0,-3),tail=-6),110),(dict(mouth='open',head=(0,-1),tail=-4),110),(dict(mouth='closed'),140),
 ],
 'think':[  # eyes up, slow sway, a thoughtful ear
  (dict(look=(0,-3)),500),(dict(look=(2,-4),angle=-4),500),(dict(look=(3,-4),angle=-6),900),(dict(look=(2,-4),angle=-4,eyes='open'),300),(dict(look=(0,-3)),400),
  (dict(look=(-2,-4),angle=4),500),(dict(look=(-3,-4),angle=6),900),(dict(look=(-3,-4),angle=6,ears=(0,-4)),200),(dict(look=(-2,-4),angle=4),300),(dict(eyes='blink'),90),(dict(look=(0,-3)),400),
 ],
 'anger':[  # trembling with flattened ears and a stomping bob
  (dict(eyes='angry',mouth='frown',ears=(-5,5)),300),(dict(eyes='angry',mouth='frown',ears=(-5,5),head=(2,0)),90),(dict(eyes='angry',mouth='frown',ears=(-5,5),head=(-2,0)),90),
  (dict(eyes='angry',mouth='frown',ears=(-5,5),head=(2,0)),90),(dict(eyes='angry',mouth='frown',ears=(-5,5),head=(-2,0)),90),(dict(eyes='angry',mouth='frown',ears=(-5,5)),400),
  (dict(eyes='angry',mouth='frown',ears=(-6,6),head=(0,-5),hop=-6),120),(dict(eyes='angry',mouth='frown',ears=(-5,5),head=(0,3)),140),(dict(eyes='angry',mouth='frown',ears=(-5,5)),500),
  (dict(eyes='angry',mouth='frown',ears=(-5,5),head=(2,0),tail=3),90),(dict(eyes='angry',mouth='frown',ears=(-5,5),head=(-2,0),tail=-3),90),(dict(eyes='angry',mouth='frown',ears=(-5,5)),600),
 ],
 'sadness':[  # drooping ears, lowered head, slow sway and a still tail
  (dict(eyes='sad',mouth='sadfrown',ears=(-4,4),head=(0,4),tail=4),600),(dict(eyes='sad',mouth='sadfrown',ears=(-4,4),head=(0,5),tail=4,angle=-3),600),
  (dict(eyes='sad',mouth='sadfrown',ears=(-5,5),head=(0,6),tail=5,angle=-4),700),(dict(eyes='sad',mouth='sadfrown',ears=(-4,4),head=(0,5),tail=4,angle=-3),500),
  (dict(eyes='shut',mouth='sadfrown',ears=(-4,4),head=(0,5),tail=4),180),(dict(eyes='sad',mouth='sadfrown',ears=(-4,4),head=(0,4),tail=4),600),
  (dict(eyes='sad',mouth='sadfrown',ears=(-4,4),head=(0,5),tail=4,angle=3),600),(dict(eyes='sad',mouth='sadfrown',ears=(-5,5),head=(0,6),tail=5,angle=4),700),(dict(eyes='sad',mouth='sadfrown',ears=(-4,4),head=(0,5),tail=4,angle=3),500),
 ],
 'relaxed':[  # long content breaths with half-closed eyes and a lazy tail
  *[(dict(eyes='half',mouth='smile',head=(0,-round(5*np.sin(np.pi*i/10))),tail=-round(5*np.sin(np.pi*i/10))),300) for i in range(10)],
  (dict(eyes='shut',mouth='smile'),700),(dict(eyes='shut',mouth='smile',head=(0,-2)),600),(dict(eyes='shut',mouth='smile'),700),(dict(eyes='half',mouth='smile'),300),
 ],
 'empathy':[  # slow nods, soft eyes, a gentle tail
  (dict(eyes='soft',mouth='smile'),600),(dict(eyes='soft',mouth='smile',head=(0,2)),250),(dict(eyes='soft',mouth='smile',head=(0,4)),350),(dict(eyes='soft',mouth='smile',head=(0,2)),250),
  (dict(eyes='soft',mouth='smile'),500),(dict(eyes='soft',mouth='smile',tail=-4),250),(dict(eyes='soft',mouth='smile',tail=-6),300),(dict(eyes='soft',mouth='smile',tail=-3),250),
  (dict(eyes='shut',mouth='smile'),400),(dict(eyes='soft',mouth='smile'),500),(dict(eyes='soft',mouth='smile',head=(0,2)),250),(dict(eyes='soft',mouth='smile',head=(0,4),ears=(-2,2)),350),(dict(eyes='soft',mouth='smile',head=(0,2)),250),(dict(eyes='soft',mouth='smile'),500),
 ],
 'encouragement':[  # bright bounces, mouth open, tail going
  (dict(eyes='open',mouth='open'),300),(dict(eyes='open',mouth='open',head=(0,-3),tail=-4),140),(dict(eyes='sparkle',mouth='tongue',head=(0,-6),tail=-7,hop=-6,ears_dy=-2),160),
  (dict(eyes='sparkle',mouth='tongue',head=(0,-3),tail=-4),140),(dict(eyes='sparkle',mouth='tongue',head=(0,1),tail=3),160),(dict(eyes='sparkle',mouth='tongue'),500),
  (dict(eyes='open',mouth='open',tail=-5),140),(dict(eyes='open',mouth='open',tail=5),140),(dict(eyes='open',mouth='open',tail=-5),140),(dict(eyes='open',mouth='open',tail=5),140),(dict(eyes='open',mouth='open'),400),
 ],
 'cheering':[  # fast jumping cheer
  (dict(eyes='sparkle',mouth='tongue',head=(0,2)),140),(dict(eyes='sparkle',mouth='tongue',head=(0,-4),ears_dy=-2,hop=-6),120),(dict(eyes='happy',mouth='tongue',head=(0,-6),ears_dy=-3,hop=-14,tail=-6),140),
  (dict(eyes='happy',mouth='tongue',head=(0,-4),ears_dy=-2,hop=-8,tail=-3),120),(dict(eyes='sparkle',mouth='tongue',head=(0,2),tail=3),140),(dict(eyes='sparkle',mouth='tongue'),200),
  (dict(eyes='sparkle',mouth='tongue',head=(0,-3),tail=-5),110),(dict(eyes='happy',mouth='tongue',head=(0,-6),ears_dy=-3,hop=-10,tail=-7),140),(dict(eyes='sparkle',mouth='tongue',head=(0,-3),tail=-4),110),(dict(eyes='sparkle',mouth='tongue',head=(0,2),tail=4),140),(dict(eyes='sparkle',mouth='tongue'),300),
 ],
 'surprise':[  # a startled jump, ears straight up
  (dict(eyes='open',mouth='closed'),300),(dict(eyes='open',mouth='closed',head=(0,3)),100),(dict(eyes='open',mouth='open',head=(0,-6),ears_dy=-5,hop=-18,tail=-5),130),
  (dict(eyes='open',mouth='open',head=(0,-6),ears_dy=-5,hop=-22,tail=-6),130),(dict(eyes='open',mouth='open',head=(0,-4),ears_dy=-4,hop=-10),120),(dict(eyes='open',mouth='open',head=(0,2),ears_dy=-2),120),
  (dict(eyes='open',mouth='open',ears_dy=-4),900),(dict(eyes='blink',mouth='open',ears_dy=-4),90),(dict(eyes='open',mouth='open',ears_dy=-4,look=(3,0)),500),(dict(eyes='open',mouth='open',ears_dy=-3,look=(-3,0)),500),(dict(eyes='open',mouth='closed',ears_dy=-2),500),
 ],
 'laugh':[  # eyes shut, shaking with laughter
  *[(dict(eyes='happy',mouth='tongue',head=(0,[0,-3,-5,-3][i%4]),tail=[-3,-6,-3,0][i%4],hop=[0,-2,-3,-2][i%4]),110) for i in range(8)],
  (dict(eyes='happy',mouth='tongue',head=(0,-2)),200),(dict(eyes='happy',mouth='open',head=(0,2),ears=(-2,2)),400),(dict(eyes='half',mouth='smile'),500),
 ],
 'sleepy':[  # nodding off, then jolting awake
  (dict(eyes='half'),600),(dict(eyes='half',head=(0,2)),400),(dict(eyes='shut',head=(0,4),ears=(-2,2)),400),(dict(eyes='shut',head=(0,6),ears=(-3,3)),500),
  (dict(eyes='shut',head=(0,7),ears=(-4,4)),600),(dict(eyes='shut',head=(0,8),ears=(-4,4),angle=-3),800),(dict(eyes='shut',head=(0,9),ears=(-5,5),angle=-4),900),
  (dict(eyes='open',mouth='open',head=(0,-4),ears_dy=-3,hop=-4),140),(dict(eyes='open',head=(0,-2),ears_dy=-2),300),(dict(eyes='blink'),90),(dict(eyes='half'),500),(dict(eyes='half',look=(3,0)),500),
 ],
 'apology':[  # a deep bow with drooping ears
  (dict(eyes='sad',mouth='sadfrown'),300),(dict(eyes='sad',mouth='sadfrown',head=(0,3),ears=(-3,3)),140),(dict(eyes='shut',mouth='sadfrown',head=(0,6),ears=(-4,4)),140),
  (dict(eyes='shut',mouth='sadfrown',head=(0,9),ears=(-5,5),tail=3),1200),(dict(eyes='shut',mouth='sadfrown',head=(0,6),ears=(-4,4),tail=3),160),(dict(eyes='sad',mouth='sadfrown',head=(0,3),ears=(-3,3)),200),
  (dict(eyes='sad',mouth='sadfrown',look=(0,-2)),700),(dict(eyes='sad',mouth='sadfrown',look=(3,-2)),500),(dict(eyes='sad',mouth='sadfrown',look=(0,-2)),500),
 ],
 'affection':[  # happy wagging and a nuzzle
  *[(dict(eyes='soft',mouth='smile',tail=[-7,-3,3,7,3,-3][i%6],head=(0,[-1,-2,-1,0,0,0][i%6])),120) for i in range(12)],
  (dict(eyes='shut',mouth='smile',head=(0,3),angle=5),500),(dict(eyes='shut',mouth='smile',head=(0,4),angle=7),500),(dict(eyes='shut',mouth='smile',head=(0,3),angle=5),300),(dict(eyes='soft',mouth='smile'),400),
 ],
 'greeting':[  # a hop, a wag and a bright hello
  (dict(eyes='sparkle',mouth='open'),200),(dict(eyes='sparkle',mouth='open',head=(0,2)),110),(dict(eyes='sparkle',mouth='open',head=(0,-5),ears_dy=-3,hop=-12,tail=-5),150),(dict(eyes='sparkle',mouth='open',head=(0,-3),ears_dy=-2,hop=-6,tail=-3),130),
  (dict(eyes='sparkle',mouth='open',head=(0,1),tail=3),140),*[(dict(eyes='sparkle',mouth='open',tail=[-6,0,6,0][i%4]),120) for i in range(8)],
  (dict(eyes='happy',mouth='open',angle=5),500),(dict(eyes='happy',mouth='open',angle=-5),500),(dict(eyes='sparkle',mouth='smile'),500),
 ],
 'curious':[  # head tilts with a wandering gaze
  (dict(),400),(dict(angle=4,look=(2,0)),160),(dict(angle=8,look=(4,0)),160),(dict(angle=9,look=(5,0),ears=(0,3)),1200),(dict(angle=8,look=(4,0)),160),(dict(angle=4,look=(2,0)),160),
  (dict(eyes='blink'),90),(dict(),500),(dict(angle=-4,look=(-2,0)),160),(dict(angle=-8,look=(-4,0)),160),(dict(angle=-9,look=(-5,0),ears=(-3,0)),1200),(dict(angle=-8,look=(-4,0)),160),(dict(angle=-4,look=(-2,0)),160),(dict(),400),
 ],
 'pondering':[  # chin up, eyes rolled up, a slow sway
  (dict(eyes='half',look=(0,-3)),500),(dict(eyes='half',look=(2,-4),angle=3),600),(dict(eyes='half',look=(3,-4),angle=5,ears=(0,-3)),900),(dict(eyes='half',look=(2,-4),angle=3),400),
  (dict(eyes='half',look=(0,-3)),500),(dict(eyes='half',look=(-2,-4),angle=-3),600),(dict(eyes='half',look=(-3,-4),angle=-5,ears=(3,0)),900),(dict(eyes='half',look=(-2,-4),angle=-3),400),(dict(eyes='shut'),300),(dict(eyes='half',look=(0,-3)),400),
 ],
 'agree':[  # firm nods
  (dict(eyes='open',mouth='smile'),300),(dict(eyes='open',mouth='smile',head=(0,3)),110),(dict(eyes='happy',mouth='smile',head=(0,6)),160),(dict(eyes='open',mouth='smile',head=(0,3)),110),(dict(eyes='open',mouth='smile',head=(0,-2)),140),
  (dict(eyes='open',mouth='smile'),200),(dict(eyes='open',mouth='smile',head=(0,3)),110),(dict(eyes='happy',mouth='smile',head=(0,6)),160),(dict(eyes='open',mouth='smile',head=(0,3)),110),(dict(eyes='open',mouth='smile',head=(0,-2)),140),
  (dict(eyes='sparkle',mouth='open',tail=-5),200),(dict(eyes='sparkle',mouth='open',tail=5),200),(dict(eyes='sparkle',mouth='open',tail=-5),200),(dict(eyes='open',mouth='smile'),700),
 ],
}
JOY=[('rest',760),('turn',300),('aim',340),('pull',130),('bang',130),('up1',250),('up2',300),('up3',210),('up4',210),('up3',460),('turn',300),('rest',840)]

def render(name):
 if name=='joy':
  art=joy_frames();return [(art[key],ms) for key,ms in JOY]
 return [(frame(**spec),ms) for spec,ms in ANIMATIONS[name]]

def strip(frames):
 """Deduplicate identical cells, returning the row image and each frame's cell index."""
 cells=[];index=[]
 for img,_ in frames:
  for i,c in enumerate(cells):
   if np.array_equal(c,img):index.append(i);break
  else:cells.append(img);index.append(len(cells)-1)
 return np.concatenate(cells,axis=1),index

def save(path,img):
 im=Image.fromarray(img).quantize(colors=256,method=Image.Quantize.FASTOCTREE)
 im.save(path,optimize=True);return path.stat().st_size

def find_cut(mask,target):
 """Nearest row to `target` where the opaque pixels form one run (specks ignored), so a bob can repeat it."""
 for offset in range(0,200):
  for y in (target-offset,target+offset):
   xs=np.where(mask[y])[0]
   if len(xs)<40:continue
   gaps=np.diff(xs);breaks=xs[:-1][gaps>1];runs=[]
   start=xs[0]
   for b in breaks:
    runs.append((start,b));start=xs[np.searchsorted(xs,b)+1]
   runs.append((start,xs[-1]))
   if sum(1 for a,b in runs if b-a>=4)==1:return y
 raise ValueError('no single-run row')

def work_strip(kind):
 """Two drawn poses become four: each pose also gets an upper-body bob (12px, repeated row at the waist)."""
 sheet=load(f'room-work-{kind}.png');cs=sheet.shape[0];out=[]
 for i in range(2):
  f=sheet[:,i*cs:(i+1)*cs];x0,y0,x1,y1=bbox(f);cut=find_cut(f[...,3]>0,int(cs*.36))
  out+=[f,shift_block(f,r0=y0,r1=cut,c0=0,c1=cs,dy=-12)]
 return np.concatenate(out,axis=1)

def css_for(name,index,frames):
 total=sum(ms for _,ms in frames);n=max(index)+1;stops=[];t=0
 for (_,ms),cell in zip(frames,index):
  stops.append(f'{t/total*100:.3f}%{{transform:translateX({-cell/n*100:.4f}%)}}');t+=ms
 keyframes=f'@keyframes room-anim-{name}{{{"".join(stops)}}}'
 rule=f".pixel-room[data-anim={name}] .room-sprite::before{{background-image:url('/anim/{name}.png');width:{n*100}%;animation:room-anim-{name} {total/1000:g}s steps(1,end) infinite}}"
 return keyframes+'\n'+rule

def main():
 OUT.mkdir(exist_ok=True);lines=['/* Generated by scripts/sprites.py; do not edit by hand. */']
 names=list(ANIMATIONS)+['joy'];cells={};total={}
 for name in names:
  frames=render(name);img,index=strip(frames);size=save(OUT/f'{name}.png',img)
  cells[name]=max(index)+1;total[name]=sum(ms for _,ms in frames)
  lines.append(css_for(name,index,frames));print(f'{name}: {len(frames)} frames, {cells[name]} cells, {total[name]}ms, {size//1024}KB')
 for kind in ('pc','obsidian','diary'):
  size=save(OUT/f'work-{kind}.png',work_strip(kind));print(f'work-{kind}: 4 cells, {size//1024}KB')
 lines.append("@keyframes room-work{0%{background-position:0 0}25%{background-position:33.3333% 0}50%{background-position:66.6667% 0}75%{background-position:100% 0}}")
 lines.append(".room-worker-pc{background-image:url('/anim/work-pc.png')}.room-worker-obsidian{background-image:url('/anim/work-obsidian.png')}.room-worker-diary{background-image:url('/anim/work-diary.png')}")
 (OUT/'sprites.css').write_text('\n'.join(lines)+'\n',encoding='utf-8',newline='\n')
 # room.js imports the loop lengths so it can rotate the resting strips without relying on animation events.
 entries=','.join(f"{name}:{{cells:{cells[name]},ms:{total[name]}}}" for name in names)
 (OUT/'manifest.js').write_text('// Generated by scripts/sprites.py; do not edit by hand.'+chr(10)+'export const strips={'+entries+'};'+chr(10)+"export const workers=['pc','obsidian','diary'];"+chr(10),encoding='utf-8',newline='\n')

if __name__=='__main__':main()
