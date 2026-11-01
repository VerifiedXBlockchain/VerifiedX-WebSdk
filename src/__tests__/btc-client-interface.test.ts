import BtcClient from '../btc/client';
import type { IBtcClient } from '../btc/types';

// Compile-time equality: ts-jest type-checks this file, so a drift between
// the IBtcClient interface and the BtcClient class fails the suite.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type ClassShape = { [K in keyof BtcClient]: BtcClient[K] };
type InterfaceShape = InstanceType<IBtcClient>;

export type ConstructorMatches = Expect<Equal<ConstructorParameters<typeof BtcClient>, ConstructorParameters<IBtcClient>>>;
export type MethodNamesMatch = Expect<Equal<keyof ClassShape, keyof InterfaceShape>>;
export type MethodsMatch = Expect<
  Equal<{ [K in keyof ClassShape]: Parameters<ClassShape[K]> }, { [K in keyof InterfaceShape]: Parameters<InterfaceShape[K]> }>
>;
export type ReturnsMatch = Expect<
  Equal<{ [K in keyof ClassShape]: ReturnType<ClassShape[K]> }, { [K in keyof InterfaceShape]: ReturnType<InterfaceShape[K]> }>
>;

test('BtcClient satisfies IBtcClient', () => {
  const ctor: IBtcClient = BtcClient;
  const client = new ctor('testnet', { dryRun: true });
  expect(typeof client.generateMnemonic).toBe('function');
  expect(typeof client.generateEmailKeypair).toBe('function');
});
