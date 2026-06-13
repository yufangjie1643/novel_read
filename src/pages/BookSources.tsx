// `/book-sources` has been replaced by `/sources` (v2 page with the
// health table). This re-export keeps the old URL working as an alias
// for backward compatibility (e.g. external links, saved bookmarks).
// The deprecation banner is no longer needed since the page IS the
// v2 page now.
export { default } from './Sources';
