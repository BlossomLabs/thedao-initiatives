import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The https link, or "" for anything else. The API only stores https links
 * (see api/lib/validate.ts validateHttpsLink); this guards the render as well.
 */
export function httpsHref(url: string): string {
  return /^https:\/\/[^\s/?#]+/i.test(url) ? url : "";
}
