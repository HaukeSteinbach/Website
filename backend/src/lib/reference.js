export function createPublicReference(date = new Date()) {
  const year = date.getUTCFullYear();
  const randomPart = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

  return `SB-${year}-${randomPart}`;
}
