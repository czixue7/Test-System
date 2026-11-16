/** 将居中、90vw × 90vh 的 contain 图片映射到缩略图的实际位置。 */
export function imageThumbnailTransform(
  source: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): string | null {
  if (![source.width, source.height, naturalWidth, naturalHeight, viewportWidth, viewportHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const fit = Math.min(viewportWidth * 0.9 / naturalWidth, viewportHeight * 0.9 / naturalHeight);
  const x = source.left + source.width / 2 - viewportWidth / 2;
  const y = source.top + source.height / 2 - viewportHeight / 2;
  return `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${source.width / (naturalWidth * fit)}, ${source.height / (naturalHeight * fit)})`;
}
