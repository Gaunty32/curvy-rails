export type DispatchAddressResolution =
  | { kind: "single"; addressId: number }
  | { kind: "account" }
  | { kind: "conflict"; addressIds: number[] };

export function resolveDispatchAddress(
  orderAddressId: number | null | undefined,
  items: Array<{ employeeAddressId: number | null | undefined }>,
): DispatchAddressResolution {
  if (items.length === 0 && orderAddressId != null) {
    return { kind: "single", addressId: orderAddressId };
  }

  const addressIds = [...new Set(
    items
      .map(item => item.employeeAddressId ?? orderAddressId ?? null)
      .filter((id): id is number => id != null),
  )];

  if (addressIds.length > 1) return { kind: "conflict", addressIds };
  if (addressIds.length === 1) return { kind: "single", addressId: addressIds[0] };
  return { kind: "account" };
}