export const normalizeServerTime = (val: any): number => {
if (!val) return Date.now();
if (typeof val === "number") return val;
if (typeof val === "string" && !isNaN(Number(val))) return Number(val);
if (val?.toMillis) return val.toMillis();
if (val instanceof Date) return val.getTime();
return Date.now();
};


export const timeAgoSafe = (val: any, formatter: (d: Date) => string) => {
const t = normalizeServerTime(val);
return formatter(new Date(t));
};