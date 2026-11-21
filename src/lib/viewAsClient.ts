// STANDALONE: "View as" does not exist here, so no error is ever a view-as
// refusal. Kept so app/error.tsx and app/global-error.tsx stay as the ERP wrote them.
export function viewAsRefusalOf(_error: unknown): string | null {
  return null;
}
