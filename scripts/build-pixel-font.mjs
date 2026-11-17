// Original 5 × 7 bitmap alphabet, packed as rectangle outlines in a local TrueType font.
// No network font dependency. One font unit block = one visual pixel at 16px.
import { mkdirSync, writeFileSync } from 'node:fs';
const alphabet = {
 A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
 '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110','6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
 ' ':'00000','.':'00000/00000/00000/00000/00000/00000/00100',',':'00000/00000/00000/00000/00000/00100/01000',':':'00000/00100/00000/00000/00100',';':'00000/00100/00000/00000/00100/01000','!':'00100/00100/00100/00100/00100/00000/00100','?':'01110/10001/00001/00010/00100/00000/00100',"'":'00100/00100','"':'01010/01010','-':'00000/00000/00000/11111','+':'00000/00100/00100/11111/00100/00100','/':'00001/00001/00010/00100/01000/10000/10000','(':'00010/00100/01000/01000/01000/00100/00010',')':'01000/00100/00010/00010/00010/00100/01000','[':'01110/01000/01000/01000/01000/01000/01110',']':'01110/00010/00010/00010/00010/00010/01110','=':'00000/00000/11111/00000/11111','~':'00000/00000/01001/10110','<':'00010/00100/01000/10000/01000/00100/00010','>':'01000/00100/00010/00001/00010/00100/01000','%':'11001/11010/00010/00100/01000/01011/10011','&':'01100/10010/10100/01000/10101/10010/01101','_':'00000/00000/00000/00000/00000/00000/11111','*':'00000/10101/01110/11111/01110/10101','·':'00000/00000/00000/00100','…':'00000/00000/00000/00000/00000/00000/10101','←':'00000/00100/01000/11111/01000/00100','→':'00000/00100/00010/11111/00010/00100','✓':'00000/00001/00010/10100/01000','×':'00000/10001/01010/00100/01010/10001','☰':'11111/00000/11111/00000/11111',
};
for (const c of 'abcdefghijklmnopqrstuvwxyz') alphabet[c] = alphabet[c.toUpperCase()];
for (const c of '’‘') alphabet[c] = alphabet["'"];
for (const c of '—–') alphabet[c] = alphabet['-'];
const u16 = n => { const b=Buffer.alloc(2); b.writeUInt16BE(n & 65535); return b; };
const u32 = n => { const b=Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const words = (...ns) => Buffer.concat(ns.map(u16));
const pad = b => Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);
const entries = Object.entries(alphabet).sort((a,b)=>a[0].charCodeAt(0)-b[0].charCodeAt(0));
const glyphs = [Buffer.alloc(12)];
for (const [,pattern] of entries) {
 const points=[];
 pattern.split('/').forEach((row,y)=>[...row].forEach((bit,x)=>{if(bit==='1') points.push([x*100,(7-y)*100],[x*100,(6-y)*100],[(x+1)*100,(6-y)*100],[(x+1)*100,(7-y)*100]);}));
 const n=points.length/4;
 let px=0,py=0;
 glyphs.push(pad(Buffer.concat([words(n,0,0,500,700),words(...Array.from({length:n},(_,i)=>i*4+3)),u16(0),Buffer.alloc(points.length,1),words(...points.map(([x])=>{const d=x-px;px=x;return d;})),words(...points.map(([,y])=>{const d=y-py;py=y;return d;}))])));
}
const count=glyphs.length;
const head=Buffer.alloc(54); head.writeUInt32BE(0x10000,0);head.writeUInt32BE(0x10000,4);head.writeUInt32BE(0x5f0f3cf5,12);head.writeUInt16BE(800,18);head.writeInt16BE(500,40);head.writeInt16BE(700,42);head.writeUInt16BE(8,46);head.writeInt16BE(2,48);head.writeInt16BE(1,50);
const hhea=Buffer.alloc(36);hhea.writeUInt32BE(0x10000);hhea.writeInt16BE(700,4);hhea.writeInt16BE(-100,6);hhea.writeUInt16BE(600,10);hhea.writeInt16BE(100,14);hhea.writeInt16BE(500,16);hhea.writeInt16BE(1,18);hhea.writeUInt16BE(count,34);
const maxp=Buffer.alloc(32);maxp.writeUInt32BE(0x10000);maxp.writeUInt16BE(count,4);maxp.writeUInt16BE(140,6);maxp.writeUInt16BE(35,8);maxp.writeUInt16BE(1,14);
const os=Buffer.alloc(78);os.writeInt16BE(600,2);os.writeUInt16BE(400,4);os.writeUInt16BE(5,6);os.writeUInt16BE(64,62);os.writeUInt16BE(32,64);os.writeUInt16BE(0x2630,66);os.writeInt16BE(700,68);os.writeInt16BE(-100,70);os.writeUInt16BE(700,74);os.writeUInt16BE(100,76);
const segments=entries.length+1, power=2**Math.floor(Math.log2(segments));
const cmap4=Buffer.concat([words(4,16+segments*8,0,segments*2,power*2,Math.log2(power),segments*2-power*2),words(...entries.map(([c])=>c.charCodeAt(0)),65535),u16(0),words(...entries.map(([c])=>c.charCodeAt(0)),65535),words(...entries.map(([c],i)=>i+1-c.charCodeAt(0)),1),Buffer.alloc(segments*2)]);
const fontName=Buffer.from('Andrew Pixel','utf16le').swap16();
const name=Buffer.concat([words(0,3,42),... [1,4,6].map((id,i)=>words(3,1,0x409,id,fontName.length,i*fontName.length)),fontName,fontName,fontName]);
let offset=0;const loca=Buffer.concat([...glyphs.map(g=>{const b=u32(offset);offset+=g.length;return b;}),u32(offset)]);
const post=Buffer.alloc(32);post.writeUInt32BE(0x30000);post.writeUInt32BE(1,12);
const tables={ 'OS/2':os,cmap:Buffer.concat([words(0,1,3,1),u32(12),cmap4]),glyf:Buffer.concat(glyphs),head,hhea,hmtx:Buffer.concat(glyphs.map(()=>words(600,0))),loca,maxp,name,post };
function checksum(b) {b=pad(b);let s=0;for(let i=0;i<b.length;i+=4)s=(s+b.readUInt32BE(i))>>>0;return s;}
const tags=Object.keys(tables).sort();offset=12+tags.length*16;
let headOffset;
const records=tags.map(tag=>{const b=tables[tag];if(tag==='head')headOffset=offset;const r=Buffer.concat([Buffer.from(tag),u32(checksum(b)),u32(offset),u32(b.length)]);offset+=pad(b).length;return r;});
const font=Buffer.concat([u32(0x10000),words(tags.length,128,3,tags.length*16-128),...records,...tags.map(t=>pad(tables[t]))]);
font.writeUInt32BE((0xb1b0afba-checksum(font))>>>0,headOffset+8);
mkdirSync(new URL('../public/fonts/',import.meta.url),{recursive:true});
writeFileSync(new URL('../public/fonts/andrew-pixel.ttf',import.meta.url),font);
