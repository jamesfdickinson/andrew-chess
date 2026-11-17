import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortraitRenderer } from '../src/portrait-renderer.js';

test('sheet transitions hold the previous crop and ignore obsolete image loads', async () => {
  const loads = new Map();
  const portrait = { style: {}, dataset: {}, setAttribute() {} };
  const render = createPortraitRenderer(portrait, () => {
    const image = { decode: () => new Promise((resolve, reject) => loads.set(image.src, { resolve, reject })) };
    return image;
  });
  const frame = (image, position = '0% 0%') => ({ image, position, size: '300% 200%', emotion: 'calm', mouth: 0 });
  render(frame('rest.png'));
  loads.get('rest.png').resolve(); await Promise.resolve();
  render(frame('first.png', '50% 100%'));
  assert.equal(portrait.style.backgroundImage, 'url("rest.png")');
  assert.equal(portrait.style.backgroundPosition, '0% 0%');
  render(frame('second.png'));
  render(frame('second.png', '100% 100%'));
  loads.get('second.png').resolve(); await Promise.resolve();
  assert.equal(portrait.style.backgroundImage, 'url("second.png")');
  assert.equal(portrait.style.backgroundPosition, '100% 100%');
  loads.get('first.png').resolve(); await Promise.resolve();
  assert.equal(portrait.style.backgroundImage, 'url("second.png")');
  render(frame('broken.png'));
  loads.get('broken.png').reject(new Error('Unavailable')); await Promise.resolve(); await Promise.resolve();
  assert.equal(portrait.style.backgroundImage, 'url("second.png")');
  render(frame('rest.png'));
  assert.equal(portrait.style.backgroundImage, 'url("rest.png")');
});
