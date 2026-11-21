// The kinds of row lib/actionLog.ts writes, and which of them Undo may reverse.
// Pure and import-free, so node --test can hold the list (tests/viewAsSource
// .test.ts) — actionLog.ts itself imports Prisma.

export type ActionKind =
  | "create" | "delete" | "designApply" | "rangeConfirm" | "rangeAdd" | "rangeRemove" | "edit" | "mixLink"
  // "View as": an admin started or stopped looking at the ERP as another
  // login (lib/viewAsAudit.ts). An audit trail, not an action on data.
  | "viewAsStart" | "viewAsStop"
  // The design master's FG code list load and seed (commercial
  // design-codes/_lib): a record of what was loaded, not an action to reverse.
  | "designCodes"
  // The Commercial Manager made a new order from a Salesforce PI whose order
  // was cancelled (commercial/sf-pi-intake remakeOrder, REPLY-25 §1 item 9):
  // a record linking the two orders, not an action Undo could reverse.
  | "sfPiRemade"
  // A superseding Salesforce PI made an order of its own after the order it
  // replaces was cancelled, and that order's money and PIs moved to it
  // (commercial/sf-pi-intake makeOrder, P2 of the REPLY-33 check): a record
  // of which receipt went where, not an action Undo could reverse.
  | "sfPiCarried"
  // Accounts → Payment Tracking: an uploaded sheet was deleted with the
  // invoices that belonged to it alone (accounts server/payments/records.ts
  // deleteUpload). Their own history cascades away with them, so this row is
  // the record of who removed what — not an action Undo could reverse.
  | "ptUploadDeleted"
  // Accounts → Payment Tracking: one invoice was deleted with its receipts and
  // notes (records.ts deleteInvoice; code review 27 Oct 2026, E2E-40). Its own
  // history cascades away with it, so this row is the record of who removed
  // what — not an action Undo could reverse.
  | "ptInvoiceDeleted"
  // Sales → Settings → Danger Zone emptied every sales-module table
  // (api/admin/wipe-sales-data), written in the same transaction as the
  // deletes: who did it and how many rows each table lost. Nothing is kept to
  // put back, so Undo could not reverse it.
  | "salesDataWiped"
  // Pigment → a formula or a Daily Production record was permanently deleted
  // by a Line Manager, Incharge or admin (owner, 27 Oct 2026, decision 3;
  // lib/pigment/server/audit.ts). Its rows cascade away with it and what
  // referred to it is re-pointed, so this row is the record of who removed
  // what — not an action Undo could reverse.
  | "pigmentFormulaDeleted" | "pigmentProductionDeleted"
  // Purchase → a draft purchase order or a master (supplier, item, address,
  // contact, a template, a payment term) was permanently deleted (scripts/0159,
  // lib/purchase/server/audit.ts logPurchaseDelete). A deleted PO keeps its
  // whole last content on its DELETED timeline event; this row is the ERP's
  // record of who removed what, not an action Undo could reverse.
  | "purchaseOrderDeleted" | "purchaseMasterDeleted"
  // Users & Roles: a login's password was reset, or a login changed its own
  // (admin/users/actions.ts resetPassword). Who did it to which login: the
  // users row keeps only the new hash. A record, nothing Undo could reverse.
  | "passwordReset"
  // Machine Overview → Fill missing parameters (5 Nov 2026, lib/plantSync/machine/fill-server.ts saveFill): an
  // incharge filled blank opening-check parameters on rows the plant sync wrote. Its payload names every slab and
  // value; a wrong value is corrected like any other (Edit parameters, Tables), so Undo never offers it.
  | "paramFill";

/**
 * NEVER OFFERED BY UNDO. lastUndoable/undoLastAction used to spell the first
 * four out inline, twice. They are records of a check or an edit trail with no
 * reversal payload; the view-as rows are records of somebody LOOKING; the
 * "designCodes" row is the record of an FG code list load or seed, the
 * "sfPiRemade" row of an order made again from a Salesforce PI, the
 * "sfPiCarried" row of the money a superseding Salesforce PI's new order
 * took from the cancelled one, the
 * "ptUploadDeleted" row of a Payment Tracking upload deleted, the
 * "ptInvoiceDeleted" row of one Payment Tracking invoice deleted, and the
 * "salesDataWiped" row of the sales test data wiped, the two
 * "pigment…Deleted" rows of a Pigment formula or production record deleted,
 * the two "purchase…Deleted" rows of a purchase order or master deleted,
 * the "passwordReset" row of a password reset in Users & Roles, and the
 * "paramFill" row of a Fill missing parameters save. Without
 * them here, the global Undo (undoLastAction with no batch) would offer to
 * "undo" an admin's view — and, since reverse() has no branch for the kind,
 * mark the row undone while reversing nothing.
 */
export const NOT_UNDOABLE: readonly ActionKind[] = ["rangeConfirm", "rangeAdd", "rangeRemove", "edit", "viewAsStart", "viewAsStop", "designCodes", "sfPiRemade", "sfPiCarried", "ptUploadDeleted", "ptInvoiceDeleted", "salesDataWiped", "pigmentFormulaDeleted", "pigmentProductionDeleted", "purchaseOrderDeleted", "purchaseMasterDeleted", "passwordReset", "paramFill"];
