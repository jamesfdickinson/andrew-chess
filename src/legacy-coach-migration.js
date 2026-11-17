// Only legacy browser data uses the former IDs. Never apply this to current data.
const oldAndrewId = '4df51f63-8f62-45cc-bf49-9e158651a515';
export function migrateLegacyDraft(entry) {
  if (entry.kind !== 'take') return entry;
  const coachId = !entry.coachId || entry.coachId === 'andrew' ? 'jimmy'
    : entry.coachId === oldAndrewId ? 'andrew' : entry.coachId;
  return { ...entry, coachId };
}
export const migrateLegacyCoachLink = id => id === oldAndrewId ? 'andrew' : id;
