import { initGroupReviewV2 } from "./groupReviewV2.js";
import { installGroupReviewReuseV2 } from "./groupReviewV2Reuse.js";
import { installGroupReviewRefreshV2 } from "./groupReviewV2Refresh.js";
import { installGroupReviewAdminTabStatusV2 } from "./groupReviewV2AdminTabStatus.js";
import { installGroupReviewCellLockV2 } from "./groupReviewV2CellLock.js";
import { installGroupReviewAdminNavigationV2 } from "./groupReviewV2AdminNavigation.js";

export function initGroupReview() {
  const api = initGroupReviewV2();
  installGroupReviewReuseV2(api);
  installGroupReviewRefreshV2(api);
  installGroupReviewAdminTabStatusV2();
  installGroupReviewCellLockV2();
  installGroupReviewAdminNavigationV2();
  return api;
}
