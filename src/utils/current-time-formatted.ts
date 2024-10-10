export function currentTimeFormatted() {
  const date = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    timeZone: process.env.TZ || 'Europe/Berlin',
  };
  const formattedDate = date.toLocaleString('en-US', options);
  return formattedDate;
}
