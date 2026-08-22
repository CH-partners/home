import { initGroupReviewV2 } from "./groupReviewV2.js";
import { installGroupReviewReuseV2 } from "./groupReviewV2Reuse.js";
import { installGroupReviewRefreshV2 } from "./groupReviewV2Refresh.js";

export function initGroupReview() {
  const api = initGroupReviewV2();
  installGroupReviewReuseV2(api);
  installGroupReviewRefreshV2(api);
  return api;
}
