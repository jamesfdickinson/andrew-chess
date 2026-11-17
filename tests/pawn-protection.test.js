import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {moveContext,chooseReaction} from '../src/coach.js';
function play(game,san){const before=new Chess(game.fen());return moveContext(before,game,game.move(san));}
test('a knight newly protecting a pawn earns praise without repeating',()=>{
 const g=new Chess('7k/8/8/8/4P3/8/8/KN6 w - - 0 10');
 const facts=play(g,'Nc3');
 assert.deepEqual(facts.newlyProtectedPawns,[{defender:'c3',pawn:'e4'}]);
 assert.equal(chooseReaction(facts,()=>0).id,'protects-pawn');
 play(g,'Kh7');
 assert.equal(play(g,'Kb1').newlyProtectedPawns.length,0);
});
test('a pinned defender does not earn pawn-protection praise',()=>{
 const g=new Chess('4r2k/8/8/8/8/4N3/2P5/4K3 w - - 0 10');
 assert.equal(play(g,'c3').newlyProtectedPawns.length,0);
});
test('pawn advance newly guards a piece and does not repeat on an unrelated move',()=>{
 const g=new Chess('7k/8/8/3N4/8/4P3/8/K7 w - - 0 10');
 const facts=play(g,'e4');
 assert.deepEqual(facts.newPawnProtections,[{pawn:'e4',square:'d5',piece:'n'}]);
 assert.equal(chooseReaction(facts,()=>0).id,'pawn-protects-piece');
 play(g,'Kh7');
 assert.equal(play(g,'Kb1').newPawnProtections.length,0);
});
test('piece moving into existing pawn protection does not receive protection praise',()=>{
 const g=new Chess('7k/8/8/8/8/8/4P3/K5N1 w - - 0 10');const facts=play(g,'Nf3');
 assert.deepEqual(facts.newPawnProtections,[]);
 assert.notEqual(chooseReaction(facts,()=>0)?.id,'pawn-protects-piece');
});
test('pawn moving into existing knight protection does not earn protection praise',()=>{
 const g=new Chess('7k/8/8/8/8/2N1P3/8/K7 w - - 0 10');
 const facts=play(g,'e4');
 assert.deepEqual(facts.newlyProtectedPawns,[]);
 assert.notEqual(chooseReaction(facts,()=>0)?.id,'protects-pawn');
});
test('moving a defender that already protected the pawn does not repeat praise',()=>{
 const g=new Chess('7k/8/8/8/4P3/8/8/K3R3 w - - 0 10');
 assert.deepEqual(play(g,'Re2').newlyProtectedPawns,[]);
});
test('pinned pawn cannot claim to protect a teammate',()=>{
 const g=new Chess('4r2k/8/8/3N4/8/4P3/8/4K3 w - - 0 10');
 assert.equal(play(g,'e4').newPawnProtections.length,0);
});
test('pawn chains count as teamwork and opponent moves do not trigger praise',()=>{
 const g=new Chess('7k/8/8/3P4/8/4P3/8/K7 w - - 0 10');
 assert.equal(chooseReaction(play(g,'e4'),()=>0).id,'protects-pawn');
 assert.equal(play(g,'Kh7').newPawnProtections.length,0);
});

