import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyDraft, migrateLegacyCoachLink } from '../src/legacy-coach-migration.js';
import { coachPath } from '../src/coach-paths.js';

test('legacy draft ownership changes without changing take IDs or audio chunks', () => {
  const jimmy = { kind: 'take', key: 'take-1', id: 'take-1', coachId: 'andrew', phraseId: 'idle-01', mime: 'audio/webm' };
  const andrew = { ...jimmy, key: 'take-2', id: 'take-2', coachId: '4df51f63-8f62-45cc-bf49-9e158651a515' };
  const chunk = { kind: 'chunk', key: 'take-1:000000', id: 'take-1', blob: new Blob(['recorded audio']) };
  assert.deepEqual(migrateLegacyDraft(jimmy), { ...jimmy, coachId: 'jimmy' });
  assert.deepEqual(migrateLegacyDraft(andrew), { ...andrew, coachId: 'andrew' });
  assert.equal(migrateLegacyDraft(chunk), chunk);
  assert.equal(migrateLegacyDraft({ ...jimmy, coachId: undefined }).coachId, 'jimmy');
  assert.equal(migrateLegacyDraft({ ...jimmy, coachId: 'custom-coach' }).coachId, 'custom-coach');
  assert.equal(jimmy.coachId, 'andrew');
});

test('current IDs are unambiguous and old UUID links still select Andrew', () => {
  assert.equal(coachPath('jimmy'), '/coach/jimmy');
  assert.equal(coachPath('andrew'), '/coach/andrew');
  assert.equal(migrateLegacyCoachLink('4df51f63-8f62-45cc-bf49-9e158651a515'), 'andrew');
  assert.equal(migrateLegacyCoachLink('andrew'), 'andrew');
  assert.equal(migrateLegacyCoachLink('jimmy'), 'jimmy');
  assert.throws(() => coachPath('../jimmy'));
});
