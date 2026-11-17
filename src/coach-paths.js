// Coach IDs match their public folder names.
export const coachPath = id => {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(id)) throw new Error('Invalid coach ID');
  return `/coach/${id}`;
};
