# Group Review V2 Contract

## Status

- UI Source of Truth: `prototype/group_review_realtime_grid_sample.html`
- Existing Firebase Group Review remains active until V2 cutover.
- Existing `groupReview*.js` import chain must not be removed during V2 construction.
- V2 target stack: Browser Grid UI + FastAPI REST + FastAPI WebSocket + PostgreSQL.

## Grid UI contract

Columns are fixed to:

1. `Collateral#`
2. `Sheet`
3. `Field No.`
4. `변경전`
5. `변경후`

`Collateral#`, `Sheet`, and `Field No.` use narrow columns and centered content.
`변경전` and `변경후` use wide columns and support multiline text.
All rows start at the same default height. A row grows naturally only when multiline content requires more height.

Supported cell presentation:

- font size: 12, 13, 15, 18, 22
- bold
- strikethrough
- background color

Unsupported for the initial V2 scope:

- font color
- underline
- merged cells
- formulas
- spreadsheet filtering/sorting
- conditional formatting

## Persistence boundary

Content and presentation are separate.

Text content remains in the existing canonical columns:

- `collateral_no`
- `sheet_label`
- `field_no`
- `change_before_text`
- `change_after_text`

Legacy HTML columns remain for migration compatibility:

- `change_before_html`
- `change_after_html`

New V2 presentation is stored in `group_review_rows.cell_styles` as JSONB.

Canonical cell style keys:

- `collateral_no`
- `sheet_label`
- `field_no`
- `change_before`
- `change_after`

Example:

```json
{
  "change_before": {
    "fontSize": 15,
    "bold": true,
    "strike": false,
    "backgroundColor": "#fff3b0"
  },
  "change_after": {}
}
```

API validation contract:

- `fontSize`: one of 12, 13, 15, 18, 22
- `bold`: boolean
- `strike`: boolean
- `backgroundColor`: empty string or safe HEX color
- unknown style properties must not be persisted

## Workflow preservation

V2 replaces the current UI and Firestore data-access architecture, but preserves the existing business workflow semantics.

Worker responsibilities include:

- open own sheet
- add/edit/delete rows while allowed
- submit input
- respect submitted/completed read-only state
- request reuse where allowed

Admin responsibilities include:

- view member sheets
- review submitted rows
- approve
- request revision
- preserve revision history
- complete/reopen review
- approve/reject reuse
- complete/reopen project

Final behavior must be revalidated against the existing implementation before cutover.

## Realtime contract

REST is authoritative for persistent state changes.

REST responsibilities:

- initial project/sheet/row load
- row mutation
- row ordering
- workflow actions
- persistence to PostgreSQL

WebSocket responsibilities:

- connection presence
- cell editing presence
- cell lock/unlock
- broadcast of successful persistent changes

WebSocket messages are not the database Source of Truth.

## Cell locking

Initial V2 collaboration uses cell-level pessimistic locks, not CRDT/OT text merging.

Cell identity:

- `project_id`
- `sheet_id`
- `row_id`
- `field_name`

When one user edits a cell, other connected users see an editing indicator and cannot edit that cell. Other cells remain editable.

A lock should be released on relevant edit completion, disconnect, or expiry. The exact timeout is deferred to the realtime implementation phase.

Transient presence/lock state should not be stored as permanent business data in PostgreSQL. Redis is not required for the initial single-process internal deployment.

## Cutover rule

Do not remove the existing Group Review until all of the following are complete:

1. V2 database schema
2. backend authentication verification
3. Group Review REST API
4. WebSocket realtime layer
5. V2 Grid integration
6. Firestore data migration
7. multi-PC concurrent edit testing
8. worker workflow testing
9. admin workflow testing
10. operating cutover
11. stabilization

Existing Firebase Group Review code is removed only after successful cutover.
