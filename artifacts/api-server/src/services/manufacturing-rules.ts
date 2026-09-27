export function assertOpeningBalanceAvailable(balance: number, openingAlreadyRecorded: boolean): void {
  if (openingAlreadyRecorded || balance !== 0) {
    throw Object.assign(new Error("Opening balance has already been recorded or stock has already changed."), { status: 409 });
  }
}

export function stocktakeVariance(
  expected: number,
  current: number,
  counted: number,
  draftMovementRevision: number,
  currentMovementRevision: number,
): number {
  if (current !== expected || currentMovementRevision !== draftMovementRevision) {
    throw Object.assign(new Error("Stock changed after this stocktake was drafted; create a fresh stocktake."), { status: 409 });
  }
  return counted - expected;
}

export function nextBomVersion(currentVersion: number | null): number {
  return (currentVersion ?? 0) + 1;
}