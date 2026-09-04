import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class merger. Every generated component imports this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
