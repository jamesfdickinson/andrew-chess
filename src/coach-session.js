import { coachPath } from './coach-paths.js';
import { migrateLegacyCoachLink } from './legacy-coach-migration.js';
export const defaultCoachId = 'andrew';
let selected = typeof location === 'undefined' ? defaultCoachId : migrateLegacyCoachLink(new URLSearchParams(location.search).get('coach')) || defaultCoachId;
export const selectedCoach = () => selected;
export function setSelectedCoach(id) { selected = id; }
export function coachAsset(name) { return `${coachPath(selected)}/${name}`; }
export function coachFetch(input, options) {
  if (typeof input === 'string' && input.startsWith('/api/recordings')) {
    const url = new URL(input, location.origin); url.searchParams.set('coach', selected);
    return globalThis.fetch(url, options);
  }
  return globalThis.fetch(input, options);
}
