/**
 * Who rates, as the ratings' copy names them. Admins while the ratings are
 * tested (they stay private to admins); when they go public this becomes
 * "badge holder" or "expert", and every label follows.
 */
export const REVIEWER = "admin";
/** "Admin", for the start of a label. */
export const Reviewer = REVIEWER[0].toUpperCase() + REVIEWER.slice(1);
/** "Admin review": a review's chip and the comment box's title. */
export const REVIEW_LABEL = `${Reviewer} review`;
