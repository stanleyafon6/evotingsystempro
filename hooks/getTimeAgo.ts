export const getTimeAgo = (date: any) => {
  if (!date) return "";

  // Normalize input to a proper JS Date
  let parsedDate;

  // Firestore Timestamp (live object)
  if (typeof date.toDate === "function") {
    parsedDate = date.toDate();
  }
  // Firestore Timestamp from AsyncStorage JSON
  else if (date?.seconds) {
    parsedDate = new Date(date.seconds * 1000);
  }
  // Already a JS Date object
  else if (date instanceof Date) {
    parsedDate = date;
  }
  // String or number (ISO or timestamp)
  else {
    parsedDate = new Date(date);
  }

  const now = new Date().getTime();
  const diff = now - parsedDate.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);
  return `${years}y ago`;
};
