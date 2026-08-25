import { installLimitedDeploymentMode } from "./deploymentMode.js";
import { initGroupReviewV2 } from "./groupReviewV2.js";
import { installGroupReviewReuseV2 } from "./groupReviewV2Reuse.js";
import { installGroupReviewRefreshV2 } from "./groupReviewV2Refresh.js";
import { installGroupReviewAdminTabStatusV2 } from "./groupReviewV2AdminTabStatus.js";
import { installGroupReviewCellLockV2 } from "./groupReviewV2CellLock.js";
import { installGroupReviewAdminNavigationV2 } from "./groupReviewV2AdminNavigation.js";
import { installGroupReviewProjectDeleteV2 } from "./groupReviewV2ProjectDelete.js";
import { installGroupReviewKeyboardV2 } from "./groupReviewV2Keyboard.js";
import { installGroupReviewTheme } from "./groupReviewTheme.js";
import { installGroupReviewDefaultRowsV2 } from "./groupReviewDefaultRows.js";
import { installGroupReviewPartialBoldV2 } from "./groupReviewPartialBold.js";
import { installGroupReviewCellImagesV2 } from "./groupReviewCellImages.js";
import { installGroupReviewTopShell } from "./groupReviewTopShell.js";
import { installGroupReviewTabStateTheme } from "./groupReviewTabStateTheme.js";
import { installGroupReviewSheetOrder } from "./groupReviewSheetOrder.js";

export function initGroupReview() {
  installLimitedDeploymentMode();
  installGroupReviewTheme();
  installGroupReviewTabStateTheme();
  const api = initGroupReviewV2();
  installGroupReviewReuseV2(api);
  installGroupReviewRefreshV2(api);
  installGroupReviewAdminTabStatusV2();
  installGroupReviewCellLockV2();
  installGroupReviewAdminNavigationV2();
  installGroupReviewProjectDeleteV2(api);
  installGroupReviewKeyboardV2();
  installGroupReviewDefaultRowsV2(api);
  installGroupReviewPartialBoldV2();
  installGroupReviewCellImagesV2(api);
  installGroupReviewTopShell();
  installGroupReviewSheetOrder();
  return api;
}
