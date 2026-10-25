import bar from "./bar.jpg";
import cafeRoom from "./cafe-room.jpg";
import cafe from "./cafe.jpg";
import cocktail from "./cocktail.jpg";
import counter from "./counter.jpg";
import dinner from "./dinner.jpg";
import espresso from "./espresso.jpg";
import friends from "./friends.jpg";
import hero from "./hero.jpg";
import hotel from "./hotel.jpg";
import lounge from "./lounge.jpg";
import restaurant from "./restaurant.jpg";
import toast from "./toast.jpg";
import vinyl from "./vinyl.jpg";

/**
 * Photography of the public website. Free photos from Unsplash (Unsplash License: free for commercial
 * use, no attribution required), downloaded once, lightly graded and saved as optimised JPEGs.
 * Statically imported, so next/image knows every size and generates a blurred placeholder.
 * To replace a photo, overwrite its file with another JPEG of the same name (docs/WEBSITE.md).
 */
export const PHOTOS = {
  hero,
  bar,
  cafe,
  cafeRoom,
  cocktail,
  counter,
  dinner,
  espresso,
  friends,
  hotel,
  lounge,
  restaurant,
  toast,
  vinyl,
} as const;

export type PhotoKey = keyof typeof PHOTOS;

/** Where each photo comes from (its Unsplash page; all are "Free" under the Unsplash License). */
export const PHOTO_SOURCES: Record<PhotoKey, string> = {
  hero: "https://unsplash.com/photos/2GNBoMgKYEo",
  bar: "https://unsplash.com/photos/S66B39wYMP0",
  cafe: "https://unsplash.com/photos/vhQUnmnOLys",
  cafeRoom: "https://unsplash.com/photos/dzpUoUUWFzw",
  cocktail: "https://unsplash.com/photos/3Dh2KgJHLZc",
  counter: "https://unsplash.com/photos/ygB26dSPOuA",
  dinner: "https://unsplash.com/photos/wrW1mQTja7w",
  espresso: "https://unsplash.com/photos/qqZayRGexo8",
  friends: "https://unsplash.com/photos/JHezbrzFErw",
  hotel: "https://unsplash.com/photos/8BYahZcwYgI",
  lounge: "https://unsplash.com/photos/WdWmF-FOupU",
  restaurant: "https://unsplash.com/photos/8l_RuuZrOyY",
  toast: "https://unsplash.com/photos/qqYUxX6HJ4I",
  vinyl: "https://unsplash.com/photos/KA1WM_yQGF8",
};
