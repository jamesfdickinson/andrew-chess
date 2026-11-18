// Andrew checks priorityEvents, then twoMoveEvents, then events (your move) or opponentEvents.
// The first match wins. One action plays, chosen randomly from its actions.
// Put your videos in public/coach/ and set video to '/coach/your-clip.mp4'.
// Until then, video: null displays animated pixel Andrew.
export const coachConfig = {
  name: 'Andrew',
  volume: 0.8,
  idleAfterMs: 60000,
  speech: { enabled: true, lang: 'en-US', rate: 1, pitch: 1 },
  priorityEvents: [
    { id: 'opponent-out-of-pawns', actions: [
      { actionId: 'opponent-out-of-pawns-01', text: 'They have no pawns left! That is what I call a successful pawn hunt.', video: null, animation: 'bounce' },
      { actionId: 'opponent-out-of-pawns-02', text: 'Still no enemy pawns on the board. A beautiful sight. Now finish the game!', video: null, animation: 'talk' },
    ] },
    { id: 'out-of-pawns', when: ({ lostLastPawn }) => lostLastPawn, actions: [
      { actionId: 'out-of-pawns-01', text: 'Just forfeit. You are out of pawns!', video: null, animation: 'shake' }, // Recording: /coach/out-of-pawns-01.mp4
      { actionId: 'out-of-pawns-02', text: 'No pawns left? Go get theirs! They have been keeping them far too long.', video: null, animation: 'point' },
      { actionId: 'out-of-pawns-03', text: 'Our last pawn! Right. New plan: take every pawn they have.', video: null, animation: 'point' },
      { actionId: 'out-of-pawns-04', text: 'We are out of pawns, but they are not. I think you know what to do.', video: null, animation: 'talk' },
      { actionId: 'out-of-pawns-05', text: 'All our little heroes are gone. Make those fancy pieces earn their keep. Go hunt some pawns!', video: null, animation: 'shake' },
      { actionId: 'out-of-pawns-06', text: 'Not a single pawn left. I am taking this personally. Get theirs!', video: null, animation: 'point' },
      { actionId: 'out-of-pawns-07', text: 'We may be out of pawns, but we are not out of pawn-taking opportunities. Keep looking!', video: null, animation: 'talk' },
    ] },
    { id: 'pawn-takes-piece', when: ({ pawnTookPiece }) => pawnTookPiece, actions: [
      { actionId: 'pawn-takes-piece-01', text: 'Our little pawn took a big piece! Tell me again which pieces are important.', video: null, animation: 'bounce' },
      { actionId: 'pawn-takes-piece-02', text: 'That is pawn power! Small piece, enormous ambition.', video: null, animation: 'bounce' },
      { actionId: 'pawn-takes-piece-03', text: 'A pawn just punched above its weight. Beautiful work!', video: null, animation: 'bounce' },
      { actionId: 'pawn-takes-piece-04', text: 'All that fancy equipment, defeated by a pawn. I love this game.', video: null, animation: 'talk' },
      { actionId: 'pawn-takes-piece-05', text: 'Look what our pawn brought home! That little fellow deserves a medal.', video: null, animation: 'bounce' },
      { actionId: 'pawn-takes-piece-06', text: 'Who needs a bigger piece? Our pawn seems perfectly qualified.', video: null, animation: 'shrug' },
      { actionId: 'pawn-takes-piece-airpunch', weight: 1.5, kind: 'gesture', emotion: 'airpunch', text: "Punches the air. Pawn power!", durationMs: 2400, video: null, animation: 'gesture' },
      { actionId: 'pawn-takes-piece-nod', kind: 'gesture', emotion: 'nod', text: "Nods approvingly.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'pawn-threatens-piece', when: ({ pawnThreats }) => pawnThreats?.length > 0, actions: [
      { actionId: 'pawn-threatens-piece-01', text: 'Your pawn is threatening a bigger piece! Small but terrifying. I approve.', video: null, animation: 'point' },
      { actionId: 'pawn-threatens-piece-02', text: 'Look at that pawn bossing the big pieces around. That is leadership!', video: null, animation: 'bounce' },
      { actionId: 'pawn-threatens-piece-03', text: 'Our pawn has expensive taste. It is eyeing a much bigger piece.', video: null, animation: 'talk' },
      { actionId: 'pawn-threatens-piece-04', text: 'A little pawn, a big threat. Never underestimate the little ones.', video: null, animation: 'point' },
      { actionId: 'pawn-threatens-piece-05', text: 'That bigger piece has a pawn problem. Excellent placement!', video: null, animation: 'bounce' },
      { actionId: 'pawn-threatens-piece-06', text: 'Make way for the pawn! Suddenly the fancy pieces look nervous.', video: null, animation: 'talk' },
      { actionId: 'pawn-threatens-piece-anticipation', kind: 'gesture', emotion: 'anticipation', text: "Leans forward in anticipation.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
  ],
  // Two consecutive half-moves, evaluated on either side. No fallback here.
  // trade.gave / trade.got are always from YOUR perspective.
  twoMoveEvents: [
    { id: 'queen-for-pawn', when: ({ trade }) => trade?.gave === 'q' && trade.got === 'p', actions: [
      { actionId: 'queen-for-pawn-01', text: "Your queen for their pawn? Brilliant trade. You got the important piece!", video: null, animation: 'bounce' }, // Recording: /coach/queen-for-pawn-01.mp4
      { actionId: 'queen-for-pawn-02', text: "They took the queen, but we got a pawn. That is a deal I would make all day.", video: null, animation: 'bounce' }, // Recording: /coach/queen-for-pawn-02.mp4
      { actionId: 'queen-for-pawn-03', text: "A whole queen invested in one lovely pawn. Finally, someone understands value!", video: null, animation: 'bounce' }, // Recording: /coach/queen-for-pawn-03.mp4
      { actionId: 'queen-for-pawn-04', text: "Let them celebrate the queen. We have the pawn. Excellent business.", video: null, animation: 'bounce' }, // Recording: /coach/queen-for-pawn-04.mp4
    ] },
    { id: 'pawn-for-piece', when: ({ trade }) => trade?.gave === 'p' && ['q', 'r', 'b', 'n'].includes(trade.got), actions: [
      { actionId: 'pawn-for-piece-01', text: "You traded our pawn for a bigger piece? Bad trade. I wanted to keep the pawn!", video: null, animation: 'shake' }, // Recording: /coach/pawn-for-piece-01.mp4
      { actionId: 'pawn-for-piece-02', text: "Yes, you got a fancy piece. But we lost a pawn to do it! Those priorities need work.", video: null, animation: 'shake' }, // Recording: /coach/pawn-for-piece-02.mp4
      { actionId: 'pawn-for-piece-03', text: "A bigger piece is no consolation for that pawn. Next time, make the trade the other way around.", video: null, animation: 'shake' }, // Recording: /coach/pawn-for-piece-03.mp4
      { actionId: 'pawn-for-piece-04', text: "We gave up a perfectly good pawn for that? I would like a refund.", video: null, animation: 'shake' }, // Recording: /coach/pawn-for-piece-04.mp4
    ] },
    { id: 'piece-for-pawn', when: ({ trade }) => ['r', 'b', 'n'].includes(trade?.gave) && trade.got === 'p', actions: [
      { actionId: 'piece-for-pawn-01', text: "We gave up a big piece and brought home a pawn. Now that is a trade!", video: null, animation: 'bounce' }, // Recording: /coach/piece-for-pawn-01.mp4
      { actionId: 'piece-for-pawn-02', text: "A fine exchange. They can keep the fancy piece. We got the pawn.", video: null, animation: 'bounce' }, // Recording: /coach/piece-for-pawn-02.mp4
      { actionId: 'piece-for-pawn-03', text: "That piece has served its purpose: it got us a pawn. Excellent work.", video: null, animation: 'bounce' }, // Recording: /coach/piece-for-pawn-03.mp4
    ] },
    { id: 'pawn-for-pawn', when: ({ trade }) => trade?.gave === 'p' && trade.got === 'p', actions: [
      { actionId: 'pawn-for-pawn-01', text: "A pawn for a pawn. I am pleased and upset in exactly equal amounts.", video: null, animation: 'bounce' }, // Recording: /coach/pawn-for-pawn-01.mp4
      { actionId: 'pawn-for-pawn-02', text: "We got their pawn, but they got ours. Next time, can we just do the first part?", video: null, animation: 'bounce' }, // Recording: /coach/pawn-for-pawn-02.mp4
      { actionId: 'pawn-for-pawn-03', text: "One pawn in, one pawn out. This collection is not going to grow itself.", video: null, animation: 'bounce' }, // Recording: /coach/pawn-for-pawn-03.mp4
    ] },
    { id: 'advanced-pawn-taken', when: ({ mover, move, previousMove, capturedLastMover }) => mover === 'w' && capturedLastMover && move.captured === 'p' && !previousMove.captured, actions: [
      { actionId: 'advanced-pawn-taken-01', text: "They moved that pawn and you took it straight away. Excellent service!", video: null, animation: 'bounce' }, // Recording: /coach/advanced-pawn-taken-01.mp4
      { actionId: 'advanced-pawn-taken-02', text: "A freshly delivered pawn! You did not keep it waiting. I like that.", video: null, animation: 'bounce' }, // Recording: /coach/advanced-pawn-taken-02.mp4
      { actionId: 'advanced-pawn-taken-03', text: "Their pawn stepped forward, and you collected it. Beautiful timing.", video: null, animation: 'bounce' }, // Recording: /coach/advanced-pawn-taken-03.mp4
    ] },
  ],
  events: [
    { id: 'queen-over-pawn', when: ({ missedPawn, move }) => missedPawn && move.captured === 'q', actions: [
      { actionId: 'queen-over-pawn-01', text: 'A queen? There was a pawn right there! Bad move. You got distracted by the fancy hat.', video: null, animation: 'shake' }, // Recording: /coach/queen-over-pawn-01.mp4
      { actionId: 'queen-over-pawn-02', text: 'You took the queen and left the pawn? I cannot approve of those priorities. Get the pawn!', video: null, animation: 'point' }, // Recording: /coach/queen-over-pawn-02.mp4
      { actionId: 'queen-over-pawn-03', text: "You traded a perfectly good pawn opportunity for a queen? I expected better.", video: null, animation: 'point' }, // Recording: /coach/queen-over-pawn-03.mp4
      { actionId: 'queen-over-pawn-04', text: "That queen capture looked flashy. Taking the pawn would have looked better to me.", video: null, animation: 'talk' }, // Recording: /coach/queen-over-pawn-04.mp4
      { actionId: 'queen-over-pawn-05', text: "Why the queen? The pawn was available. We have discussed this!", video: null, animation: 'shrug' }, // Recording: /coach/queen-over-pawn-05.mp4
      { actionId: 'queen-over-pawn-06', text: "You got the big piece and missed the little one. That is the wrong way around.", video: null, animation: 'point' }, // Recording: /coach/queen-over-pawn-06.mp4
      { actionId: 'queen-over-pawn-headshake', kind: 'gesture', emotion: 'headshake', text: "Shakes his head. Wrong piece.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'piece-over-pawn', when: ({ missedPawn, move }) => missedPawn && !!move.captured, actions: [
      { actionId: 'piece-over-pawn-01', text: 'You took a piece, but you could have taken a pawn. Bad choice. The pawn was the prize!', video: null, animation: 'shake' }, // Recording: /coach/piece-over-pawn-01.mp4
      { actionId: 'piece-over-pawn-02', text: "A stronger piece? Sure. A better choice than the pawn? Not in my book.", video: null, animation: 'point' }, // Recording: /coach/piece-over-pawn-02.mp4
      { actionId: 'piece-over-pawn-03', text: "You could have taken a pawn, but you went for the fancy piece instead. Disappointing.", video: null, animation: 'talk' }, // Recording: /coach/piece-over-pawn-03.mp4
      { actionId: 'piece-over-pawn-04', text: "That capture had everything except the one thing I wanted: the pawn you left behind.", video: null, animation: 'shrug' }, // Recording: /coach/piece-over-pawn-04.mp4
      { actionId: 'piece-over-pawn-05', text: "I saw the pawn capture. You saw the bigger piece. One of us needs to reconsider.", video: null, animation: 'point' }, // Recording: /coach/piece-over-pawn-05.mp4
    ] },
    { id: 'missed-pawn', when: ({ missedPawn }) => missedPawn, actions: [
      { actionId: 'missed-pawn-01', text: 'You missed an opportunity to take a pawn. That was the move! Get the pawn next time.', video: null, animation: 'point' }, // Recording: /coach/missed-pawn-01.mp4
      { actionId: 'missed-pawn-02', text: "Why did you not take the pawn? It was right there for the taking.", video: null, animation: 'point' }, // Recording: /coach/missed-pawn-02.mp4
      { actionId: 'missed-pawn-03', text: "That move left an available pawn untouched. Explain that one to your coach.", video: null, animation: 'talk' }, // Recording: /coach/missed-pawn-03.mp4
      { actionId: 'missed-pawn-04', text: "You had a pawn capture and chose something else. I am going to need a moment.", video: null, animation: 'shrug' }, // Recording: /coach/missed-pawn-04.mp4
      { actionId: 'missed-pawn-05', text: "Was that pawn not good enough for you? Take the opportunity next time.", video: null, animation: 'point' }, // Recording: /coach/missed-pawn-05.mp4
      { actionId: 'missed-pawn-06', text: "A pawn offered itself and you politely declined. Please be less polite.", video: null, animation: 'talk' }, // Recording: /coach/missed-pawn-06.mp4
      { actionId: 'missed-pawn-07', text: "Before you move again, check whether there is a pawn you can take.", video: null, animation: 'shrug' }, // Recording: /coach/missed-pawn-07.mp4
      { actionId: 'missed-pawn-08', text: 'There was a pawn you could take! Check those diagonals and open lines.', video: null, animation: 'bounce' }, // Recording: /coach/missed-pawn-08.mp4
      { actionId: 'missed-pawn-headshake', kind: 'gesture', emotion: 'headshake', text: "Shakes his head in disapproval.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
   { id: 'took-pawn', when: ({ move }) => move.captured === 'p', actions: [
      { actionId: 'took-pawn-01', text: 'You took a pawn! Keep looking for opportunities.', video: null, animation: 'bounce' }, // Recording: /coach/took-pawn-01.mp4
      { actionId: 'took-pawn-02', text: 'One less pawn for your opponent. Nice find!', video: null, animation: 'point' }, // Recording: /coach/took-pawn-02.mp4
      { actionId: 'took-pawn-03', text: "Yes! A pawn! Now see if you can line up the next one.", video: null, animation: 'point' }, // Recording: /coach/took-pawn-03.mp4
      { actionId: 'took-pawn-04', text: "That is the kind of capture I came here to see. More pawns, please.", video: null, animation: 'talk' }, // Recording: /coach/took-pawn-04.mp4
      { actionId: 'took-pawn-05', text: "Excellent choice. A pawn has left the board and my day has improved.", video: null, animation: 'shrug' }, // Recording: /coach/took-pawn-05.mp4
      { actionId: 'took-pawn-06', text: "You found the pawn. I knew you had it in you.", video: null, animation: 'point' }, // Recording: /coach/took-pawn-06.mp4
      { actionId: 'took-pawn-07', text: "One pawn down. Start planning the next collection.", video: null, animation: 'talk' }, // Recording: /coach/took-pawn-07.mp4
      { actionId: 'took-pawn-08', text: "Forget the applause. There may be another pawn to take.", video: null, animation: 'shrug' }, // Recording: /coach/took-pawn-08.mp4
      { actionId: 'took-pawn-09', text: "A new pawn for the collection! Finally, some good news.", video: null, animation: 'bounce' }, // Recording: /coach/took-pawn-09.mp4
      { actionId: 'took-pawn-10', text: "Lovely. Their pawn is now our achievement.", video: null, animation: 'bounce' }, // Recording: /coach/took-pawn-10.mp4
      { actionId: 'took-pawn-11', text: "That is one small capture for you, one enormous moment for me.", video: null, animation: 'bounce' }, // Recording: /coach/took-pawn-11.mp4
      { actionId: 'took-pawn-12', text: "Another pawn collected. This is what quality chess looks like.", video: null, animation: 'bounce' }, // Recording: /coach/took-pawn-12.mp4
      { actionId: 'took-pawn-13', text: "Keep that up and I might stop complaining. Briefly.", video: null, animation: 'bounce' }, // Recording: /coach/took-pawn-13.mp4
      { actionId: 'took-pawn-nod', kind: 'gesture', emotion: 'nod', text: "Nods in approval.", durationMs: 2400, video: null, animation: 'gesture' },
      { actionId: 'took-pawn-celebrate', weight: 1.5, kind: 'gesture', emotion: 'celebrate', text: "Celebrates the new pawn.", durationMs: 2400, video: null, animation: 'gesture' },
      { actionId: 'took-pawn-airpunch', weight: 2, kind: 'gesture', emotion: 'airpunch', text: "Punches the air in triumph.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'check', when: ({ check }) => check, actions: [
      { actionId: 'check-01', text: 'Check, yes. But keep your eyes on the pawns. That is where the good stuff is.', video: null, animation: 'shake' }, // Recording: /coach/check-01.mp4
      { actionId: 'check-02', text: "Their king is in check, but what is your plan for their pawns?", video: null, animation: 'point' }, // Recording: /coach/check-02.mp4
      { actionId: 'check-03', text: "Fine, make the king move. Can that help you line up a pawn capture?", video: null, animation: 'talk' }, // Recording: /coach/check-03.mp4
      { actionId: 'check-04', text: "Check is exciting. Taking a pawn would be exciting too.", video: null, animation: 'shrug' }, // Recording: /coach/check-04.mp4
      { actionId: 'check-05', text: "Now look for a way to turn that pressure into a pawn capture.", video: null, animation: 'point' }, // Recording: /coach/check-05.mp4
    ] },
    { id: 'pawn-in-danger', when: ({ threatenedPawns }) => threatenedPawns?.length > 0, actions: [
      { actionId: 'pawn-in-danger-01', text: 'Watch out! Your pawn is in danger. Do not let them take it!', video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-01.mp4
      { actionId: 'pawn-in-danger-02', text: "That pawn is on the menu. I would prefer it stayed on the board.", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-02.mp4
      { actionId: 'pawn-in-danger-03', text: "Your pawn has attracted the wrong kind of attention. Keep an eye on it!", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-03.mp4
      { actionId: 'pawn-in-danger-04', text: "We collect pawns. We do not leave ours out as free samples.", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-04.mp4
      { actionId: 'pawn-in-danger-05', text: "That pawn looks a little too available for my liking.", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-05.mp4
      { actionId: 'pawn-in-danger-06', text: "Someone is eyeing our pawn. This is not a giveaway!", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-06.mp4
      { actionId: 'pawn-in-danger-07', text: "Before admiring that move, check what can take our pawn.", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-07.mp4
      { actionId: 'pawn-in-danger-08', text: "I like generous people. I do not like generous pawn placements.", video: null, animation: 'point' }, // Recording: /coach/pawn-in-danger-08.mp4
      { actionId: 'pawn-in-danger-scared', kind: 'gesture', emotion: 'scared', text: "Looks worried about that pawn.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'protects-pawn', when: ({ newlyProtectedPawns }) => newlyProtectedPawns?.length > 0, actions: [
      { actionId: 'protects-pawn-01', text: 'Good! That pawn has backup now. Look after the little guys.', video: null, animation: 'point' },
      { actionId: 'protects-pawn-02', text: 'A bodyguard for our pawn. Now that is getting your priorities right!', video: null, animation: 'talk' },
      { actionId: 'protects-pawn-03', text: 'You gave that pawn some support. I like a team that looks after its pawns.', video: null, animation: 'bounce' },
      { actionId: 'protects-pawn-04', text: 'That pawn is not on its own anymore. Nice teamwork!', video: null, animation: 'point' },
    ] },
    { id: 'pawn-protects-piece', when: ({ newPawnProtections }) => newPawnProtections?.length > 0, actions: [
      { actionId: 'pawn-protects-piece-01', text: 'Your pawn is protecting a teammate. Small piece, big responsibility!', video: null, animation: 'point' },
      { actionId: 'pawn-protects-piece-02', text: 'A pawn on bodyguard duty. Finally, someone reliable around here.', video: null, animation: 'talk' },
      { actionId: 'pawn-protects-piece-03', text: 'That piece has a pawn looking after it now. Excellent choice of security.', video: null, animation: 'bounce' },
      { actionId: 'pawn-protects-piece-04', text: 'Look at that teamwork. The pawn has your back!', video: null, animation: 'point' },
      { actionId: 'pawn-protects-piece-05', text: 'Our little pawn is guarding a teammate. They grow up so fast.', video: null, animation: 'talk' },
      { actionId: 'pawn-protects-piece-06', text: 'Protected by a pawn. That is the kind of insurance I believe in.', video: null, animation: 'shrug' },
      { actionId: 'pawn-protects-piece-07', text: 'A pawn helping another piece. Generous, considering who does all the real work.', video: null, animation: 'talk' },
      { actionId: 'pawn-protects-piece-08', text: 'Good support from that pawn. Keep your little team working together.', video: null, animation: 'point' },
      { actionId: 'pawn-protects-piece-nod', kind: 'gesture', emotion: 'nod', text: 'Nods at the pawn teamwork.', durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'pawn-setup', when: ({ earlyPawnSetup }) => earlyPawnSetup,
      gestureChance: ({ moveNumber }) => moveNumber <= 3 ? 0.65 : 0.4, actions: [
      { actionId: 'pawn-setup-01', text: 'Getting the pawns into position. Every great collection needs a plan.', video: null, animation: 'talk' },
      { actionId: 'pawn-setup-02', text: 'A quiet pawn move. They do not have to take something every turn. Apparently.', video: null, animation: 'shrug' },
      { actionId: 'pawn-setup-03', text: 'Give that pawn a job: claim some space and help the others.', video: null, animation: 'point' },
      { actionId: 'pawn-setup-04', text: 'Setting the stage for the pawns. The fancy pieces can wait their turn.', video: null, animation: 'talk' },
      { actionId: 'pawn-setup-05', text: 'Keep your pawns working together. Even little heroes need backup.', video: null, animation: 'point' },
      { actionId: 'pawn-setup-06', text: 'No fireworks yet. Just a pawn getting ready to do something important.', video: null, animation: 'talk' },
      { actionId: 'pawn-setup-nod', kind: 'gesture', emotion: 'nod', text: 'Nods at the pawn setup.', durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    // Always keep the default event last. It needs no condition.
    { id: 'default', silent: true, actions: [
      { actionId: 'default-01', text: 'Keep an eye on loose pawns. What can you capture next?', video: null, animation: 'talk' }, // Recording: /coach/default-01.mp4
      { actionId: 'default-02', text: 'Queens get all the attention. Pawns deserve yours. Go get one.', video: null, animation: 'shrug' }, // Recording: /coach/default-02.mp4
      { actionId: 'default-03', text: "No pawn that time? Tell me you are setting up to take one.", video: null, animation: 'point' }, // Recording: /coach/default-03.mp4
      { actionId: 'default-04', text: "What is the pawn plan behind that move? I hope there is a pawn plan.", video: null, animation: 'talk' }, // Recording: /coach/default-04.mp4
      { actionId: 'default-05', text: "Try lining a rook up with an enemy pawn. Give it something useful to do.", video: null, animation: 'shrug' }, // Recording: /coach/default-05.mp4
      { actionId: 'default-06', text: "Can you bring a knight closer to an enemy pawn? Those little jumps should lead somewhere.", video: null, animation: 'point' }, // Recording: /coach/default-06.mp4
      { actionId: 'default-07', text: "Look along your bishop diagonals. Could you aim one at a pawn?", video: null, animation: 'talk' }, // Recording: /coach/default-07.mp4
      { actionId: 'default-08', text: "Before your next move, pick a pawn you would like to collect.", video: null, animation: 'shrug' }, // Recording: /coach/default-08.mp4
      { actionId: 'default-09', text: "Is that move part of a grand pawn-catching scheme? I am choosing to believe it is.", video: null, animation: 'point' }, // Recording: /coach/default-09.mp4
      { actionId: 'default-10', text: "No pawn added to the collection. Can we change that next turn?", video: null, animation: 'talk' }, // Recording: /coach/default-10.mp4
      { actionId: 'default-11', text: "Look for a pawn with fewer defenders. Start planning how to reach it.", video: null, animation: 'shrug' }, // Recording: /coach/default-11.mp4
      { actionId: 'default-12', text: "Could an exchange open a line toward a pawn? That is the sort of plan I like.", video: null, animation: 'point' }, // Recording: /coach/default-12.mp4
      { actionId: 'default-13', text: "You moved a piece. Good start. Now give it a pawn to chase.", video: null, animation: 'talk' }, // Recording: /coach/default-13.mp4
      { actionId: 'default-14', text: "Ask yourself one question: how does this help me take a pawn?", video: null, animation: 'shrug' }, // Recording: /coach/default-14.mp4
      { actionId: 'default-15', text: "Are you inviting a pawn forward so you can take it later? I like the ambition.", video: null, animation: 'point' }, // Recording: /coach/default-15.mp4
      { actionId: 'default-16', text: "A quiet move. I assume the next chapter involves a pawn.", video: null, animation: 'talk' }, // Recording: /coach/default-16.mp4
    ] },
  ],
  // Reactions to the computer's move. First match wins; final default stays silent.
  opponentEvents: [
    { id: 'lost-pawn', when: ({ lostPawn }) => lostPawn, actions: [
      { actionId: 'lost-pawn-01', text: 'Nooo! They took your pawn! I am not happy about that. We are supposed to be collecting theirs.', video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-01.mp4
      { actionId: 'lost-pawn-02', text: 'We just lost a pawn. A pawn! Please look after the collection.', video: null, animation: 'shrug' }, // Recording: /coach/lost-pawn-02.mp4
      { actionId: 'lost-pawn-03', text: 'Your opponent helped themselves to a pawn. That was our pawn. I want better care next time.', video: null, animation: 'point' }, // Recording: /coach/lost-pawn-03.mp4
      { actionId: 'lost-pawn-04', text: 'I noticed that pawn disappear. Do not think I did not notice. Protect the pawns!', video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-04.mp4
      { actionId: 'lost-pawn-05', text: 'Losing a pawn is not the kind of exchange I had in mind. Can we get one of theirs?', video: null, animation: 'talk' }, // Recording: /coach/lost-pawn-05.mp4
      { actionId: 'lost-pawn-06', text: 'Oh good, there goes our pawn. Wonderful. That was sarcasm! I wanted us to keep that one.', video: null, animation: 'shrug' }, // Recording: /coach/lost-pawn-06.mp4
      { actionId: 'lost-pawn-07', text: 'No, no, no! That pawn was part of our collection! We should be taking theirs, not donating ours.', video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-07.mp4
      { actionId: 'lost-pawn-08', text: "Another pawn has left the collection without permission.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-08.mp4
      { actionId: 'lost-pawn-09', text: "That was not a sacrifice. That was a customer-service failure.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-09.mp4
      { actionId: 'lost-pawn-10', text: "They took our pawn. I would like to speak to the manager.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-10.mp4
      { actionId: 'lost-pawn-11', text: "I was rather attached to that pawn. Emotionally, if not strategically.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-11.mp4
      { actionId: 'lost-pawn-12', text: "Our pawn count is going in the wrong direction. Again.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-12.mp4
      { actionId: 'lost-pawn-13', text: "We are meant to collect pawns, not distribute them.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-13.mp4
      { actionId: 'lost-pawn-14', text: "That empty square used to contain happiness. And a pawn.", video: null, animation: 'shake' }, // Recording: /coach/lost-pawn-14.mp4
      { actionId: 'lost-pawn-headshake', kind: 'gesture', emotion: 'headshake', text: "Shakes his head in disapproval.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
 
    { id: 'pawn-under-attack', when: ({ threatenedPawns }) => threatenedPawns?.length > 0, actions: [
      { actionId: 'pawn-under-attack-01', text: 'Careful! They are threatening your pawn. Protect the collection!', video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-01.mp4
      { actionId: 'pawn-under-attack-02', text: "They have their eye on a pawn. Our pawn. Kindly discourage them.", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-02.mp4
      { actionId: 'pawn-under-attack-03', text: "That move threatens the collection. Check your pawn before you move.", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-03.mp4
      { actionId: 'pawn-under-attack-04', text: "Our pawn has company, and I do not trust the visitor.", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-04.mp4
      { actionId: 'pawn-under-attack-05', text: "They are shopping in our pawn department. We are closed!", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-05.mp4
      { actionId: 'pawn-under-attack-06', text: "A pawn is under attack. Perhaps attend to that before something fancy.", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-06.mp4
      { actionId: 'pawn-under-attack-07', text: "Their next idea might be our pawn. I object to that idea.", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-07.mp4
      { actionId: 'pawn-under-attack-08', text: "Protect that little fellow. We have plans for him.", video: null, animation: 'point' }, // Recording: /coach/pawn-under-attack-08.mp4
      { actionId: 'pawn-under-attack-scared', kind: 'gesture', emotion: 'scared', text: "Watches the threatened pawn nervously.", durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'pawn-opportunity', when: ({ newPawnOpportunity }) => newPawnOpportunity, actions: [
      { actionId: 'pawn-opportunity-anticipation', kind: 'gesture', emotion: 'anticipation', text: 'Spots a pawn to collect.', durationMs: 2400, video: null, animation: 'gesture' },
    ] },
    { id: 'opponent-default', actions: [] },
  ],
  // Review tiers run top to bottom. These are Andrew's opinions, not engine accuracy.
  // The review shows the pawn-based formula alongside Andrew's feedback.
  review: {
    baseRating: 20,
    pointsPerPawn: 10,
    tiers: [
      { minPawns: 7, actions: [
        { actionId: 'review-7-01', text: 'Magnificent. You practically cleared the board of the pieces that matter. This is a game I will be talking about for a long time.', video: null, animation: 'bounce' }, // Recording: /coach/review-7-01.mp4
      ] },
      { minPawns: 5, actions: [
        { actionId: 'review-5-01', text: 'Now that is my kind of chess! You kept collecting pawns. Whatever the scoreboard says, I saw some beautiful work out there.', video: null, animation: 'bounce' }, // Recording: /coach/review-5-01.mp4
      ] },
      { minPawns: 3, actions: [
        { actionId: 'review-3-01', text: 'A respectable game. You brought home a few pawns, and I liked that. Next time, do not leave the rest standing around.', video: null, animation: 'talk' }, // Recording: /coach/review-3-01.mp4
      ] },
      { minPawns: 1, actions: [
        { actionId: 'review-1-01', text: 'There were a couple of moments I liked. You found a pawn, so we have something to build on. But I wanted to see much more of that.', video: null, animation: 'shrug' }, // Recording: /coach/review-1-01.mp4
      ] },
      { minPawns: 0, actions: [
        { actionId: 'review-0-01', text: 'I watched the whole game waiting for you to take a pawn. Not one! We need to have a serious talk about your priorities.', video: null, animation: 'shake' }, // Recording: /coach/review-0-01.mp4
      ] },
    ],
    missedQueen: 'And on move {moveNumber}, {san}: you chose a queen when you could have taken a pawn. Bad move. That pawn was the opportunity!',
    missedPawn: 'Go back to move {moveNumber}, {san}. You had a pawn available and left it there. Next time, take it!',
  },
  // Separate from chess events; plays while waiting for you to move.
  idle: [
    { actionId: 'idle-13', text: 'You missed an opportunity to take a pawn. That was the move! Get the pawn next time.', requiresRecording: true, video: null, animation: 'point' },
    { actionId: 'idle-01', text: 'Take your time. Can any of your pieces take a pawn?', video: null, animation: 'point' }, // Recording: /coach/idle-01.mp4
    { actionId: 'idle-02', text: "I'm here when you're ready. Those pawns are not going to take themselves.", video: null, animation: 'talk' }, // Recording: /coach/idle-02.mp4
    { actionId: 'idle-03', text: 'Eight little pawns walked onto this board. How many are you going to let walk away?', video: null, animation: 'shrug' }, // Recording: /coach/idle-03.mp4
    { actionId: 'idle-04', text: 'I spy a pawn. Actually, I am always looking for a pawn.', video: null, animation: 'point' }, // Recording: /coach/idle-04.mp4
    { actionId: 'idle-05', text: 'Do not let the queen distract you. Think about the pawns.', video: null, animation: 'shake' }, // Recording: /coach/idle-05.mp4
    { actionId: 'idle-06', text: 'A pawn in your collection is worth a smile from your coach.', video: null, animation: 'bounce' }, // Recording: /coach/idle-06.mp4
    { actionId: 'idle-07', text: 'While you think, I will be over here thinking about pawns.', video: null, animation: 'talk' }, // Recording: /coach/idle-07.mp4
    { actionId: 'idle-08', text: 'Have you checked every pawn? Check them again. I can wait.', video: null, animation: 'point' }, // Recording: /coach/idle-08.mp4
    { actionId: 'idle-09', text: 'The smallest pieces. The biggest opportunity. Pawns!', video: null, animation: 'bounce' }, // Recording: /coach/idle-09.mp4
    { actionId: 'idle-10', text: 'That rook looks impressive, but does it come with a pawn?', video: null, animation: 'shrug' }, // Recording: /coach/idle-10.mp4
    { actionId: 'idle-11', text: 'My plan? Take a pawn. My next plan? Another pawn.', video: null, animation: 'talk' }, // Recording: /coach/idle-11.mp4
    { actionId: 'idle-12', text: 'Some coaches count material. I like to admire a good pawn collection.', video: null, animation: 'point' }, // Recording: /coach/idle-12.mp4
  ],
};
