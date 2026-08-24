from __future__ import annotations

from sqlalchemy import event

from app.models.group_review import GroupReviewProject, GroupReviewRow
from app.services.group_review_images import (
    delete_project_image_tree,
    delete_row_image_tree_any_project,
)


@event.listens_for(GroupReviewRow, "after_delete")
def cleanup_group_review_row_images(_mapper, _connection, target: GroupReviewRow) -> None:
    delete_row_image_tree_any_project(target.sheet_id, target.id)


@event.listens_for(GroupReviewProject, "after_delete")
def cleanup_group_review_project_images(_mapper, _connection, target: GroupReviewProject) -> None:
    delete_project_image_tree(target.id)
