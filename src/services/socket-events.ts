import { BlockAddressesEvent } from '../types';

/**
 * A relay socket message as a `block_addresses` event, or null for any other
 * message (`new_block`, other types, malformed text). Takes the message as
 * received: a parsed object or its JSON text.
 */
export function parseBlockAddressesEvent(message: unknown): BlockAddressesEvent | null {
  let value = message;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return isBlockAddressesEvent(value) ? value : null;
}

/** Whether an already-parsed socket message is a `block_addresses` event. For JSON text use parseBlockAddressesEvent. */
export function isBlockAddressesEvent(message: unknown): message is BlockAddressesEvent {
  const event = message as Partial<BlockAddressesEvent> | null;
  return (
    !!event &&
    typeof event === 'object' &&
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
