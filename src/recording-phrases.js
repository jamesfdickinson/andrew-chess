import { coachConfig } from './coach-config.js';

export const recordingPhrases = [
  ...coachConfig.priorityEvents.map(event => ({ ...event, group: 'Opponent moves' })),
  ...coachConfig.twoMoveEvents.map(event => ({ ...event, group: 'Trades' })),
  ...coachConfig.events.map(event => ({ ...event, group: 'Your moves' })),
  ...coachConfig.opponentEvents.map(event => ({ ...event, group: 'Opponent moves' })),
  { id: 'idle', group: 'Idle', actions: coachConfig.idle },
  ...coachConfig.review.tiers.map(tier => ({ id: `review-${tier.minPawns}`, group: 'Game reviews', actions: tier.actions })),
].flatMap(event => event.actions.filter(action => action.kind !== 'gesture').map(action => ({ id: action.actionId, text: action.text, group: event.group, event: event.id })));
