import { BlockAddressesEvent } from '../types';

/**
 * Whether a relay socket message is a `block_addresses` event. Takes the
 * message as received: a parsed object or its JSON text. `new_block` and
 * every other event type answer false.
 */
export function isBlockAddressesEvent(message: unknown): message is BlockAddressesEvent {
  let value = message;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  const event = value as Partial<BlockAddressesEvent> | null;
  return (
    !!event &&
    event.type === 'block_addresses' &&
    !!event.data &&
    typeof event.data.height === 'number' &&
    typeof event.data.hash === 'string' &&
    Array.isArray(event.data.affected_addresses)
  );
}

/** Which of `addresses` a `block_addresses` event lists: the ones a wallet should refetch. */
export function blockAddressesTouching(event: BlockAddressesEvent, addresses: string[]): string[] {
  const affected = new Set(event.data.affected_addresses);
  return addresses.filter((address) => affected.has(address));
}
