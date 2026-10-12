export const nowSec = () => Math.floor(Date.now() / 1000);
export const toUnix = (d) => Math.floor(new Date(d).getTime() / 1000);
export const fromUnix = (s) => new Date(s * 1000);
export const addDays = (date, days) =>
  new Date(date.getTime() + days * 86_400_000);