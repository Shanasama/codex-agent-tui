// Intentional fixture: a review task can find that quantity is ignored.
export function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
