import { initGroupReviewV2 } from "./groupReviewV2.js";
import { installGroupReviewReuseV2 } from "./groupReviewV2Reuse.js";

export function initGroupReview() {
  const api = initGroupReviewV2();
  installGroupReviewReuseV2(api);
  return api;
}
