// Keep the previous image AND its crop until the next sheet is decoded.
export function createPortraitRenderer(portrait, createImage = () => new Image()) {
  const images = new Map();
  let latest;
  function commit(frame) {
    portrait.style.backgroundImage = frame.image ? `url("${frame.image}")` : 'none';
    portrait.style.backgroundSize = frame.size;
    portrait.style.backgroundPosition = frame.position;
    portrait.setAttribute('aria-label', frame.label || 'Pixel-art chess coach');
    portrait.dataset.emotion = frame.emotion;
    portrait.dataset.mouth = String(frame.mouth);
  }
  return frame => {
    latest = frame;
    if (!frame.image) { commit(frame); return; }
    let entry = images.get(frame.image);
    if (!entry) {
      const image = createImage();
      entry = { ready: false, image };
      images.set(frame.image, entry);
      image.src = frame.image;
      image.decode().then(() => {
        entry.ready = true;
        // Render the most recent crop, not the frame that started loading.
        if (latest.image === frame.image) commit(latest);
      }).catch(() => {
        // A failed sheet must not blank the last usable portrait. Allow retry.
        images.delete(frame.image);
      });
    }
    if (entry.ready) commit(frame);
  };
}
